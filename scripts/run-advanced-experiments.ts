// ============================================================================
// ADVANCED EXPERIMENTS — multi-seed, larger Exp 1, gene trajectories, ablation,
// correlation, and generalization.
//
// Adds the follow-ups on top of scripts/run-experiments.ts:
//   1. Multi-seed runs of Exp 3 (mutation), Exp 4 (selection), Exp 5 (pop size)
//      with mean, std dev, and 95% CI.
//   2. Experiment 1 at 200 fights per matchup (and optionally 500).
//   3. Per-gene trajectories: best genome's gene values at each generation.
//   4. Gene ablation: freeze one gene at a time, evolve the rest, measure
//      fitness drop.
//   5. Correlation: Pearson r between each gene's value and fitness in the
//      final population, compared against the ablation result.
//   6. Generalization: leave-two-out train/test splits + modified-bosses
//      transfer test.
//
// Outputs are written to data/advanced/ and consolidated into
// data/advanced/ADVANCED_RESULTS.md by scripts/generate-advanced-report.ts.
// ============================================================================

import fs from "fs";
import path from "path";
import {
  createRandomOfflineGenome,
  gaussianMutate,
  uniformMutate,
  polynomialMutate,
  tournamentSelect,
  rouletteSelect,
  rankSelect,
  populationDiversity,
  OfflineFitnessEvaluator,
  defaultFitnessWeights,
  HeadlessFightingSimulatorAdapter,
  defaultBaselineOpponents,
  createOfflineGenome,
  uniformCrossover,
  OFFLINE_GENE_KEYS,
  OFFLINE_GENE_SPECS,
  type OfflineGenome,
  type OfflineGeneKey,
  type OfflineGeneMap,
  type EvaluatedGenome,
  type MutationKind,
  type SelectionKind,
} from "../src/lib/game/offline-ga";
import { Rng } from "../src/lib/game/simulator/Rng";
import type { FightResult } from "../src/lib/game/simulator/MatchResult";

const OUT_DIR = path.resolve(process.cwd(), "data", "advanced");
fs.mkdirSync(OUT_DIR, { recursive: true });

// ============================================================================
// Config
// ============================================================================
const SEEDS = [2026, 2027, 2028, 2029, 2030];
const HARD = process.argv.includes("--hard");
const SKIP_500 = process.argv.includes("--skip-500");
const CONFIG = {
  multiSeed: {
    generations: 8,
    matchesPerGenome: 2,
    popSizeForExp34: 30,
    popSizes: [20, 50, 100] as const,
  },
  exp1Fights: 200, // 200 per matchup, ~5 min on this hardware
  exp1FightsLarge: 500, // optional, ~13 min
  trajectory: {
    generations: 15,
    popSize: 50,
    matchesPerGenome: 2,
  },
  ablation: {
    generations: 10,
    popSize: 30,
    matchesPerGenome: 2,
    freezeValue: 0.5, // freeze each gene at this neutral value
  },
};

console.log(`[advanced] seeds=${SEEDS.join(",")} hard=${HARD} skip500=${SKIP_500}`);
console.log(`[advanced] config=${JSON.stringify(CONFIG)}`);

function baselines() {
  const all = defaultBaselineOpponents();
  if (!HARD) return all;
  const keep = new Set(["Crane", "Hermit", "Widow", "Butcher", "Shogun", "Titan"]);
  return all.filter((b) => keep.has(b.opponent.name));
}

/** Build a list of "modified boss" baselines: same opponents, +30% HP, +20% damage, +15% speed. */
function modifiedBosses() {
  return baselines().map((b) => {
    const modified: any = {
      ...b.opponent,
      name: `${b.opponent.name}+`,
      title: `${b.opponent.title} (buffed)`,
      hp: Math.round(b.opponent.hp * 1.3),
      damageMul: (b.opponent.damageMul ?? 0.6) * 1.2,
      speedMul: (b.opponent.speedMul ?? 1.0) * 1.15,
    };
    return { id: `${b.id}_mod`, opponent: modified };
  });
}

/** Build a list of baselines with only the given names. */
function baselineSubset(names: Set<string>) {
  return defaultBaselineOpponents().filter((b) => names.has(b.opponent.name));
}

// ============================================================================
// Core GA loop (shared by all the experiments below)
// ============================================================================
type SelectionMode = SelectionKind;
type MutationMode = MutationKind;

