"use client";

// ============================================================================
// AI INSIGHTS PANEL
//
// Three tabs that make the AI 100% transparent to the player:
//
//   1. GA TRAINING  — how the enemy genome was actually produced.
//                     Round-robin tournament results, king-of-the-hill
//                     cycles, the final champion genome.
//
//   2. LLM DESIGNER — what the LLM does (and doesn't do).
//                     Architecture diagram, dataset stats, sample
//                     IntentOutput, the separation principle.
//
//   3. LIVE         — a second view of the live AI (mirrors the Genome HUD
//                     on the fight screen, but with more detail).
//
// All data is fetched from /api/ai/* so the in-browser UI is always in sync
// with whatever the offline scripts have produced.
// ============================================================================

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ChampionPayload {
  ok: boolean;
  path?: string;
  bytes?: number;
  mtime?: string;
  genome?: {
    id: string | null;
    source: string | null;
    generation: number;
    version: string | null;
    createdAt: string | null;
    parentA: string | null;
    parentB: string | null;
    fitnessHistory: number[];
    narrativeTraits: { category: string; description: string; strength: number; sourceGene?: string }[];
    genes: Record<string, number>;
  };
  error?: string;
}

interface GaStatsPayload {
  ok: boolean;
  roundRobin: { path: string; matches: number; standings: { genomeId: string; wins: number; losses: number; draws: number; score: number }[] } | null;
  widowKoH:
    | null
    | {
        path: string;
        baseline: { id: string; name: string; title: string };
        config: { cycles: number; koh: number; verify: number; pool: number; inject: number; seed: number };
        cycles: {
          cycle: number;
          kohMatches: number;
          kohWins: number;
          kohLosses: number;
          kingId: string;
          verifyWins: number;
          verifyLosses: number;
          passed: boolean;
          injectedMutants: number;
        }[];
        totals: { kohMatches: number; verifyMatches: number; cyclesRun: number };
        finalKing: { id: string; passed: boolean; verifyWins?: number; cycle?: number } | null;
        finishedAt: string;
      };
  libraryV2: any | null;
}

interface LlmInfoPayload {
  ok: boolean;
  architecture: {
    layers: { name: string; role: string; runtime: string; trainedBy: string }[];
    llmTraining: {
      totalSamples: number;
      trainSplit: number;
      valSplit: number;
      testSplit: number;
      byModel: Record<string, number>;
      byPromptVersion: Record<string, number>;
      byOrigin: Record<string, number>;
      byGrade: Record<string, number>;
      avgQuality: number;
      avgConfidence: number;
    };
    separationPrinciple: string;
  };
  datasetStats: any;
  datasetStatsPath: string | null;
}

export interface AIInsightsPanelProps {
  onClose: () => void;
}

const GENE_DESCRIPTIONS: Record<string, string> = {
  aggression: "base attack tendency when in range",
  reaction: "delay before reacting to a player action",
  blockChance: "chance of blocking or rolling away from player attacks",
  combo: "max follow-up hits in a pressure string",
  whiffPunish: "chance to dash in and punish a missed player attack",
  antiAir: "chance to hit a jumping player",
  pressure: "tendency to keep attacking without giving space",
  mixup: "chance to vary attack height/speed to break blocking",
  adaptive: "speed of pre-empting repeated player habits",
  rage: "extra aggression/speed boost when below 30% HP",
  perfection: "chance to frame-perfectly block unreactable strings",
  readDelay: "extra reaction delay when reading player habits",
};

