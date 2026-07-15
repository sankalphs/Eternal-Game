"use client";

import { useCallback, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Area,
  ComposedChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GameEngine, OPPONENTS } from "@/lib/game/engine";
import {
  FitnessEvaluator,
  MutationEngine,
  CrossoverEngine,
  EvolutionReport,
  EvolutionManager,
  SimulationRunner,
  createAllAgents,
  applyOpponentDefToEngine,
  loadChampionGenome,
  DatasetLogger,
  ResearchReport,
  CHAMPION_GENOME_FILENAME,
  type IGenome,
  type IGenerationSnapshot,
  type IEvaluationResult,
} from "@/lib/game/evolution";

interface EvolutionPanelProps {
  engine?: GameEngine;
  onLoadChampion?: () => void;
}

export function EvolutionPanel({ engine, onLoadChampion }: EvolutionPanelProps) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<IGenerationSnapshot[]>([]);
  const [champion, setChampion] = useState<IGenome | null>(null);
  const [evaluations, setEvaluations] = useState<IEvaluationResult[]>([]);
  const [reportJson, setReportJson] = useState<string>("");
  const [datasetJsonl, setDatasetJsonl] = useState<string>("");
  const [researchJson, setResearchJson] = useState<string>("");

  const [populationSize, setPopulationSize] = useState(8);
  const [generations, setGenerations] = useState(6);
  const [mutationRate, setMutationRate] = useState(0.2);
  const [mutationMagnitude, setMutationMagnitude] = useState(0.15);
  const [selfPlayWeight, setSelfPlayWeight] = useState(0);
  const [generateDataset, setGenerateDataset] = useState(false);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-99), msg]);
  }, []);

  const runEvolution = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setProgress(0);
    setLogs([]);
    setSnapshots([]);
    setChampion(null);
    setEvaluations([]);
    setReportJson("");
    setDatasetJsonl("");
    setResearchJson("");

    const config = {
      populationSize,
      generations,
      elitismCount: 1,
      tournamentSize: 3,
      mutation: {
        ...MutationEngine.defaultConfig(),
        rate: mutationRate,
        magnitude: mutationMagnitude,
      },
      crossover: CrossoverEngine.defaultConfig(),
      fitness: FitnessEvaluator.defaultWeights(),
      lineageSize: 3,
      earlyStoppingPatience: Math.max(3, Math.floor(generations / 2)),
      earlyStoppingMinDelta: 0.005,
      randomRestartInterval: 0,
      randomRestartFraction: 0.25,
      diversityThreshold: 0.04,
      selfPlayWeight,
      generateDataset,
    };

    const base = OPPONENTS[0];
    const runner = new SimulationRunner({
      timeStep: 1 / 30,
      maxDurationSeconds: 90,
      roundsToWin: 2,
      fastRoundTransitions: true,
      deterministic: true,
      seedBase: 42,
      background: "sunset",
      baseOpponent: base,
    });

    addLog(`Starting evolution: pop=${populationSize}, gens=${generations}`);

    const datasetLogger = new DatasetLogger();
    const manager = new EvolutionManager({
      config,
      runner,
      agents: createAllAgents(),
      datasetLogger,
      onGeneration: (snapshot) => {
        setSnapshots((prev) => [...prev, snapshot]);
        setProgress(Math.round(((snapshot.generation + 1) / generations) * 100));
        addLog(
          `Gen ${snapshot.generation} | best ${snapshot.bestFitness.toFixed(4)} | avg ${snapshot.averageFitness.toFixed(4)} | div ${snapshot.diversity.toFixed(3)}`,
        );
      },
    });

    try {
      const championGenome = await manager.run();
      setChampion(championGenome);
      setEvaluations(manager.getEvaluations());

      const report = new EvolutionReport({
        config,
        snapshots: manager.getSnapshots(),
        champion: championGenome,
        lineage: manager.getLineage(),
        mutationHistory: manager.getMutationHistory(),
        evaluations: manager.getEvaluations(),
      });

      const research = new ResearchReport({
        config,
        snapshots: manager.getSnapshots(),
        champion: championGenome,
        lineage: manager.getLineage(),
        mutationHistory: manager.getMutationHistory(),
        evaluations: manager.getEvaluations(),
      });

      setReportJson(report.serialize());
      setResearchJson(research.serialize());
      setDatasetJsonl(datasetLogger.serializeJSONL());
      addLog(`Champion ${championGenome.id} fitness ${championGenome.fitness?.toFixed(4)}`);
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
      setProgress(100);
    }
  }, [
    running,
    populationSize,
    generations,
    mutationRate,
    mutationMagnitude,
    selfPlayWeight,
    generateDataset,
    addLog,
  ]);

  const loadChampionIntoEngine = useCallback(() => {
    if (!engine || !champion) return;
    const def = loadChampionGenome(JSON.stringify(champion), OPPONENTS[0]);
    applyOpponentDefToEngine(engine, def);
    addLog("Loaded champion into active engine");
    onLoadChampion?.();
  }, [engine, champion, addLog, onLoadChampion]);

  const downloadJson = useCallback((filename: string, content: string) => {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadText = useCallback((filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const benchmarkRows = useMemo(() => {
    if (!champion || evaluations.length === 0) return [];
    const evalRecord = evaluations.find((e) => e.genome.id === champion.id);
    if (!evalRecord) return [];
    return Object.entries(evalRecord.perArchetype).map(([archetype, score]) => ({ archetype, score }));
  }, [champion, evaluations]);

  const graphData = useMemo(
    () =>
      snapshots.map((s) => ({
        generation: s.generation,
        best: s.bestFitness,
        average: s.averageFitness,
        worst: s.worstFitness,
        diversity: s.diversity,
      })),
    [snapshots],
  );

  return (
    <Card className="w-[420px] max-h-[85vh] overflow-hidden flex flex-col bg-slate-950/90 border-slate-800 text-slate-100">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span>Eternal Evolution</span>
          {running && <Badge variant="secondary" className="animate-pulse">Running</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <Tabs defaultValue="run" className="w-full h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-4 h-8">
            <TabsTrigger value="run" className="text-xs">Run</TabsTrigger>
            <TabsTrigger value="results" className="text-xs">Results</TabsTrigger>
            <TabsTrigger value="graphs" className="text-xs">Graphs</TabsTrigger>
            <TabsTrigger value="logs" className="text-xs">Logs</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-hidden mt-2">
            <TabsContent value="run" className="space-y-3 h-full overflow-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Population</Label>
                  <Input
                    type="number"
                    min={4}
                    max={50}
                    value={populationSize}
                    onChange={(e) => setPopulationSize(Number(e.target.value))}
                    className="h-8 text-xs"
                    disabled={running}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Generations</Label>
                  <Input
                    type="number"
                    min={2}
                    max={100}
                    value={generations}
                    onChange={(e) => setGenerations(Number(e.target.value))}
                    className="h-8 text-xs"
                    disabled={running}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Mutation rate ({mutationRate.toFixed(2)})</Label>
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={mutationRate}
                  onChange={(e) => setMutationRate(Number(e.target.value))}
                  disabled={running}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Mutation magnitude ({mutationMagnitude.toFixed(2)})</Label>
                <input
                  type="range"
                  min={0.05}
                  max={0.4}
                  step={0.05}
                  value={mutationMagnitude}
                  onChange={(e) => setMutationMagnitude(Number(e.target.value))}
                  disabled={running}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Self-play weight ({selfPlayWeight.toFixed(2)})</Label>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={selfPlayWeight}
                  onChange={(e) => setSelfPlayWeight(Number(e.target.value))}
                  disabled={running}
                  className="w-full accent-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="dataset"
                  type="checkbox"
                  checked={generateDataset}
                  onChange={(e) => setGenerateDataset(e.target.checked)}
                  disabled={running}
                />
                <Label htmlFor="dataset" className="text-xs">Generate LLM dataset (JSONL)</Label>
              </div>

              <Button
                onClick={runEvolution}
                disabled={running}
                className="w-full bg-emerald-600 hover:bg-emerald-500"
              >
                {running ? "Evolving..." : "Run Evolution"}
              </Button>
              {running && <Progress value={progress} className="h-2" />}
            </TabsContent>

            <TabsContent value="results" className="space-y-3 h-full overflow-auto pr-1">
              {champion ? (
                <>
                  <div className="space-y-1">
                    <div className="text-xs text-slate-400">Champion</div>
                    <div className="text-sm font-mono truncate" title={champion.id}>{champion.id}</div>
                    <div className="text-xs text-slate-400">
                      Fitness {champion.fitness?.toFixed(4)} · Gen {champion.generation}
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <div className="text-xs text-slate-400 mb-1">Benchmarks</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                      {benchmarkRows.map((row) => (
                        <div key={row.archetype} className="flex justify-between">
                          <span className="capitalize text-slate-300">{row.archetype.replace(/_/g, " ")}</span>
                          <span>{row.score.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>Aggr <span className="text-slate-300">{champion.aggression.toFixed(2)}</span></div>
                    <div>Block <span className="text-slate-300">{champion.blockChance.toFixed(2)}</span></div>
                    <div>React <span className="text-slate-300">{champion.reaction.toFixed(2)}s</span></div>
                    <div>Combo <span className="text-slate-300">{champion.combo}</span></div>
                    <div>Press <span className="text-slate-300">{champion.pressure.toFixed(2)}</span></div>
                    <div>Mixup <span className="text-slate-300">{champion.mixup.toFixed(2)}</span></div>
                    <div>Adapt <span className="text-slate-300">{champion.adaptive.toFixed(2)}</span></div>
                    <div>Perf <span className="text-slate-300">{champion.perfection.toFixed(2)}</span></div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-slate-400">Narrative</div>
                    <div className="text-xs italic text-slate-300">
                      {champion.narrativeTraits?.map((t) => t.description).join(" ")}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {engine && (
                      <Button onClick={loadChampionIntoEngine} size="sm" className="w-full">
                        Load Champion Into Game
                      </Button>
                    )}
                    <Button
                      onClick={() => downloadJson(CHAMPION_GENOME_FILENAME, JSON.stringify(champion, null, 2))}
                      size="sm"
                      variant="outline"
                      className="w-full"
                    >
                      Download ChampionGenome.json
                    </Button>
                    <Button
                      onClick={() => downloadJson("EvolutionReport.json", reportJson)}
                      size="sm"
                      variant="outline"
                      className="w-full"
                    >
                      Download EvolutionReport.json
                    </Button>
                    <Button
                      onClick={() => downloadJson("ResearchReport.json", researchJson)}
                      size="sm"
                      variant="outline"
                      className="w-full"
                    >
                      Download ResearchReport.json
                    </Button>
                    {datasetJsonl && (
                      <Button
                        onClick={() => downloadText("Dataset.jsonl", datasetJsonl)}
                        size="sm"
                        variant="outline"
                        className="w-full"
                      >
                        Download Dataset.jsonl
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-500 text-center py-8">Run evolution to see results</div>
              )}
            </TabsContent>

            <TabsContent value="graphs" className="space-y-4 h-full overflow-auto pr-1">
              {snapshots.length > 1 ? (
                <>
                  <div className="h-40">
                    <div className="text-xs text-slate-400 mb-1">Fitness</div>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={graphData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="generation" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} domain={[0, "auto"]} />
                        <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Line type="monotone" dataKey="best" stroke="#22c55e" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="average" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="worst" stroke="#ef4444" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="h-40">
                    <div className="text-xs text-slate-400 mb-1">Diversity & Improvement</div>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={graphData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="generation" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                        <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 10 }} domain={[0, 1]} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 10 }} domain={[0, "auto"]} />
                        <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Area yAxisId="left" type="monotone" dataKey="diversity" stroke="#a855f7" fill="#a855f7" fillOpacity={0.3} />
                        <Line yAxisId="right" type="monotone" dataKey="best" stroke="#f59e0b" strokeWidth={2} dot={false} name="champion" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-500 text-center py-8">Run evolution to see graphs</div>
              )}
            </TabsContent>

            <TabsContent value="logs" className="h-full overflow-hidden">
              <ScrollArea className="h-64 rounded bg-slate-900 p-2">
                <div className="space-y-1 text-[10px] font-mono">
                  {logs.length === 0 && <div className="text-slate-600">No logs yet</div>}
                  {logs.map((log, i) => (
                    <div key={i} className="text-slate-300">{log}</div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}