interface GARunOptions {
  seed: number;
  popSize: number;
  generations: number;
  matchesPerGenome: number;
  mutation: MutationMode;
  selection: SelectionMode;
  /** If non-null, this gene is frozen at `freezeValue` (never mutated, always inherited from a frozen copy of the original). */
  frozenGene: OfflineGeneKey | null;
  freezeValue: number;
  /** Record the best genome's genes every generation. */
  recordTrajectory: boolean;
  /** Custom seed for the population initializer (defaults to seed+1). */
  populationSeed?: number;
  /** Optional custom baseline pool (defaults to baselines()). */
  customBaselines?: ReturnType<typeof defaultBaselineOpponents>;
  /** If true, also return every (genome, fitness) pair from the final generation. */
  captureCorrelation?: boolean;
}

interface GARunResult {
  bestFitness: number;
  avgFitness: number;
  diversity: number;
  bestGenome: OfflineGenome;
  bestPerGen: number[];
  avgPerGen: number[];
  divPerGen: number[];
  trajectory: OfflineGeneMap[]; // best genome's gene map per generation
  /** Final-population (gene, fitness) pairs (only set when captureCorrelation is true). */
  finalPopulation?: { genes: OfflineGeneMap; fitness: number }[];
}

function runGA(opts: GARunOptions): GARunResult {
  const rng = new Rng(opts.populationSeed ?? opts.seed);
  const bls = opts.customBaselines ?? baselines();
  const sim = new HeadlessFightingSimulatorAdapter();
  const eval_ = new OfflineFitnessEvaluator(defaultFitnessWeights());

  const initialized: OfflineGenome[] = Array.from({ length: opts.popSize }, () => {
    const g = createRandomOfflineGenome(rng, 0);
    if (opts.frozenGene) {
      g.genes[opts.frozenGene] = opts.freezeValue;
    }
    return g;
  });

  let population: OfflineGenome[] = initialized;
  const bestPerGen: number[] = [];
  const avgPerGen: number[] = [];
  const divPerGen: number[] = [];
  const trajectory: OfflineGeneMap[] = [];

  for (let g = 0; g < opts.generations; g++) {
    const evaluated: EvaluatedGenome[] = population.map((genome) => {
      const fights: FightResult[] = [];
      for (let m = 0; m < opts.matchesPerGenome; m++) {
        const baseline = bls[m % bls.length]!;
        fights.push(sim.fightGenomeVsBaseline({ genome, baseline, seed: rng.int(0, 1_000_000) }));
      }
      return eval_.evaluate(genome, fights, 0);
    });
    evaluated.sort((a, b) => b.fitness - a.fitness);
    const best = evaluated[0]!;
    const avg = evaluated.reduce((s, e) => s + e.fitness, 0) / evaluated.length;
    bestPerGen.push(best.fitness);
    avgPerGen.push(avg);
    divPerGen.push(populationDiversity(population));
    trajectory.push({ ...best.genome.genes });
    if (opts.frozenGene) {
      // Re-pin the frozen gene in the *current best* for trajectory honesty
      trajectory[trajectory.length - 1]![opts.frozenGene] = opts.freezeValue;
    }

    // Elitism + selection + crossover + mutation
    const eliteCount = Math.max(1, Math.floor(opts.popSize * 0.2));
    const elite = evaluated.slice(0, eliteCount).map((e) => e.genome);
    if (opts.frozenGene) {
      for (const e of elite) e.genes[opts.frozenGene] = opts.freezeValue;
    }
    const next: OfflineGenome[] = [...elite];
    let safety = 0;
    while (next.length < opts.popSize) {
      safety++;
      if (safety > opts.popSize * 20) throw new Error("breeding loop runaway");
      let aGenome: OfflineGenome;
      let bGenome: OfflineGenome;
      if (opts.selection === "tournament") {
        aGenome = tournamentSelect(evaluated, rng, 3);
        bGenome = tournamentSelect(evaluated, rng, 3);
      } else if (opts.selection === "roulette") {
        aGenome = rouletteSelect(evaluated, rng);
        bGenome = rouletteSelect(evaluated, rng);
      } else {
        aGenome = rankSelect(evaluated, rng, 1.7);
        bGenome = rankSelect(evaluated, rng, 1.7);
      }
      const child = uniformCrossover(aGenome, bGenome, g + 1, rng);
      // Mutation, skipping the frozen gene
      const mut = opts.mutation === "gaussian"
        ? gaussianMutate(child, g + 1, rng, 0.12, 0.1)
        : opts.mutation === "uniform"
          ? uniformMutate(child, g + 1, rng, 0.15, 0.2)
          : polynomialMutate(child, g + 1, rng, 0.12, 0.1, 20);
      if (opts.frozenGene) {
        mut.genome.genes[opts.frozenGene] = opts.freezeValue;
      }
      next.push(mut.genome);
    }
    population = next;
  }
  let finalPopulation: { genes: OfflineGeneMap; fitness: number }[] | undefined;
  if (opts.captureCorrelation) {
    // Re-evaluate the final population to get fresh fitness values for correlation
    const evals: EvaluatedGenome[] = population.map((genome) => {
      const fights: FightResult[] = [];
      for (let m = 0; m < opts.matchesPerGenome * 2; m++) {
        const baseline = bls[m % bls.length]!;
        fights.push(sim.fightGenomeVsBaseline({ genome, baseline, seed: rng.int(0, 1_000_000) }));
      }
      return eval_.evaluate(genome, fights, 0);
    });
    finalPopulation = evals.map((e) => ({ genes: { ...e.genome.genes }, fitness: e.fitness }));
  }

  return {
    bestFitness: bestPerGen.at(-1)!,
    avgFitness: avgPerGen.at(-1)!,
    diversity: divPerGen.at(-1)!,
    bestGenome: { ...population[0]!, genes: trajectory.at(-1)! },
    bestPerGen,
    avgPerGen,
    divPerGen,
    trajectory,
    finalPopulation,
  };
}

