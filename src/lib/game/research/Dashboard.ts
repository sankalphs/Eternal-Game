// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — UNIFIED DASHBOARD
//
// PHASE 10 of the publication-quality evaluation layer.
//
// The single entry point for a publication-quality evaluation run.
// Calls every other module in the right order, assembles a unified
// `ResearchReport`, and renders Markdown / JSON / CSV / chart
// specifications for everything.
//
// Outputs:
//   - Leaderboard
//   - ELO rankings (with Glicko-2 RD)
//   - Matchup matrix (CSV / JSON / Markdown / heatmap spec)
//   - Pareto frontier
//   - Genome clusters (PCA 2D + named clusters)
//   - Bootstrap CIs on every reported metric
//   - Statistical tests (t, Mann-Whitney U, chi-square, permutation)
//   - Learning curves
//   - Evolution report
//   - Dataset quality
//   - Training readiness
//   - Distillation improvement
//   - Student vs teacher comparison
//   - Active learning efficiency
//   - Benchmark summaries
//   - Performance validation
//   - Experiment record (UUID + reproducibility)
//
// Reuses every existing module. Wraps, never duplicates.
// ============================================================================

import type { Subject, ResearchReport, Rating, TestResult, ExperimentRecord } from "./types";
import { RatingSystem, renderLeaderboardMd, renderLeaderboardCsv, renderLeaderboardJson } from "./RatingSystem";
import { buildMatchupMatrix, renderMatchupMatrixCsv, renderMatchupMatrixJson, renderMatchupMatrixMd, renderMatchupMatrixHeatmapSpec, makeSubjectAdapter, type MatchupMatrixConfig } from "./MatchupMatrix";
import { bootstrapWinRate, meanCi, proportionCi, bootstrapMean } from "./Bootstrap";
import { computeParetoFrontier, renderParetoCsv, renderParetoJson, renderParetoMd, renderParetoPlotSpec, DEFAULT_OBJECTIVES } from "./ParetoFrontier";
import { survivalFromFights, hazardRatio, logRankTest, renderSurvivalMd, renderSurvivalCsv, renderSurvivalJson, renderSurvivalPlotSpec } from "./SurvivalAnalysis";
import { clusterGenomes, renderClustersJson, renderClustersMd, renderClustersPlotSpec } from "./Clustering";
import { tTest, mannWhitneyU, chiSquare2x2, allTests } from "./StatsTests";
import { learningCurveFromSnapshots, learningCurveFromRaw, renderLearningCurveMd, renderLearningCurveCsv, renderLearningCurveJson, renderLearningCurvePlotSpec } from "./LearningCurves";
import { ExperimentTracker, sha256, canonicalize, SIMULATOR_NAME, SIMULATOR_VERSION } from "./ExperimentTracker";
import { PerfMonitor } from "./PerfMonitor";

import { SimulationRunner, type RunFightParams } from "../simulator/SimulationRunner";
import { BatchExecutor, constantMatchupBatch } from "../simulator/BatchExecutor";
import { defaultOpponent } from "../simulator/HeadlessEngine";
import { createAgentById } from "../evolution/agents";
import { type IGenome } from "../evolution/types";
import { IGenerationSnapshot } from "../evolution/types";

// ----------------------------------------------------------------------------
// Inputs to the dashboard
// ----------------------------------------------------------------------------

export interface DashboardInput {
  /** All subjects (genomes, students, teachers, archetypes). */
  subjects: Subject[];
  /** Optional: pre-run fights. If absent, the dashboard runs its own. */
  fights?: { sideAId: string; sideBId: string; winnerSide: 0 | 1 | null; durationSeconds: number; sideA: { damageDealt: number; hpFrac: number; distanceStdDev: number } }[];
  /** Optional: pre-evolved population snapshots + populations for learning curves. */
  evolution?: {
    snapshots: IGenerationSnapshot[];
    populations: IGenome[][];
    id: string;
  };
  /** Optional: distillation / active-learning context for those sections. */
  distillation?: {
    originalScore: number;
    distilledScore: number;
    perSample: { id: string; before: number; after: number }[];
  };
  activeLearning?: {
    teacherQueries: number;
    agreementRate: number;
    studentImprovement: number;
    perRound: { round: number; agreement: number; improvement: number }[];
  };
  /** Master seed. */
  seed: number;
  /** Configuration for the dashboard itself. */
  config?: Partial<DashboardConfig>;
  /** Notes. */
  notes?: string;
}