function fmtBytes(n?: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function GeneBar({ name, value, max = 1 }: { name: string; value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color =
    name === "aggression" || name === "rage" || name === "pressure"
      ? "from-rose-500 to-amber-400"
      : name === "blockChance" || name === "reaction" || name === "perfection"
        ? "from-sky-500 to-cyan-300"
        : name === "combo" || name === "mixup" || name === "adaptive"
          ? "from-fuchsia-500 to-violet-300"
          : "from-emerald-500 to-lime-300";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-zinc-300 font-mono uppercase tracking-wider">{name}</span>
        <span className="text-white font-mono">
          {name === "combo" ? Math.round(value) : value.toFixed(2)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[9px] text-zinc-500 leading-tight">{GENE_DESCRIPTIONS[name]}</div>
    </div>
  );
}

export function AIInsightsPanel({ onClose }: AIInsightsPanelProps) {
  const [champion, setChampion] = useState<ChampionPayload | null>(null);
  const [gaStats, setGaStats] = useState<GaStatsPayload | null>(null);
  const [llmInfo, setLlmInfo] = useState<LlmInfoPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/ai/champion").then((r) => r.json()),
      fetch("/api/ai/ga-stats").then((r) => r.json()),
      fetch("/api/ai/llm-info").then((r) => r.json()),
    ])
      .then(([c, g, l]) => {
        if (cancelled) return;
        setChampion(c);
        setGaStats(g);
        setLlmInfo(l);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      data-testid="ai-insights-panel"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto p-4 sm:p-8"
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-fuchsia-400/60 tracking-[0.4em] text-[10px] mb-1">AI TRANSPARENCY</p>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-wide">
              AI INSIGHTS
            </h2>
            <p className="text-zinc-400 text-xs sm:text-sm mt-1 max-w-2xl">
              Everything the AI is doing, where it came from, and what the LLM is (and isn&apos;t) responsible for.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-white/20 text-white hover:bg-white/10"
          >
            Close
          </Button>
        </div>

        <Tabs defaultValue="ga" className="w-full">
          <TabsList className="grid grid-cols-3 w-full bg-zinc-900 border border-white/10">
            <TabsTrigger value="ga" className="data-[state=active]:bg-fuchsia-500/20 data-[state=active]:text-fuchsia-200">
              GA Training
            </TabsTrigger>
            <TabsTrigger value="llm" className="data-[state=active]:bg-sky-500/20 data-[state=active]:text-sky-200">
              LLM Designer
            </TabsTrigger>
            <TabsTrigger value="live" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-200">
              Live AI
            </TabsTrigger>
          </TabsList>

          {/* ============== GA TRAINING TAB ============== */}
          <TabsContent value="ga" className="mt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card className="bg-zinc-950/85 border-white/10">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/30">Method 1</Badge>
                    <h3 className="text-white font-bold tracking-wide">Round-Robin Tournament</h3>
                  </div>
                  <p className="text-zinc-300 text-xs leading-relaxed">
                    <strong className="text-white">How it was trained:</strong> Every genome in the v2 frozen library fights every other genome exactly once. The one with the best W/L record becomes the champion.
                  </p>
                  <p className="text-zinc-300 text-xs leading-relaxed mt-2">
                    <strong className="text-white">Where it&apos;s used:</strong> It seeded the v2 library and produced the baseline against which the Widow king-of-the-hill is gated.
                  </p>
                  {gaStats?.roundRobin ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                        <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                          <div className="text-zinc-500 tracking-widest">MATCHES</div>
                          <div className="text-white text-lg font-mono">{gaStats.roundRobin.matches}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                          <div className="text-zinc-500 tracking-widest">GENOMES</div>
                          <div className="text-white text-lg font-mono">{gaStats.roundRobin.standings.length}</div>
                        </div>
                      </div>
                      <ScrollArea className="mt-3 h-40 rounded border border-white/10 bg-black/40 p-2">
                        <div className="space-y-1">
                          {gaStats.roundRobin.standings.slice(0, 9).map((s) => (
                            <div key={s.genomeId} className="flex items-center justify-between text-[10px] font-mono">
                              <span className="text-zinc-300 truncate">{s.genomeId}</span>
                              <span className="text-emerald-300">{s.wins}W-{s.losses}L</span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <div className="mt-3 text-xs text-amber-300">no round-robin report found</div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-zinc-950/85 border-white/10">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30">Method 2</Badge>
                    <h3 className="text-white font-bold tracking-wide">King-of-the-Hill + 3/3 Gate</h3>
                  </div>
                  <p className="text-zinc-300 text-xs leading-relaxed">
                    <strong className="text-white">How it was trained:</strong> The king fights a 100-mutant queue, winner stays, loser goes to the back. After 100 matches the king is frozen and must win <strong>3/3</strong> vs the original Widow. If it fails, 20 new mutants are injected and the cycle repeats.
                  </p>
                  <p className="text-zinc-300 text-xs leading-relaxed mt-2">
                    <strong className="text-white">Where it&apos;s used:</strong> The output is written to <code className="text-fuchsia-200">ChampionGenome.json</code> and applied to the enemy via <code className="text-fuchsia-200">applyOpponentDefToEngine</code> at fight start.
                  </p>
                  {gaStats?.widowKoH ? (
                    <>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                        <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                          <div className="text-zinc-500 tracking-widest">CYCLES</div>
                          <div className="text-white text-lg font-mono">{gaStats.widowKoH.totals.cyclesRun}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                          <div className="text-zinc-500 tracking-widest">KOH</div>
                          <div className="text-white text-lg font-mono">{gaStats.widowKoH.totals.kohMatches}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                          <div className="text-zinc-500 tracking-widest">VERIFY</div>
                          <div className="text-white text-lg font-mono">{gaStats.widowKoH.totals.verifyMatches}</div>
                        </div>
                      </div>
                      <ScrollArea className="mt-3 h-40 rounded border border-white/10 bg-black/40 p-2">
                        <div className="space-y-1">
                          {gaStats.widowKoH.cycles.map((c) => (
                            <div
                              key={c.cycle}
                              className="flex items-center justify-between text-[10px] font-mono"
                            >
                              <span className="text-zinc-300">cycle {c.cycle}</span>
                              <span className={c.passed ? "text-emerald-300" : "text-rose-300"}>
                                {c.verifyWins}W/{c.verifyLosses}L {c.passed ? "✓" : "✗"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <div className="mt-3 text-xs text-amber-300">no widow evolution report — run <code>bun run eternal:evolve:widow</code></div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="mt-3 bg-zinc-950/85 border-white/10">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/30">Champion</Badge>
                  <h3 className="text-white font-bold tracking-wide">Current Champion Genome</h3>
                  {champion?.genome && (
                    <span className="ml-auto text-[10px] text-zinc-500 font-mono">
                      {fmtBytes(champion.bytes)} · {champion.mtime ? new Date(champion.mtime).toLocaleString() : "—"}
                    </span>
                  )}
                </div>
                {!champion ? (
                  <div className="text-zinc-500 text-xs">loading…</div>
                ) : !champion.ok || !champion.genome ? (
                  <div className="text-amber-300 text-xs">{champion?.error ?? "no champion"}</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] mb-3">
                      <div className="rounded border border-white/10 bg-black/40 p-2">
                        <div className="text-zinc-500">ID</div>
                        <div className="text-white font-mono truncate">{champion.genome.id}</div>
                      </div>
                      <div className="rounded border border-white/10 bg-black/40 p-2">
                        <div className="text-zinc-500">SOURCE</div>
                        <div className="text-fuchsia-200 font-mono">{champion.genome.source}</div>
                      </div>
                      <div className="rounded border border-white/10 bg-black/40 p-2">
                        <div className="text-zinc-500">GENERATION</div>
                        <div className="text-white font-mono">{champion.genome.generation}</div>
                      </div>
                      <div className="rounded border border-white/10 bg-black/40 p-2">
                        <div className="text-zinc-500">VERSION</div>
                        <div className="text-white font-mono">{champion.genome.version}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                      {Object.entries(champion.genome.genes).map(([k, v]) => (
                        <GeneBar
                          key={k}
                          name={k}
                          value={k === "combo" ? v : v}
                          max={k === "combo" ? 6 : 1}
                        />
                      ))}
                    </div>
                    {champion.genome.narrativeTraits.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <div className="text-[10px] text-zinc-500 tracking-widest mb-1.5">NARRATIVE TRAITS</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {champion.genome.narrativeTraits.map((t, i) => (
                            <div key={i} className="rounded border border-fuchsia-400/20 bg-fuchsia-500/5 p-2 text-[11px]">
                              <div className="text-fuchsia-200 font-bold tracking-wide uppercase">{t.category}</div>
                              <div className="text-zinc-300 italic mt-0.5">{t.description}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============== LLM DESIGNER TAB ============== */}
          <TabsContent value="llm" className="mt-3">
            <Card className="bg-zinc-950/85 border-white/10">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-sky-500/20 text-sky-200 border-sky-400/30">Architecture</Badge>
                  <h3 className="text-white font-bold tracking-wide">Two Layers, One Source of Truth</h3>
                </div>
                <p className="text-zinc-300 text-xs leading-relaxed mb-3">
                  The runtime game is split into two layers. The <strong>LLM</strong> never produces gameplay values; it only decides <em>why</em> the next fight should exist. The <strong>Director</strong> decides <em>how</em> it should feel.
                </p>
                <div className="space-y-2">
                  {llmInfo?.architecture.layers.map((l, i) => (
                    <div key={i} className="rounded-lg border border-white/10 bg-black/40 p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-white font-bold text-sm tracking-wide">{l.name}</div>
                        <Badge
                          className={
                            l.runtime.startsWith("Yes")
                              ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/30"
                              : "bg-amber-500/20 text-amber-200 border-amber-400/30"
                          }
                        >
                          runtime: {l.runtime}
                        </Badge>
                      </div>
                      <div className="text-zinc-300 text-xs mt-1.5 leading-relaxed">{l.role}</div>
                      <div className="text-zinc-500 text-[10px] mt-1.5 tracking-wider">TRAINED BY: {l.trainedBy}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/5 p-3">
                  <div className="text-amber-200 text-[10px] tracking-widest mb-1">SEPARATION PRINCIPLE</div>
                  <p className="text-zinc-200 text-xs italic leading-relaxed">
                    &quot;{llmInfo?.architecture.separationPrinciple}&quot;
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <Card className="bg-zinc-950/85 border-white/10">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-sky-500/20 text-sky-200 border-sky-400/30">Dataset</Badge>
                    <h3 className="text-white font-bold tracking-wide">LLM Training Data</h3>
                  </div>
                  {llmInfo?.architecture.llmTraining ? (
                    <>
                      <div className="grid grid-cols-3 gap-2 text-[10px] mb-3">
                        <div className="rounded border border-white/10 bg-black/40 p-2">
                          <div className="text-zinc-500 tracking-widest">SAMPLES</div>
                          <div className="text-white text-lg font-mono">
                            {llmInfo.architecture.llmTraining.totalSamples.toLocaleString()}
                          </div>
                        </div>
                        <div className="rounded border border-white/10 bg-black/40 p-2">
                          <div className="text-zinc-500 tracking-widest">AVG QUALITY</div>
                          <div className="text-emerald-300 text-lg font-mono">
                            {llmInfo.architecture.llmTraining.avgQuality.toFixed(3)}
                          </div>
                        </div>
                        <div className="rounded border border-white/10 bg-black/40 p-2">
                          <div className="text-zinc-500 tracking-widest">AVG CONF</div>
                          <div className="text-sky-300 text-lg font-mono">
                            {llmInfo.architecture.llmTraining.avgConfidence.toFixed(3)}
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] text-zinc-400 mb-1 tracking-widest">SPLIT</div>
                      <div className="space-y-1 mb-3">
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="w-16 text-zinc-400">train</span>
                          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-sky-500"
                              style={{
                                width: `${(llmInfo.architecture.llmTraining.trainSplit / llmInfo.architecture.llmTraining.totalSamples) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-white font-mono w-12 text-right">
                            {llmInfo.architecture.llmTraining.trainSplit.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="w-16 text-zinc-400">val</span>
                          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-sky-400/70"
                              style={{
                                width: `${(llmInfo.architecture.llmTraining.valSplit / llmInfo.architecture.llmTraining.totalSamples) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-white font-mono w-12 text-right">
                            {llmInfo.architecture.llmTraining.valSplit.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="w-16 text-zinc-400">test</span>
                          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-sky-400/40"
                              style={{
                                width: `${(llmInfo.architecture.llmTraining.testSplit / llmInfo.architecture.llmTraining.totalSamples) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-white font-mono w-12 text-right">
                            {llmInfo.architecture.llmTraining.testSplit.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-zinc-400 mb-1 tracking-widest">BY ORIGIN</div>
                      <ScrollArea className="h-32 rounded border border-white/10 bg-black/40 p-2">
                        <div className="space-y-0.5">
                          {Object.entries(llmInfo.architecture.llmTraining.byOrigin)
                            .sort((a, b) => b[1] - a[1])
                            .map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between text-[10px] font-mono">
                                <span className="text-zinc-300">{k}</span>
                                <span className="text-sky-300">{v.toLocaleString()}</span>
                              </div>
                            ))}
                        </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <div className="text-zinc-500 text-xs">loading…</div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-zinc-950/85 border-white/10">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-sky-500/20 text-sky-200 border-sky-400/30">Sample</Badge>
                    <h3 className="text-white font-bold tracking-wide">What an IntentOutput Looks Like</h3>
                  </div>
                  <p className="text-zinc-400 text-xs leading-relaxed mb-2">
                    Every fight the LLM is asked to plan, it returns JSON like the example below. The Director (V3 + IntentTranslator) translates this into concrete gameplay values.
                  </p>
                  <pre className="rounded-lg border border-white/10 bg-black/60 p-3 text-[10px] text-sky-200 font-mono overflow-x-auto leading-relaxed">
{`{
  "intent": "Make the player uncomfortable by countering their aggression.",
  "reasoning": "GA-derived intent. Genome style: counter. Key traits: aggression=0.65, patience=0.31, adaptive=0.09. The Director should select this genome and let it dominate the encounter.",
  "expectedPlayerReaction": "The player will start second-guessing their openings and the round will slow down.",
  "highLevelPlan": [
    "Set weather=fog and lighting=dim",
    "Apply the counter-style genome to the enemy",
    "Hand the player a slow first round so the trap can set"
  ],
  "confidence": 0.84
}`}
                  </pre>
                  <div className="mt-2 text-[10px] text-zinc-500">
                    → The runtime engine never sees this JSON. The Director&apos;s translation is the only thing that affects gameplay.
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ============== LIVE TAB ============== */}
          <TabsContent value="live" className="mt-3">
            <Card className="bg-zinc-950/85 border-white/10">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30">Live</Badge>
                  <h3 className="text-white font-bold tracking-wide">What the AI is Doing Right Now</h3>
                </div>
                <p className="text-zinc-300 text-xs leading-relaxed">
                  The Genome HUD and Decision Ticker on the fight screen sample <code className="text-emerald-300">engine.ai.getState()</code> every frame and surface:
                </p>
                <ul className="mt-2 text-zinc-300 text-xs space-y-1 list-disc list-inside">
                  <li>The current AI mode (approach / block / punish / rage / etc.) and a one-line reason for it.</li>
                  <li>The next attack the AI is queuing (punch / kick / roundhouse, plus remaining combo hits).</li>
                  <li>Whether the adaptive system has learned a player habit (punch-spam, kick-spam, jump-spam).</li>
                  <li>Whether the AI is in a punish window (player whiffed) or has triggered rage (HP &lt; 30%).</li>
                  <li>The 12 genes of the genome currently loaded, as live bars.</li>
                </ul>
                <p className="text-zinc-500 text-[10px] mt-3 italic">
                  Tip: open the AI Insights panel, start a fight, then watch the Genome HUD and Decision Ticker update in real time.
                </p>
                {loading && <div className="text-zinc-500 text-xs mt-2">loading…</div>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default AIInsightsPanel;