// ============================================================================
// Experiment 1 — Baseline AI vs GA AI, large sample
// ============================================================================
function loadBestChampion(): OfflineGenome {
  const p = path.resolve(process.cwd(), "best_genome.json");
  if (fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return createOfflineGenome(data.genome as OfflineGeneMap, 99, "checkpoint", []);
  }
  return createRandomOfflineGenome(new Rng(42), 0);
}

interface FightRecord {
  winner: "subject" | "opponent" | "draw";
  damageDealt: number;
  damageTaken: number;
  durationSec: number;
  roundsWon: number;
  rounds: number;
}

async function experiment1(fightsPerMatchup: number, tag: string) {
  console.log(`\n[exp1:${tag}] Baseline AI vs GA AI — ${fightsPerMatchup} fights/matchup`);
  const champion = loadBestChampion();
  const baselineGenome: OfflineGenome = createOfflineGenome(
    {
      aggression: 0.5, defensePriority: 0.5, dodgeProbability: 0.35,
      counterAttackTendency: 0.45, comboContinuationThreshold: 0.5,
      blockFrequency: 0.4, punishWindow: 0.45, riskTolerance: 0.5,
      distancePreference: 0.5, jumpFrequency: 0.25, projectileUsage: 0.2,
      ultimateUsageThreshold: 0.65,
    },
    0, "initial", [],
  );
  const sim = new HeadlessFightingSimulatorAdapter();
  const bls = baselines();
  const start = Date.now();
  const baseRecords: FightRecord[] = [];
  const gaRecords: FightRecord[] = [];
  for (let oi = 0; oi < bls.length; oi++) {
    const baseline = bls[oi]!;
    for (let f = 0; f < fightsPerMatchup; f++) {
      const seed = 1000 + oi * 1000 + f;
      const a = sim.fightGenomeVsBaseline({ genome: baselineGenome, baseline, seed });
      const b = sim.fightGenomeVsBaseline({ genome: champion, baseline, seed });
      const winA = a.winnerSide === 0 ? "subject" : a.winnerSide === null ? "draw" : "opponent";
      const winB = b.winnerSide === 0 ? "subject" : b.winnerSide === null ? "draw" : "opponent";
      baseRecords.push({
        winner: winA, damageDealt: a.sideA.damageDealt, damageTaken: a.sideA.damageTaken,
        durationSec: a.durationSeconds, roundsWon: a.sideA.roundsWon, rounds: a.rounds.length,
      });
      gaRecords.push({
        winner: winB, damageDealt: b.sideA.damageDealt, damageTaken: b.sideA.damageTaken,
        durationSec: b.durationSeconds, roundsWon: b.sideA.roundsWon, rounds: b.rounds.length,
      });
    }
  }
  const elapsed = (Date.now() - start) / 1000;
  const summarize = (recs: FightRecord[]) => {
    const n = recs.length;
    const wins = recs.filter((r) => r.winner === "subject").length;
    const sum = (k: keyof FightRecord) => recs.reduce((a, r) => a + (r[k] as number), 0);
    return {
      n,
      winRate: wins / n,
      lossRate: recs.filter((r) => r.winner === "opponent").length / n,
      avgDamageDealt: sum("damageDealt") / n,
      avgDamageTaken: sum("damageTaken") / n,
      avgDurationSec: sum("durationSec") / n,
      avgRoundsWon: sum("roundsWon") / n,
      avgRounds: sum("rounds") / n,
    };
  };
  const baseSum = summarize(baseRecords);
  const gaSum = summarize(gaRecords);
  // 95% CI for difference in win rates
  const z = (p1: number, n1: number, p2: number, n2: number) => {
    const pp = (p1 * n1 + p2 * n2) / (n1 + n2);
    const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2));
    if (se === 0) return { z: 0, p: 1, ci: [0, 0] };
    const zv = (p2 - p1) / se;
    const p = 2 * (1 - normalCdf(Math.abs(zv)));
    return { z: zv, p, ci: [p2 - p1 - 1.96 * se, p2 - p1 + 1.96 * se] };
  };
  const t = z(baseSum.winRate, baseSum.n, gaSum.winRate, gaSum.n);
  console.log(`[exp1:${tag}] base=${(baseSum.winRate * 100).toFixed(1)}% ga=${(gaSum.winRate * 100).toFixed(1)}% Δ=${((gaSum.winRate - baseSum.winRate) * 100).toFixed(1)}pp z=${t.z.toFixed(2)} p=${t.p.toExponential(2)} (${elapsed.toFixed(0)}s)`);
  return { tag, fightsPerMatchup, n: baseSum.n, baseline: baseSum, ga: gaSum, test: t, elapsedSec: elapsed };
}