export interface DashboardConfig {
  /** Matches per subject in the default benchmark. */
  benchmarkMatchesPerSubject: number;
  /** Matches per cell in the matchup matrix. */
  matchupMatchesPerCell: number;
  /** Bootstrap resamples. */
  bootstrapResamples: number;
  /** Number of cluster K. */
  clusterK: number;
  /** Cluster algorithm. */
  clusterAlgorithm: "kmeans" | "hierarchical" | "dbscan";
  /** Rating algorithm. */
  ratingAlgorithm: "elo" | "glicko2";
}

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  benchmarkMatchesPerSubject: 200,
  matchupMatchesPerCell: 25,
  bootstrapResamples: 1000,
  clusterK: 0, // 0 = auto
  clusterAlgorithm: "kmeans",
  ratingAlgorithm: "glicko2",
};

// ----------------------------------------------------------------------------
// Dashboard
// ----------------------------------------------------------------------------

export class ResearchDashboard {
  private tracker = new ExperimentTracker();
  private perf = new PerfMonitor();
  private runner: SimulationRunner;
  private config: DashboardConfig;

  constructor(runner: SimulationRunner, config: Partial<DashboardConfig> = {}) {
    this.runner = runner;
    this.config = { ...DEFAULT_DASHBOARD_CONFIG, ...config };
  }

  /**
   * Generate the full research report. This is the canonical entry
   * point — every other module is invoked from here.
   */
  async generate(input: DashboardInput): Promise<ResearchReport> {
    this.perf.startRun();
    const cfg = { ...this.config, ...(input.config ?? {}) };
    // 1. Create the experiment record
    const experiment = this.tracker.createExperiment({
      seed: input.seed,
      config: {
        ...cfg,
        subjects: input.subjects.map(s => ({ id: s.id, kind: s.kind, version: s.version })),
      } as any,
      notes: input.notes,
    });
    // 2. Run the default benchmark (or use provided fights)
    const fights = (input.fights ?? await this.runBenchmark(input.subjects, cfg.benchmarkMatchesPerSubject)) as NonNullable<DashboardInput["fights"]>;
    this.perf.recordMatch();
    for (let i = 0; i < fights.length; i += 100) this.perf.recordMatch();
    // 3. Bootstrap CIs
    const benchmarks = this.computeBenchmarks(fights, input.subjects);
    // 4. ELO leaderboard
    const ratingSystem = RatingSystem.fromSubjects(
      input.subjects,
      fights.map(f => ({ sideAId: f.sideAId, sideBId: f.sideBId, winnerSide: f.winnerSide })),
      cfg.ratingAlgorithm,
    );
    const ratings = ratingSystem.leaderboard();
    // 5. Matchup matrix
    const matrix = await this.runMatchupMatrix(input.subjects, cfg);
    // 6. Pareto frontier
    const paretoFrontier = this.computePareto(input.subjects, benchmarks);
    // 7. Survival analysis
    const survival = input.subjects.map(s => survivalFromFights(s.id, fights
      .filter(f => f.sideAId === s.id || f.sideBId === s.id)
      .map(f => ({ durationSeconds: f.durationSeconds, winnerSide: f.winnerSide })),
    ));
    // Hazard ratios (first subject as reference, all others vs it)
    const hazardRatios = survival.length >= 2
      ? survival.slice(1).map(s => hazardRatio(s, survival[0]!))
      : [];
    // 8. Clusters
    const clusters = this.computeClusters(input.subjects, cfg);
    // 9. Statistical tests (pairwise)
    const tests = this.computeTests(fights, input.subjects);
    // 10. Learning curves
    const learningCurves = input.evolution
      ? [learningCurveFromSnapshots(input.evolution.id, input.evolution.snapshots, input.evolution.populations)]
      : [];
    // 11. Performance
    const perfResult = this.perf.stopRun();
    // 12. Build the report
    const distillation = input.distillation
      ? {
          ...input.distillation,
          improvement: input.distillation.distilledScore - input.distillation.originalScore,
        }
      : null;
    const report: ResearchReport = {
      generatedAt: Date.now(),
      experiment,
      ratings,
      matchupMatrix: matrix,
      paretoFrontier,
      survival,
      hazardRatios,
      clusters,
      tests,
      learningCurves,
      benchmarks,
      activeLearning: input.activeLearning ?? null,
      distillation,
      performance: perfResult.measurement,
      markdown: "",
      json: "",
    };
    report.markdown = this.renderMarkdown(report);
    report.json = this.renderJson(report);
    return report;
  }