function normalCdf(x: number) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const pp = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + pp * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

// ============================================================================
// Multi-seed runs of Exp 3, 4, 5
// ============================================================================
function meanStdCi(values: number[]) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, ci95: [0, 0], n: 0 };
  const m = values.reduce((a, b) => a + b, 0) / n;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1);
  const std = Math.sqrt(v);
  // Use t-distribution approximation for small n (n<=30): t ≈ 2.776 for df=4 (5 samples)
  // For n=5 (df=4), t_0.025,4 = 2.776
  const tCrit = n <= 5 ? 2.776 : n <= 10 ? 2.262 : n <= 30 ? 2.045 : 1.96;
  const halfWidth = tCrit * std / Math.sqrt(n);
  return { mean: m, std, ci95: [m - halfWidth, m + halfWidth], n };
}

function multiSeed<T extends string>(label: string, kind: T, runner: (seed: number) => number, out: Record<string, any>) {
  console.log(`\n[multi-seed] ${label} (${kind})`);
  const values = SEEDS.map((s) => runner(s));
  const stats = meanStdCi(values);
  const perSeed = SEEDS.map((s, i) => ({ seed: s, value: values[i]! }));
  console.log(`[multi-seed] ${label}: mean=${stats.mean.toFixed(4)} std=${stats.std.toFixed(4)} CI=[${stats.ci95[0].toFixed(4)}, ${stats.ci95[1].toFixed(4)}]`);
  out[kind] = { label, perSeed, ...stats };
  return stats;
}

function experimentMultiSeed() {
  const out: Record<string, any> = {};
  // Exp 3 — mutation
  const mut: MutationKind[] = ["gaussian", "uniform", "polynomial"];
  for (const op of mut) {
    multiSeed(`Mutation=${op}`, `mut_${op}`, (seed) => {
      const r = runGA({
        seed, popSize: CONFIG.multiSeed.popSizeForExp34,
        generations: CONFIG.multiSeed.generations, matchesPerGenome: CONFIG.multiSeed.matchesPerGenome,
        mutation: op, selection: "tournament", frozenGene: null, freezeValue: 0.5, recordTrajectory: false,
      });
      return r.bestFitness;
    }, out);
  }
  // Exp 4 — selection
  const sel: SelectionKind[] = ["tournament", "roulette", "rank"];
  for (const op of sel) {
    multiSeed(`Selection=${op}`, `sel_${op}`, (seed) => {
      const r = runGA({
        seed, popSize: CONFIG.multiSeed.popSizeForExp34,
        generations: CONFIG.multiSeed.generations, matchesPerGenome: CONFIG.multiSeed.matchesPerGenome,
        mutation: "gaussian", selection: op, frozenGene: null, freezeValue: 0.5, recordTrajectory: false,
      });
      return r.bestFitness;
    }, out);
  }
  // Exp 5 — pop size
  for (const pop of CONFIG.multiSeed.popSizes) {
    multiSeed(`PopSize=${pop}`, `pop_${pop}`, (seed) => {
      const r = runGA({
        seed, popSize: pop,
        generations: CONFIG.multiSeed.generations, matchesPerGenome: CONFIG.multiSeed.matchesPerGenome,
        mutation: "gaussian", selection: "tournament", frozenGene: null, freezeValue: 0.5, recordTrajectory: false,
      });
      return r.bestFitness;
    }, out);
  }
  fs.writeFileSync(path.join(OUT_DIR, "multi_seed.json"), JSON.stringify(out, null, 2));
  return out;
}

// ============================================================================
// Gene trajectory — multi-seed (5 seeds), record best genome's genes per gen
// ============================================================================
function experimentTrajectory() {
  console.log(`\n[trajectory] recording per-gene trajectories (5 seeds)`);
  const allCurves: Record<number, OfflineGeneMap[]> = {}; // gene key -> array of mean curves per seed
  const bestPerGenSeeds: number[][] = [];
  const divPerGenSeeds: number[][] = [];
  for (const seed of SEEDS) {
    const r = runGA({
      seed,
      popSize: CONFIG.trajectory.popSize,
      generations: CONFIG.trajectory.generations,
      matchesPerGenome: CONFIG.trajectory.matchesPerGenome,
      mutation: "gaussian", selection: "tournament",
      frozenGene: null, freezeValue: 0.5,
      recordTrajectory: true,
    });
    bestPerGenSeeds.push(r.bestPerGen);
    divPerGenSeeds.push(r.divPerGen);
    for (const g of OFFLINE_GENE_KEYS) {
      if (!allCurves[g]) allCurves[g] = [];
      allCurves[g]!.push(r.trajectory.map((t) => t[g]!));
    }
  }
  // Aggregate per-generation stats per gene
  const perGene = OFFLINE_GENE_KEYS.map((k) => {
    const seedCurves = allCurves[k]!;
    const generations = seedCurves[0]!.length;
    const meanCurve: number[] = [];
    const loCurve: number[] = [];
    const hiCurve: number[] = [];
    const stdCurve: number[] = [];
    for (let g = 0; g < generations; g++) {
      const vals = seedCurves.map((c) => c[g]!);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const s = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, vals.length - 1));
      const hw = 2.776 * s / Math.sqrt(vals.length); // t_0.025,4
      meanCurve.push(m);
      stdCurve.push(s);
      loCurve.push(m - hw);
      hiCurve.push(m + hw);
    }
    const start = meanCurve[0]!;
    const end = meanCurve.at(-1)!;
    return {
      key: k,
      description: OFFLINE_GENE_SPECS.find((s) => s.key === k)?.description ?? "",
      start, end,
      delta: end - start,
      min: Math.min(...meanCurve),
      max: Math.max(...meanCurve),
      direction: end > start + 0.05 ? "increased" : end < start - 0.05 ? "decreased" : "stable",
      meanCurve,
      stdCurve,
      loCurve,
      hiCurve,
    };
  });
  // Aggregate best/diversity across seeds
  const aggregateCurve = (arrs: number[][]) => {
    const gens = arrs[0]!.length;
    return Array.from({ length: gens }, (_, g) => {
      const vals = arrs.map((a) => a[g]!);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const s = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, vals.length - 1));
      return { mean: m, std: s, lo: m - 2.776 * s / Math.sqrt(vals.length), hi: m + 2.776 * s / Math.sqrt(vals.length) };
    });
  };
  const out = {
    bestPerGen: aggregateCurve(bestPerGenSeeds),
    divPerGen: aggregateCurve(divPerGenSeeds),
    perGene,
  };
  fs.writeFileSync(path.join(OUT_DIR, "trajectory.json"), JSON.stringify(out, null, 2));
  console.log(`[trajectory] wrote ${OUT_DIR}/trajectory.json`);
  return out;
}