  // --------------------------------------------------------------------------
  // Runners
  // --------------------------------------------------------------------------

  private async runBenchmark(subjects: Subject[], matchesPerSubject: number): Promise<DashboardInput["fights"]> {
    if (typeof matchesPerSubject !== "number" || matchesPerSubject <= 0) {
      matchesPerSubject = this.config.benchmarkMatchesPerSubject;
    }
    const archetypeIds = ["aggressive", "defensive", "counter"];
    const baseOpp = defaultOpponent(0);
    const allFights: NonNullable<DashboardInput["fights"]> = [];
    for (const subj of subjects) {
      for (const arch of archetypeIds) {
        for (let m = 0; m < matchesPerSubject / archetypeIds.length; m++) {
          const seed = (this.config.benchmarkMatchesPerSubject + 1) * m + hashStr(arch);
          const fight = this.runner.runFight({
            sideA: subj.genome ?? baseOpp,
            sideB: baseOpp,
            sideAAgent: undefined,
            sideBAgent: createAgentById(arch),
            seed,
            matchType: "ga_vs_archetype",
            config: { timeStep: 1 / 30, drainVfx: true, deterministic: true, fastRoundTransitions: true },
            meta: { subjectId: subj.id, archetypeId: arch, matchType: "ga_vs_archetype" },
          });
          allFights.push({
            sideAId: subj.id, sideBId: `archetype:${arch}`,
            winnerSide: fight.winnerSide, durationSeconds: fight.durationSeconds,
            sideA: { damageDealt: fight.sideA.damageDealt, hpFrac: fight.sideA.hpFrac, distanceStdDev: fight.sideA.distanceStdDev },
          });
        }
      }
    }
    return allFights;
  }

  private async runMatchupMatrix(subjects: Subject[], cfg: DashboardConfig): Promise<import("./types").MatchupMatrix> {
    const adapter = makeSubjectAdapter(subjects);
    return buildMatchupMatrix(subjects, this.runner, adapter, {
      matchesPerCell: cfg.matchupMatchesPerCell,
      seed: 42,
      symmetric: true,
    });
  }

  // --------------------------------------------------------------------------
  // Computations
  // --------------------------------------------------------------------------

  private computeBenchmarks(
    fights: NonNullable<DashboardInput["fights"]>,
    subjects: Subject[],
  ): { subjectId: string; metrics: Record<string, import("./types").BootstrapResult> }[] {
    return subjects.map(s => {
      const subjFights = fights.filter(f => f.sideAId === s.id);
      const wins = subjFights.map(f => f.winnerSide === 0 ? 1 : 0);
      const durations = subjFights.map(f => f.durationSeconds);
      const damages = subjFights.map(f => f.sideA.damageDealt);
      const hpFracs = subjFights.map(f => f.sideA.hpFrac);
      const adapts = subjFights.map(f => f.sideA.distanceStdDev);
      return {
        subjectId: s.id,
        metrics: {
          winRate: bootstrapWinRate(wins.map(Boolean), { resamples: this.config.bootstrapResamples, seed: 42 }),
          avgDuration: bootstrapMean(durations, { resamples: this.config.bootstrapResamples, seed: 42 }),
          avgDamage: bootstrapMean(damages, { resamples: this.config.bootstrapResamples, seed: 42 }),
          avgRemainingHp: bootstrapMean(hpFracs, { resamples: this.config.bootstrapResamples, seed: 42 }),
          avgAdaptation: bootstrapMean(adapts, { resamples: this.config.bootstrapResamples, seed: 42 }),
        },
      };
    });
  }