// ============================================================================
// Gene ablation — freeze one gene, evolve the rest, measure fitness drop
// ============================================================================
function experimentAblation() {
  console.log(`\n[ablation] freezing one gene at a time, evolving the rest`);
  // Control: unrestricted GA, averaged across the same seeds
  const controlValues = SEEDS.map((seed) => {
    const r = runGA({
      seed, popSize: CONFIG.ablation.popSize,
      generations: CONFIG.ablation.generations, matchesPerGenome: CONFIG.ablation.matchesPerGenome,
      mutation: "gaussian", selection: "tournament",
      frozenGene: null, freezeValue: 0.5, recordTrajectory: false,
    });
    return r.bestFitness;
  });
  const controlStats = meanStdCi(controlValues);
  console.log(`[ablation] control: mean=${controlStats.mean.toFixed(4)} std=${controlStats.std.toFixed(4)}`);

  const perGene = OFFLINE_GENE_KEYS.map((key) => {
    const values = SEEDS.map((seed) => {
      const r = runGA({
        seed, popSize: CONFIG.ablation.popSize,
        generations: CONFIG.ablation.generations, matchesPerGenome: CONFIG.ablation.matchesPerGenome,
        mutation: "gaussian", selection: "tournament",
        frozenGene: key, freezeValue: CONFIG.ablation.freezeValue, recordTrajectory: false,
      });
      return r.bestFitness;
    });
    const stats = meanStdCi(values);
    const drop = controlStats.mean - stats.mean;
    const dropRel = drop / Math.max(1e-9, controlStats.mean);
    return {
      key,
      description: OFFLINE_GENE_SPECS.find((s) => s.key === key)?.description ?? "",
      controlMean: controlStats.mean,
      controlStd: controlStats.std,
      frozenMean: stats.mean,
      frozenStd: stats.std,
      drop,
      dropRel,
      frozenPerSeed: SEEDS.map((s, i) => ({ seed: s, value: values[i]! })),
    };
  });
  perGene.sort((a, b) => b.dropRel - a.dropRel);
  const out = { control: controlStats, perGene };
  fs.writeFileSync(path.join(OUT_DIR, "ablation.json"), JSON.stringify(out, null, 2));
  console.log(`[ablation] wrote ${OUT_DIR}/ablation.json`);
  return out;
}