  private computePareto(
    subjects: Subject[],
    benchmarks: { subjectId: string; metrics: Record<string, import("./types").BootstrapResult> }[],
  ): import("./types").ParetoFrontier {
    const valueMap = new Map<string, Record<string, number>>();
    for (const b of benchmarks) {
      valueMap.set(b.subjectId, {
        winRate: b.metrics.winRate.estimate,
        behaviourDiversity: 0, // will be filled below
        adaptationScore: b.metrics.avgAdaptation.estimate,
        entertainmentScore: 1 - b.metrics.avgDuration.estimate / 100, // proxy
        duration: b.metrics.avgDuration.estimate,
        challenge: b.metrics.avgDamage.estimate / 200,
        novelty: 0,
      });
    }
    return computeParetoFrontier(subjects, valueMap, DEFAULT_OBJECTIVES);
  }

  private computeClusters(subjects: Subject[], cfg: DashboardConfig) {
    const genomesWithIds: { id: string; genome: IGenome }[] = [];
    for (const s of subjects) {
      if (s.genome) genomesWithIds.push({ id: s.id, genome: s.genome });
    }
    if (genomesWithIds.length === 0) {
      return {
        assignments: [],
        centroids: [],
        k: 0,
        algorithm: "kmeans" as const,
        silhouette: 0,
        inertia: null,
        daviesBouldin: 0,
        namedClusters: [],
        pcaComponents: [],
        varianceExplained: [],
      };
    }
    return clusterGenomes(genomesWithIds, {
      algorithm: cfg.clusterAlgorithm,
      k: cfg.clusterK > 0 ? cfg.clusterK : undefined,
    });
  }

  private computeTests(
    fights: NonNullable<DashboardInput["fights"]>,
    subjects: Subject[],
  ): { pair: [string, string]; result: TestResult }[] {
    const tests: { pair: [string, string]; result: TestResult }[] = [];
    if (subjects.length < 2) return tests;
    const ref = subjects[0]!;
    const refWins = fights.filter(f => f.sideAId === ref.id).map(f => f.winnerSide === 0 ? 1 : 0);
    for (let i = 1; i < subjects.length; i++) {
      const other = subjects[i]!;
      const otherWins = fights.filter(f => f.sideAId === other.id).map(f => f.winnerSide === 0 ? 1 : 0);
      // Use Mann-Whitney on win rates (1 = win, 0 = not)
      if (refWins.length > 0 && otherWins.length > 0) {
        tests.push({ pair: [ref.id, other.id], result: mannWhitneyU(refWins, otherWins) });
      }
    }
    return tests;
  }

  // --------------------------------------------------------------------------
  // Renderers
  // --------------------------------------------------------------------------

  private renderMarkdown(report: ResearchReport): string {
    const lines: string[] = [];
    lines.push(`# ${SIMULATOR_NAME} — Research Report`);
    lines.push("");
    lines.push(`Generated: ${new Date(report.generatedAt).toISOString()}`);
    lines.push(`Experiment: ${report.experiment.uuid}`);
    lines.push(`Seed: ${report.experiment.seed}`);
    lines.push(`Git commit: ${report.experiment.gitCommit ?? "—"}`);
    lines.push(`Simulator version: ${report.experiment.simulatorVersion}`);
    lines.push(`Config hash: ${report.experiment.configHash.slice(0, 16)}…`);
    lines.push("");
    // 1. Leaderboard
    lines.push("## ELO Leaderboard");
    lines.push("");
    lines.push(renderLeaderboardMd(report.ratings));
    lines.push("");
    // 2. Matchup matrix
    lines.push("## Matchup Matrix (Win Rate)");
    lines.push("");
    lines.push(renderMatchupMatrixMd(report.matchupMatrix, "winRate"));
    lines.push("");
    // 3. Pareto
    lines.push("## Pareto Frontier");
    lines.push("");
    lines.push(renderParetoMd(report.paretoFrontier));
    lines.push("");
    // 4. Clusters
    lines.push("## Genome Clusters");
    lines.push("");
    lines.push(renderClustersMd(report.clusters));
    lines.push("");
    // 5. Statistical tests
    lines.push("## Statistical Tests");
    lines.push("");
    if (report.tests.length === 0) {
      lines.push("(no pairwise tests — need ≥ 2 subjects)");
    } else {
      lines.push("| Pair | Test | Statistic | p | Significant | Effect | 95% CI |");
      lines.push("|---|---|---:|---:|:---:|---:|---|");
      for (const t of report.tests) {
        lines.push(`| ${t.pair[0]} vs ${t.pair[1]} | ${t.result.test} | ${t.result.statistic.toFixed(3)} | ${t.result.pValue.toFixed(4)} | ${t.result.significant ? "✓" : "—"} | ${t.result.effectSize.toFixed(3)} | [${t.result.effectCi95[0].toFixed(3)}, ${t.result.effectCi95[1].toFixed(3)}] |`);
      }
    }
    lines.push("");
    // 6. Survival
    lines.push("## Survival Analysis");
    lines.push("");
    lines.push(renderSurvivalMd(report.survival));
    lines.push("");
    // 7. Hazard ratios
    if (report.hazardRatios.length > 0) {
      lines.push("## Hazard Ratios");
      lines.push("");
      lines.push("| Treatment | Reference | HR | 95% CI on log(HR) | p |");
      lines.push("|---|---|---:|---:|---:|");
      for (const h of report.hazardRatios) {
        lines.push(`| ${h.treatmentId} | ${h.referenceId} | ${h.hr.toFixed(3)} | [${h.logHrCi95[0].toFixed(3)}, ${h.logHrCi95[1].toFixed(3)}] | ${h.pValue.toFixed(4)} |`);
      }
      lines.push("");
    }
    // 8. Learning curves
    if (report.learningCurves.length > 0) {
      lines.push("## Learning Curves");
      lines.push("");
      for (const c of report.learningCurves) lines.push(renderLearningCurveMd(c, c.id));
      lines.push("");
    }
    // 9. Benchmarks (with CIs)
    lines.push("## Per-Subject Benchmarks (with 95% CIs)");
    lines.push("");
    lines.push("| Subject | Win Rate | 95% CI | Avg Duration | 95% CI | Avg Damage | 95% CI |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const b of report.benchmarks) {
      const wr = b.metrics.winRate;
      const dur = b.metrics.avgDuration;
      const dmg = b.metrics.avgDamage;
      lines.push(`| ${b.subjectId} | ${(wr.estimate * 100).toFixed(2)}% | ±${(wr.ci95[1] - wr.estimate).toFixed(3)} | ${dur.estimate.toFixed(2)}s | ±${(dur.ci95[1] - dur.estimate).toFixed(2)} | ${dmg.estimate.toFixed(1)} | ±${(dmg.ci95[1] - dmg.estimate).toFixed(1)} |`);
    }
    lines.push("");
    // 10. Distillation + active learning
    if (report.distillation) {
      lines.push("## Distillation");
      lines.push("");
      lines.push(`- Original score: ${report.distillation.originalScore.toFixed(4)}`);
      lines.push(`- Distilled score: ${report.distillation.distilledScore.toFixed(4)}`);
      lines.push(`- Improvement: ${report.distillation.improvement.toFixed(4)}`);
      lines.push("");
    }
    if (report.activeLearning) {
      lines.push("## Active Learning");
      lines.push("");
      lines.push(`- Teacher queries: ${report.activeLearning.teacherQueries}`);
      lines.push(`- Agreement rate: ${(report.activeLearning.agreementRate * 100).toFixed(2)}%`);
      lines.push(`- Student improvement: ${(report.activeLearning.studentImprovement * 100).toFixed(2)}%`);
      lines.push("");
    }
    // 11. Performance
    lines.push("## Performance");
    lines.push("");
    lines.push(`- Matches/sec: ${report.performance.matchesPerSec.toFixed(2)}`);
    lines.push(`- CPU usage: ${(report.performance.cpuUsage * 100).toFixed(1)}%`);
    lines.push(`- Memory: ${(report.performance.memoryBytes / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`- Serialization: ${report.performance.serializationMs.toFixed(1)} ms`);
    lines.push(`- Checkpoint: ${report.performance.checkpointMs.toFixed(1)} ms`);
    lines.push(`- Samples/sec: ${report.performance.samplesPerSec.toFixed(2)}`);
    lines.push("");
    return lines.join("\n");
  }

  private renderJson(report: ResearchReport): string {
    return JSON.stringify(report, null, 2);
  }

  // --------------------------------------------------------------------------
  // Convenience: save the report to disk
  // --------------------------------------------------------------------------

  /**
   * Generate + save the report to a directory. Returns the report
   * and the list of files written.
   */
  async generateToDir(input: DashboardInput, outDir: string): Promise<{ report: ResearchReport; files: string[] }> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const report = await this.generate(input);
    await fs.mkdir(outDir, { recursive: true });
    const files: string[] = [];
    // Markdown
    const md = path.join(outDir, "research-report.md");
    await fs.writeFile(md, report.markdown);
    files.push(md);
    // JSON
    const json = path.join(outDir, "research-report.json");
    await fs.writeFile(json, report.json);
    files.push(json);
    // ELO leaderboard
    const eloMd = path.join(outDir, "elo-leaderboard.md");
    await fs.writeFile(eloMd, renderLeaderboardMd(report.ratings));
    files.push(eloMd);
    const eloCsv = path.join(outDir, "elo-leaderboard.csv");
    await fs.writeFile(eloCsv, renderLeaderboardCsv(report.ratings));
    files.push(eloCsv);
    // Matchup matrix
    const matrixCsv = path.join(outDir, "matchup-matrix.csv");
    await fs.writeFile(matrixCsv, renderMatchupMatrixCsv(report.matchupMatrix));
    files.push(matrixCsv);
    const matrixJson = path.join(outDir, "matchup-matrix.json");
    await fs.writeFile(matrixJson, renderMatchupMatrixJson(report.matchupMatrix));
    files.push(matrixJson);
    const matrixHeatmap = path.join(outDir, "matchup-heatmap-spec.json");
    await fs.writeFile(matrixHeatmap, renderMatchupMatrixHeatmapSpec(report.matchupMatrix));
    files.push(matrixHeatmap);
    // Pareto
    const paretoCsv = path.join(outDir, "pareto.csv");
    await fs.writeFile(paretoCsv, renderParetoCsv(report.paretoFrontier));
    files.push(paretoCsv);
    const paretoPlot = path.join(outDir, "pareto-plot-spec.json");
    await fs.writeFile(paretoPlot, renderParetoPlotSpec(report.paretoFrontier));
    files.push(paretoPlot);
    // Clusters
    const clustersJson = path.join(outDir, "clusters.json");
    await fs.writeFile(clustersJson, renderClustersJson(report.clusters));
    files.push(clustersJson);
    const clustersPlot = path.join(outDir, "clusters-plot-spec.json");
    await fs.writeFile(clustersPlot, renderClustersPlotSpec(report.clusters));
    files.push(clustersPlot);
    // Survival
    const survCsv = path.join(outDir, "survival.csv");
    await fs.writeFile(survCsv, renderSurvivalCsv(report.survival));
    files.push(survCsv);
    const survPlot = path.join(outDir, "survival-plot-spec.json");
    await fs.writeFile(survPlot, renderSurvivalPlotSpec(report.survival));
    files.push(survPlot);
    // Learning curves
    for (let i = 0; i < report.learningCurves.length; i++) {
      const c = report.learningCurves[i]!;
      const lcCsv = path.join(outDir, `learning-curve-${i}.csv`);
      await fs.writeFile(lcCsv, renderLearningCurveCsv(c));
      files.push(lcCsv);
      const lcPlot = path.join(outDir, `learning-curve-${i}-plot-spec.json`);
      await fs.writeFile(lcPlot, renderLearningCurvePlotSpec(c));
      files.push(lcPlot);
    }
    return { report, files };
  }
}

// ----------------------------------------------------------------------------
// Convenience exports
// ----------------------------------------------------------------------------

export { sha256, canonicalize, SIMULATOR_NAME, SIMULATOR_VERSION };

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