// ============================================================================
// Experiment 6 — Correlation analysis
// For each gene, compute Pearson r between gene value and fitness across all
// individuals in the *final* population of a converged GA. Then compare to
// the ablation result for the same gene.
//
// Interpretation:
//   high |r|  + high ablation drop  -> both correlated AND causal (the gene's
//                                       value really matters AND the GA learned
//                                       to tune it correctly)
//   high |r|  + low  ablation drop  -> correlated but not causal (the GA tuned
//                                       it, but it didn't really matter; could
//                                       be a free-rider on a correlated gene)
//   low  |r|  + high ablation drop  -> uncorrelated but causal (the gene
//                                       matters, but the GA didn't reliably
//                                       find good values for it; this is a
//                                       tell-tale sign of a multi-modal fitness
//                                       landscape where the GA is stuck in a
//                                       suboptimal basin)
//   low  |r|  + low  ablation drop  -> neither: the gene doesn't matter and the
//                                       GA ignores it
// ============================================================================
function pearson(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return { r: 0, p: 1 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  if (den === 0) return { r: 0, p: 1 };
  const r = num / den;
  // Two-tailed p-value via t-distribution approximation
  const t = r * Math.sqrt((n - 2) / Math.max(1e-9, 1 - r * r));
  const p = 2 * (1 - normalCdf(Math.abs(t)));
  return { r, p };
}

function experimentCorrelation() {
  console.log(`\n[correlation] running 5 GA seeds with population capture`);
  const perSeed: any[] = [];
  // Aggregate (gene, fitness) pairs across all seeds
  const allGenes: Record<string, number[]> = {};
  const allFitness: number[] = [];
  for (const key of OFFLINE_GENE_KEYS) allGenes[key] = [];

  for (const seed of SEEDS) {
    const r = runGA({
      seed, popSize: CONFIG.ablation.popSize,
      generations: CONFIG.ablation.generations, matchesPerGenome: CONFIG.ablation.matchesPerGenome,
      mutation: "gaussian", selection: "tournament",
      frozenGene: null, freezeValue: 0.5, recordTrajectory: false,
      captureCorrelation: true,
    });
    if (!r.finalPopulation) throw new Error("captureCorrelation did not return data");
    const n = r.finalPopulation.length;
    const fitness = r.finalPopulation.map((p) => p.fitness);
    const perGene: Record<string, { r: number; p: number; meanGene: number; stdGene: number }> = {};
    for (const key of OFFLINE_GENE_KEYS) {
      const xs = r.finalPopulation.map((p) => p.genes[key]!);
      const corr = pearson(xs, fitness);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const s = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
      perGene[key] = { r: corr.r, p: corr.p, meanGene: m, stdGene: s };
      allGenes[key]!.push(...xs);
    }
    allFitness.push(...fitness);
    perSeed.push({ seed, n, perGene });
    console.log(`[correlation] seed=${seed} n=${n} best_fit=${r.bestFitness.toFixed(4)}`);
  }
  // Pooled Pearson r across all seeds
  const pooledPerGene = OFFLINE_GENE_KEYS.map((key) => {
    const corr = pearson(allGenes[key]!, allFitness);
    const xs = allGenes[key]!;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const s = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
    return { key, r: corr.r, p: corr.p, meanGene: m, stdGene: s, n: xs.length };
  });
  pooledPerGene.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const out = { perSeed, pooledPerGene };
  fs.writeFileSync(path.join(OUT_DIR, "correlation.json"), JSON.stringify(out, null, 2));
  console.log(`[correlation] wrote ${OUT_DIR}/correlation.json`);
  return out;
}

// ============================================================================
// Experiment 7 — Generalization
// Train on 4 of 6 hard opponents, evaluate the champion on the 2 held-out.
// We do this for 3 different (train, test) splits and 3 seeds each.
//
// Then a "modified bosses" transfer test: train on the 6 original hard
// opponents, evaluate on 6 +30%HP/+20%dmg/+15%speed stat-buffed variants.
// ============================================================================
function evaluateGenomeAgainstBaselines(genome: OfflineGenome, baselines: ReturnType<typeof defaultBaselineOpponents>, fightsPerBaseline: number) {
  const sim = new HeadlessFightingSimulatorAdapter();
  const rng = new Rng(42);
  let wins = 0, total = 0, totalDmgDealt = 0, totalDmgTaken = 0;
  for (const baseline of baselines) {
    for (let f = 0; f < fightsPerBaseline; f++) {
      const seed = 1000 + baseline.id.length * 7 + f;
      const r = sim.fightGenomeVsBaseline({ genome, baseline, seed });
      if (r.winnerSide === 0) wins++;
      total++;
      totalDmgDealt += r.sideA.damageDealt;
      totalDmgTaken += r.sideA.damageTaken;
    }
  }
  return { winRate: wins / total, fights: total, avgDamageDealt: totalDmgDealt / total, avgDamageTaken: totalDmgTaken / total };
}

function experimentGeneralization() {
  console.log(`\n[generalization] leave-two-out + modified-bosses`);
  const hardNames = ["Crane", "Hermit", "Widow", "Butcher", "Shogun", "Titan"];
  // Pick 3 splits that cover diverse held-out difficulties
  const splits = [
    { train: new Set(["Crane", "Widow", "Butcher", "Shogun"]), test: new Set(["Hermit", "Titan"]) },
    { train: new Set(["Hermit", "Widow", "Butcher", "Titan"]), test: new Set(["Crane", "Shogun"]) },
    { train: new Set(["Crane", "Hermit", "Butcher", "Shogun"]), test: new Set(["Widow", "Titan"]) },
  ];
  const splitResults: any[] = [];
  for (let si = 0; si < splits.length; si++) {
    const split = splits[si]!;
    const trainBls = baselineSubset(split.train);
    const testBls = baselineSubset(split.test);
    console.log(`[generalization] split ${si + 1}: train=${[...split.train].join("+")} test=${[...split.test].join("+")}`);
    // For each seed: train a GA, evaluate champion on train + test
    const perSeed = SEEDS.slice(0, 3).map((seed) => {
      const r = runGA({
        seed, popSize: 25, generations: 8, matchesPerGenome: 2,
        mutation: "gaussian", selection: "tournament",
        frozenGene: null, freezeValue: 0.5, recordTrajectory: false,
        customBaselines: trainBls,
      });
      const trainEval = evaluateGenomeAgainstBaselines(r.bestGenome, trainBls, 20);
      const testEval = evaluateGenomeAgainstBaselines(r.bestGenome, testBls, 20);
      // Also evaluate a random genome on the same sets as a baseline
      const rng = new Rng(seed);
      const randomGenome = createRandomOfflineGenome(rng, 0);
      const randomTrain = evaluateGenomeAgainstBaselines(randomGenome, trainBls, 20);
      const randomTest = evaluateGenomeAgainstBaselines(randomGenome, testBls, 20);
      console.log(`[generalization]   seed=${seed} trainFit=${r.bestFitness.toFixed(3)} train=${(trainEval.winRate * 100).toFixed(0)}% test=${(testEval.winRate * 100).toFixed(0)}%  randomTrain=${(randomTrain.winRate * 100).toFixed(0)}% randomTest=${(randomTest.winRate * 100).toFixed(0)}%`);
      return { seed, trainFitness: r.bestFitness, trainEval, testEval, randomTrain, randomTest };
    });
    const avg = (key: keyof typeof perSeed[0], subkey: string) => {
      const vals = perSeed.map((p) => (p[key] as any)[subkey]);
      return meanStdCi(vals);
    };
    splitResults.push({
      split: si + 1,
      trainOpponents: [...split.train],
      testOpponents: [...split.test],
      perSeed,
      trainWinRate: avg("trainEval", "winRate"),
      testWinRate: avg("testEval", "winRate"),
      randomTrainWinRate: avg("randomTrain", "winRate"),
      randomTestWinRate: avg("randomTest", "winRate"),
      trainDmgTaken: avg("trainEval", "avgDamageTaken"),
      testDmgTaken: avg("testEval", "avgDamageTaken"),
    });
  }

  // ----- Modified bosses transfer test -----
  console.log(`[generalization] modified-bosses transfer test`);
  const originalBls = baselines();
  const modified = modifiedBosses();
  const modifiedPerSeed = SEEDS.slice(0, 3).map((seed) => {
    // Train on the originals
    const r = runGA({
      seed, popSize: 25, generations: 8, matchesPerGenome: 2,
      mutation: "gaussian", selection: "tournament",
      frozenGene: null, freezeValue: 0.5, recordTrajectory: false,
      customBaselines: originalBls,
    });
    // Evaluate the original-trained champion on the modified bosses
    const onModified = evaluateGenomeAgainstBaselines(r.bestGenome, modified, 20);
    // Also evaluate a random champion on the modified bosses as a baseline
    const rng = new Rng(seed);
    const randomGenome = createRandomOfflineGenome(rng, 0);
    const randomOnModified = evaluateGenomeAgainstBaselines(randomGenome, modified, 20);
    console.log(`[generalization]   seed=${seed} trainFit=${r.bestFitness.toFixed(3)} onModified=${(onModified.winRate * 100).toFixed(0)}%  randomOnModified=${(randomOnModified.winRate * 100).toFixed(0)}%`);
    return { seed, trainFitness: r.bestFitness, onModified, randomOnModified };
  });
  const modAvg = (key: string, subkey: string) => {
    const vals = modifiedPerSeed.map((p) => (p[key] as any)[subkey]);
    return meanStdCi(vals);
  };
  const modifiedResult = {
    perSeed: modifiedPerSeed,
    trainedOnModifiedWinRate: modAvg("onModified", "winRate"),
    randomOnModifiedWinRate: modAvg("randomOnModified", "winRate"),
  };

  const out = { splits: splitResults, modifiedBosses: modifiedResult };
  fs.writeFileSync(path.join(OUT_DIR, "generalization.json"), JSON.stringify(out, null, 2));
  console.log(`[generalization] wrote ${OUT_DIR}/generalization.json`);
  return out;
}

// ============================================================================
// Driver
// ============================================================================
async function main() {
  const t0 = Date.now();
  const results: any = {};

  // Exp 1 at 200 fights
  results.exp1_200 = await experiment1(CONFIG.exp1Fights, "n200");
  if (!SKIP_500) {
    results.exp1_500 = await experiment1(CONFIG.exp1FightsLarge, "n500");
  }

  // Multi-seed
  results.multi_seed = experimentMultiSeed();

  // Trajectory
  results.trajectory = experimentTrajectory();

  // Ablation
  results.ablation = experimentAblation();

  // Correlation (5 seeds × pop 30, final-population capture)
  results.correlation = experimentCorrelation();

  // Generalization (3 splits × 3 seeds, plus modified-bosses transfer)
  results.generalization = experimentGeneralization();

  fs.writeFileSync(path.join(OUT_DIR, "all_advanced.json"), JSON.stringify(results, null, 2));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[advanced] DONE in ${elapsed}s. Outputs in ${OUT_DIR}`);
}

main().catch((e) => {
  console.error("[advanced] FAILED:", e);
  process.exit(1);
});
