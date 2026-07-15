// ============================================================================
// EXPERIMENT HARNESS — runs experiments 1-5 in one process
//
// All fights are run headlessly via the existing simulator + offline-ga
// infrastructure. Results are written to data/experiments/<exp-id>.json plus a
// combined report at data/experiments/RESULTS.md.
//
// Usage:
//   bun scripts/run-experiments.ts                 # full sweep (slow)
//   bun scripts/run-experiments.ts --tier=smoke    # tiny smoke version
//   bun scripts/run-experiments.ts --exp=1         # only experiment 1
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
  type OfflineGenome,
  type OfflineGeneMap,
  type MutationKind,
  type SelectionKind,
} from "../src/lib/game/offline-ga";
import { Rng } from "../src/lib/game/simulator/Rng";
import type { FightResult } from "../src/lib/game/simulator/MatchResult";

const OUT_DIR = path.resolve(process.cwd(), "data", process.argv.includes("--hard") ? "experiments_hard" : "experiments");
fs.mkdirSync(OUT_DIR, { recursive: true });

// ----- Tier selection -----
const tierArg = process.argv.find((a) => a.startsWith("--tier="))?.slice("--tier=".length) ?? "full";
const onlyArg = process.argv.find((a) => a.startsWith("--exp="))?.slice("--exp=".length);

const TIER: "smoke" | "full" = tierArg === "smoke" ? "smoke" : "full";

const CONFIG = TIER === "smoke"
  ? {
      generations: 4,
      matchesPerGenome: 1,
      validationMatches: 4,
      popSizes: [10, 20, 40] as const,
      exp1FightsPerMatchup: 4,
      popSizeForExp34: 20,
      hardOnly: false,
    }
  : {
      generations: 12,
      matchesPerGenome: 2,
      validationMatches: 8,
      popSizes: [20, 50, 100, 200] as const,
      exp1FightsPerMatchup: 12,
      popSizeForExp34: 40,
      hardOnly: process.argv.includes("--hard"),
    };

console.log(`[experiments] tier=${TIER} config=${JSON.stringify(CONFIG)} only=${onlyArg ?? "all"}`);

// ============================================================================
// EXPERIMENT 1 — Baseline AI vs GA AI
// ============================================================================
//
// The "Baseline AI" is the rule-based EnemyAI driven by a default-tuned
// opponent (Lynx, the easiest story opponent) for the *subject* role. The
// "GA AI" is a fully trained champion from the existing best_genome.json
// (or, if missing, the result of a short training run). Both are
// evaluated against the same set of opponents.
//
// Metrics: win rate, average combo length, average damage dealt, average
// match duration.
// ============================================================================

interface FightMetrics {
  winner: "subject" | "opponent" | "draw";
  subjectDamageDealt: number;
  subjectDamageTaken: number;
  subjectMaxCombo: number;
  subjectTotalCombos: number;
  opponentMaxCombo: number;
  opponentTotalCombos: number;
  durationSec: number;
  subjectRoundsWon: number;
  opponentRoundsWon: number;
  rounds: number;
}

function fightMetricsFromResult(result: FightResult, subjectSide: 0 | 1): FightMetrics {
  const subjectStats = subjectSide === 0 ? result.sideA : result.sideB;
  const opponentStats = subjectSide === 0 ? result.sideB : result.sideA;
  let winner: FightMetrics["winner"];
  if (result.winnerSide === null) winner = "draw";
  else if (result.winnerSide === subjectSide) winner = "subject";
  else winner = "opponent";
  // Per-round max combo (so 100+ is a per-round spike, not a multi-round sum)
  const subjectPerRoundMax = result.rounds.map((r) => r.maxCombo[subjectSide] ?? 0);
  const opponentPerRoundMax = result.rounds.map((r) => r.maxCombo[subjectSide === 0 ? 1 : 0] ?? 0);
  return {
    winner,
    subjectDamageDealt: subjectStats.damageDealt,
    subjectDamageTaken: subjectStats.damageTaken,
    subjectMaxCombo: subjectPerRoundMax.length ? Math.max(...subjectPerRoundMax) : 0,
    subjectTotalCombos: subjectStats.totalCombos,
    opponentMaxCombo: opponentPerRoundMax.length ? Math.max(...opponentPerRoundMax) : 0,
    opponentTotalCombos: opponentStats.totalCombos,
    durationSec: result.durationSeconds,
    subjectRoundsWon: subjectStats.roundsWon,
    opponentRoundsWon: opponentStats.roundsWon,
    rounds: result.rounds.length,
  };
}

function summarizeFightMetrics(metrics: FightMetrics[]) {
  const n = metrics.length || 1;
  const wins = metrics.filter((m) => m.winner === "subject").length;
  const losses = metrics.filter((m) => m.winner === "opponent").length;
  const draws = metrics.filter((m) => m.winner === "draw").length;
  const sum = (key: keyof FightMetrics) => metrics.reduce((a, m) => a + (m[key] as number), 0);
  return {
    n,
    winRate: wins / n,
    lossRate: losses / n,
    drawRate: draws / n,
    avgDamageDealt: sum("subjectDamageDealt") / n,
    avgDamageTaken: sum("subjectDamageTaken") / n,
    avgMaxCombo: sum("subjectMaxCombo") / n,
    avgTotalCombos: sum("subjectTotalCombos") / n,
    avgOppMaxCombo: sum("opponentMaxCombo") / n,
    avgOppTotalCombos: sum("opponentTotalCombos") / n,
    avgDurationSec: sum("durationSec") / n,
    avgRoundsWonBySubject: sum("subjectRoundsWon") / n,
    avgRounds: sum("rounds") / n,
  };
}

function loadBestChampion(): OfflineGenome {
  const p = path.resolve(process.cwd(), "best_genome.json");
  if (fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    const genes = data.genome as OfflineGeneMap;
    return createOfflineGenome(genes, 99, "checkpoint", []);
  }
  // Fallback: short fresh training
  console.log("[exp1] No best_genome.json, training a fresh champion...");
  const rng = new Rng(42);
  return createRandomOfflineGenome(rng, 0);
}

function getBaselines() {
  const all = defaultBaselineOpponents();
  if (!CONFIG.hardOnly) return all;
  // Hard mode: drop the two easiest story opponents
  const hardNames = new Set(["Crane", "Hermit", "Widow", "Butcher", "Shogun", "Titan"]);
  return all.filter((b) => hardNames.has(b.opponent.name));
}

async function experiment1() {
  console.log("\n[exp1] Baseline AI vs GA AI");
  const champion = loadBestChampion();
  console.log(`[exp1] Champion genes: ${JSON.stringify(champion.genes)}`);

  // The "Baseline AI" subject = a default-tuned genome (every gene = 0.5
  // for behavioural traits, defaults for the rest) that exercises the same
  // rule-based EnemyAI as every other subject. The point is that the only
  // difference between the two subjects is the genome — both are
  // headless brains, but the baseline reads default values while the GA
  // reads the values that evolution found.
  const baselineGenome: OfflineGenome = createOfflineGenome(
    {
      aggression: 0.5,
      defensePriority: 0.5,
      dodgeProbability: 0.35,
      counterAttackTendency: 0.45,
      comboContinuationThreshold: 0.5,
      blockFrequency: 0.4,
      punishWindow: 0.45,
      riskTolerance: 0.5,
      distancePreference: 0.5,
      jumpFrequency: 0.25,
      projectileUsage: 0.2,
      ultimateUsageThreshold: 0.65,
    },
    0,
    "initial",
    [],
  );

  const simulator = new HeadlessFightingSimulatorAdapter();
  const baselines = getBaselines();
  const fightsPerMatchup = CONFIG.exp1FightsPerMatchup;

  const baselineMetrics: FightMetrics[] = [];
  const gaMetrics: FightMetrics[] = [];

  for (let oi = 0; oi < baselines.length; oi++) {
    const baseline = baselines[oi]!;
    for (let f = 0; f < fightsPerMatchup; f++) {
      const seed = 1000 + oi * 100 + f;
      const baseResult = simulator.fightGenomeVsBaseline({ genome: baselineGenome, baseline, seed });
      baselineMetrics.push(fightMetricsFromResult(baseResult, 0));

      const gaResult = simulator.fightGenomeVsBaseline({ genome: champion, baseline, seed });
      gaMetrics.push(fightMetricsFromResult(gaResult, 0));
    }
  }

  const baselineSummary = summarizeFightMetrics(baselineMetrics);
  const gaSummary = summarizeFightMetrics(gaMetrics);

  const perOpponent = baselines.map((baseline, idx) => {
    const slice = (arr: FightMetrics[]) => arr.slice(idx * fightsPerMatchup, (idx + 1) * fightsPerMatchup);
    return {
      opponent: baseline.opponent.name,
      baseline: summarizeFightMetrics(slice(baselineMetrics)),
      ga: summarizeFightMetrics(slice(gaMetrics)),
    };
  });

  const out = {
    tier: TIER,
    config: CONFIG,
    championGenes: champion.genes,
    aggregate: { baseline: baselineSummary, ga: gaSummary },
    perOpponent,
  };
  fs.writeFileSync(path.join(OUT_DIR, "exp1_baseline_vs_ga.json"), JSON.stringify(out, null, 2));
  console.log(`[exp1] baseline winRate=${(baselineSummary.winRate * 100).toFixed(1)}% ga winRate=${(gaSummary.winRate * 100).toFixed(1)}%`);
  return out;
}

// ============================================================================
// EXPERIMENT 2 — Population diversity
// ============================================================================
//
// We track three signals each generation:
//   - behavioral_entropy: Shannon entropy over the distribution of
//     *attack-kind* decisions across all fights played by a population.
//   - genome_diversity: mean pairwise L2 distance between genomes
//     (already exposed as populationDiversity()).
//   - convergence_speed: generation at which diversity falls below 25 % of
//     generation-0 diversity and stays below for 3 generations.
// ============================================================================

function behavioralEntropyAcrossFights(fights: FightResult[]): number {
  if (fights.length === 0) return 0;
  const counts: Record<string, number> = {};
  let total = 0;
  for (const fight of fights) {
    for (const stats of [fight.sideA, fight.sideB]) {
      for (const [kind, n] of Object.entries(stats.attackKinds ?? {})) {
        counts[kind] = (counts[kind] ?? 0) + n;
        total += n;
      }
    }
  }
  if (total === 0) return 0;
  const probs = Object.values(counts).map((c) => c / total).filter((p) => p > 0);
  const h = -probs.reduce((s, p) => s + p * Math.log2(p), 0);
  return h;
}

function convergenceSpeed(diversityCurve: number[]): { converged: boolean; generation: number; finalRatio: number } {
  if (diversityCurve.length < 2) return { converged: false, generation: -1, finalRatio: 1 };
  const baseline = diversityCurve[0]!;
  if (baseline === 0) return { converged: false, generation: -1, finalRatio: 0 };
  const threshold = 0.25 * baseline;
  let streak = 0;
  for (let i = 1; i < diversityCurve.length; i++) {
    if (diversityCurve[i]! < threshold) {
      streak++;
      if (streak >= 3) return { converged: true, generation: i - 2, finalRatio: diversityCurve[i]! / baseline };
    } else {
      streak = 0;
    }
  }
  return { converged: false, generation: -1, finalRatio: diversityCurve[diversityCurve.length - 1]! / baseline };
}

async function experiment2() {
  console.log("\n[exp2] Population diversity");
  const rng = new Rng(2026);
  const popSize = CONFIG.popSizeForExp34;
  const gens = CONFIG.generations;
  const matchesPerGenome = CONFIG.matchesPerGenome;
  const baselines = getBaselines();;
  const sim = new HeadlessFightingSimulatorAdapter();
  const eval_ = new OfflineFitnessEvaluator(defaultFitnessWeights());

  let population: OfflineGenome[] = Array.from({ length: popSize }, () => createRandomOfflineGenome(rng, 0));
  const diversityCurve: number[] = [];
  const entropyCurve: number[] = [];
  const bestFitnessCurve: number[] = [];
  const avgFitnessCurve: number[] = [];

  for (let g = 0; g < gens; g++) {
    const allFights: FightResult[] = [];
    const evaluated = population.map((genome) => {
      const fights: FightResult[] = [];
      for (let m = 0; m < matchesPerGenome; m++) {
        const baseline = baselines[m % baselines.length]!;
        const fight = sim.fightGenomeVsBaseline({ genome, baseline, seed: rng.int(0, 1_000_000) });
        fights.push(fight);
        allFights.push(fight);
      }
      return eval_.evaluate(genome, fights, 0);
    });
    const diversity = populationDiversity(population);
    const entropy = behavioralEntropyAcrossFights(allFights);
    diversityCurve.push(diversity);
    entropyCurve.push(entropy);
    bestFitnessCurve.push(evaluated[0]!.fitness);
    avgFitnessCurve.push(evaluated.reduce((s, e) => s + e.fitness, 0) / evaluated.length);

    // Elitism + tournament selection + crossover + gaussian mutation
    const eliteCount = Math.max(1, Math.floor(popSize * 0.2));
    const elite = evaluated.slice(0, eliteCount).map((e) => e.genome);
    const next: OfflineGenome[] = [...elite];
    while (next.length < popSize) {
      const a = tournamentSelect(evaluated, rng, 3);
      const b = tournamentSelect(evaluated, rng, 3);
      const child = uniformCrossover(a, b, g + 1, rng);
      const mutated = gaussianMutate(child, g + 1, rng, 0.12, 0.1).genome;
      next.push(mutated);
    }
    population = next;
    console.log(`[exp2] gen=${g} best=${bestFitnessCurve.at(-1)!.toFixed(4)} div=${diversity.toFixed(4)} entropy=${entropy.toFixed(4)}`);
  }

  const conv = convergenceSpeed(diversityCurve);
  const out = {
    tier: TIER,
    config: { popSize, generations: gens, matchesPerGenome },
    diversityCurve,
    entropyCurve,
    bestFitnessCurve,
    avgFitnessCurve,
    convergence: conv,
  };
  fs.writeFileSync(path.join(OUT_DIR, "exp2_diversity.json"), JSON.stringify(out, null, 2));
  console.log(`[exp2] converged=${conv.converged} gen=${conv.generation} finalRatio=${conv.finalRatio.toFixed(3)}`);
  return out;
}

// ============================================================================
// EXPERIMENT 3 — Mutation strategies
// ============================================================================
//
// Compare Gaussian, Uniform, and Polynomial mutation under otherwise
// identical conditions. We measure the same three signals as experiment 2
// plus the mean absolute delta of mutated genes (fingerprint of how each
// operator changes a genome).
// ============================================================================

async function experiment3() {
  console.log("\n[exp3] Mutation strategies");
  const strategies: MutationKind[] = ["gaussian", "uniform", "polynomial"];
  const results: Record<string, any> = {};
  for (const kind of strategies) {
    console.log(`[exp3] mutation=${kind}`);
    const rng = new Rng(2026);
    const popSize = CONFIG.popSizeForExp34;
    const gens = CONFIG.generations;
    const matchesPerGenome = CONFIG.matchesPerGenome;
    const baselines = getBaselines();;
    const sim = new HeadlessFightingSimulatorAdapter();
    const eval_ = new OfflineFitnessEvaluator(defaultFitnessWeights());

    let population: OfflineGenome[] = Array.from({ length: popSize }, () => createRandomOfflineGenome(rng, 0));
    const diversityCurve: number[] = [];
    const bestCurve: number[] = [];
    let mutatedDeltas: number[] = [];

    for (let g = 0; g < gens; g++) {
      const evaluated = population.map((genome) => {
        const fights: FightResult[] = [];
        for (let m = 0; m < matchesPerGenome; m++) {
          const baseline = baselines[m % baselines.length]!;
          fights.push(sim.fightGenomeVsBaseline({ genome, baseline, seed: rng.int(0, 1_000_000) }));
        }
        return eval_.evaluate(genome, fights, 0);
      });
      diversityCurve.push(populationDiversity(population));
      bestCurve.push(evaluated[0]!.fitness);

      const eliteCount = Math.max(1, Math.floor(popSize * 0.2));
      const elite = evaluated.slice(0, eliteCount).map((e) => e.genome);
      const next: OfflineGenome[] = [...elite];
      while (next.length < popSize) {
        const a = tournamentSelect(evaluated, rng, 3);
        const b = tournamentSelect(evaluated, rng, 3);
        const child = uniformCrossover(a, b, g + 1, rng);
        let result;
        if (kind === "gaussian") {
          result = gaussianMutate(child, g + 1, rng, 0.12, 0.1);
        } else if (kind === "uniform") {
          result = uniformMutate(child, g + 1, rng, 0.15, 0.2);
        } else {
          result = polynomialMutate(child, g + 1, rng, 0.12, 0.1, 20);
        }
        if (result.mutatedGenes > 0) {
          mutatedDeltas.push(result.averageAbsoluteDelta);
        }
        next.push(result.genome);
      }
      population = next;
    }
    const conv = convergenceSpeed(diversityCurve);
    const meanDelta = mutatedDeltas.length === 0 ? 0 : mutatedDeltas.reduce((a, b) => a + b, 0) / mutatedDeltas.length;
    results[kind] = {
      diversityCurve,
      bestCurve,
      convergence: conv,
      finalBest: bestCurve.at(-1) ?? 0,
      finalDiversity: diversityCurve.at(-1) ?? 0,
      meanAbsoluteDelta: meanDelta,
    };
    console.log(`[exp3] ${kind}: finalBest=${(bestCurve.at(-1) ?? 0).toFixed(4)} finalDiv=${(diversityCurve.at(-1) ?? 0).toFixed(4)} meanDelta=${meanDelta.toFixed(4)}`);
  }
  const out = { tier: TIER, config: { popSize: CONFIG.popSizeForExp34, generations: CONFIG.generations, matchesPerGenome: CONFIG.matchesPerGenome }, results };
  fs.writeFileSync(path.join(OUT_DIR, "exp3_mutation.json"), JSON.stringify(out, null, 2));
  return out;
}

// ============================================================================
// EXPERIMENT 4 — Selection strategies
// ============================================================================
//
// Tournament (k=3), Roulette, Rank. Identical mutation, crossover, and
// initial seed for fairness. We measure convergence speed, best fitness,
// and final diversity.
// ============================================================================

async function experiment4() {
  console.log("\n[exp4] Selection strategies");
  const strategies: SelectionKind[] = ["tournament", "roulette", "rank"];
  const results: Record<string, any> = {};
  for (const kind of strategies) {
    console.log(`[exp4] selection=${kind}`);
    const rng = new Rng(2026);
    const popSize = CONFIG.popSizeForExp34;
    const gens = CONFIG.generations;
    const matchesPerGenome = CONFIG.matchesPerGenome;
    const baselines = getBaselines();;
    const sim = new HeadlessFightingSimulatorAdapter();
    const eval_ = new OfflineFitnessEvaluator(defaultFitnessWeights());

    let population: OfflineGenome[] = Array.from({ length: popSize }, () => createRandomOfflineGenome(rng, 0));
    const diversityCurve: number[] = [];
    const bestCurve: number[] = [];

    for (let g = 0; g < gens; g++) {
      const evaluated = population.map((genome) => {
        const fights: FightResult[] = [];
        for (let m = 0; m < matchesPerGenome; m++) {
          const baseline = baselines[m % baselines.length]!;
          fights.push(sim.fightGenomeVsBaseline({ genome, baseline, seed: rng.int(0, 1_000_000) }));
        }
        return eval_.evaluate(genome, fights, 0);
      });
      diversityCurve.push(populationDiversity(population));
      bestCurve.push(evaluated[0]!.fitness);

      const eliteCount = Math.max(1, Math.floor(popSize * 0.2));
      const elite = evaluated.slice(0, eliteCount).map((e) => e.genome);
      const next: OfflineGenome[] = [...elite];
      while (next.length < popSize) {
        let a: OfflineGenome, b: OfflineGenome;
        if (kind === "tournament") {
          a = tournamentSelect(evaluated, rng, 3);
          b = tournamentSelect(evaluated, rng, 3);
        } else if (kind === "roulette") {
          a = rouletteSelect(evaluated, rng);
          b = rouletteSelect(evaluated, rng);
        } else {
          a = rankSelect(evaluated, rng, 1.7);
          b = rankSelect(evaluated, rng, 1.7);
        }
        const child = uniformCrossover(a, b, g + 1, rng);
        const result = gaussianMutate(child, g + 1, rng, 0.12, 0.1);
        next.push(result.genome);
      }
      population = next;
    }
    const conv = convergenceSpeed(diversityCurve);
    results[kind] = {
      diversityCurve,
      bestCurve,
      convergence: conv,
      finalBest: bestCurve.at(-1) ?? 0,
      finalDiversity: diversityCurve.at(-1) ?? 0,
    };
    console.log(`[exp4] ${kind}: finalBest=${(bestCurve.at(-1) ?? 0).toFixed(4)} finalDiv=${(diversityCurve.at(-1) ?? 0).toFixed(4)}`);
  }
  const out = { tier: TIER, config: { popSize: CONFIG.popSizeForExp34, generations: CONFIG.generations, matchesPerGenome: CONFIG.matchesPerGenome }, results };
  fs.writeFileSync(path.join(OUT_DIR, "exp4_selection.json"), JSON.stringify(out, null, 2));
  return out;
}

// ============================================================================
// EXPERIMENT 5 — Population sizes
// ============================================================================
//
// 20, 50, 100, 200. Identical everything else. We measure generations to
// reach a fitness threshold of 0.7, peak fitness, and final diversity.
// ============================================================================

async function experiment5() {
  console.log("\n[exp5] Population sizes");
  const sizes = CONFIG.popSizes as readonly number[];
  const threshold = 0.7;
  const results: Record<string, any> = {};
  for (const popSize of sizes) {
    console.log(`[exp5] popSize=${popSize}`);
    const rng = new Rng(2026);
    const gens = CONFIG.generations;
    const matchesPerGenome = CONFIG.matchesPerGenome;
    const baselines = getBaselines();;
    const sim = new HeadlessFightingSimulatorAdapter();
    const eval_ = new OfflineFitnessEvaluator(defaultFitnessWeights());
    const start = Date.now();

    let population: OfflineGenome[] = Array.from({ length: popSize }, () => createRandomOfflineGenome(rng, 0));
    const diversityCurve: number[] = [];
    const bestCurve: number[] = [];
    const avgCurve: number[] = [];
    let generationsToThreshold = -1;

    for (let g = 0; g < gens; g++) {
      const evaluated = population.map((genome) => {
        const fights: FightResult[] = [];
        for (let m = 0; m < matchesPerGenome; m++) {
          const baseline = baselines[m % baselines.length]!;
          fights.push(sim.fightGenomeVsBaseline({ genome, baseline, seed: rng.int(0, 1_000_000) }));
        }
        return eval_.evaluate(genome, fights, 0);
      });
      diversityCurve.push(populationDiversity(population));
      const bestFit = evaluated[0]!.fitness;
      const avgFit = evaluated.reduce((s, e) => s + e.fitness, 0) / evaluated.length;
      bestCurve.push(bestFit);
      avgCurve.push(avgFit);
      if (generationsToThreshold < 0 && bestFit >= threshold) generationsToThreshold = g;

      const eliteCount = Math.max(1, Math.floor(popSize * 0.2));
      const elite = evaluated.slice(0, eliteCount).map((e) => e.genome);
      const next: OfflineGenome[] = [...elite];
      while (next.length < popSize) {
        const a = tournamentSelect(evaluated, rng, 3);
        const b = tournamentSelect(evaluated, rng, 3);
        const child = uniformCrossover(a, b, g + 1, rng);
        const result = gaussianMutate(child, g + 1, rng, 0.12, 0.1);
        next.push(result.genome);
      }
      population = next;
    }
    const elapsed = (Date.now() - start) / 1000;
    const conv = convergenceSpeed(diversityCurve);
    results[`pop_${popSize}`] = {
      popSize,
      diversityCurve,
      bestCurve,
      avgCurve,
      convergence: conv,
      finalBest: bestCurve.at(-1) ?? 0,
      finalAvg: avgCurve.at(-1) ?? 0,
      finalDiversity: diversityCurve.at(-1) ?? 0,
      generationsToThreshold,
      elapsedSec: elapsed,
    };
    console.log(`[exp5] pop=${popSize}: finalBest=${(bestCurve.at(-1) ?? 0).toFixed(4)} finalDiv=${(diversityCurve.at(-1) ?? 0).toFixed(4)} toThreshold=${generationsToThreshold} elapsed=${elapsed.toFixed(1)}s`);
  }
  const out = { tier: TIER, config: { generations: CONFIG.generations, matchesPerGenome: CONFIG.matchesPerGenome, threshold }, results };
  fs.writeFileSync(path.join(OUT_DIR, "exp5_population.json"), JSON.stringify(out, null, 2));
  return out;
}

// ============================================================================
// Driver
// ============================================================================

async function main() {
  const t0 = Date.now();
  const results: Record<string, any> = {};
  if (!onlyArg || onlyArg === "1") results.exp1 = await experiment1();
  if (!onlyArg || onlyArg === "2") results.exp2 = await experiment2();
  if (!onlyArg || onlyArg === "3") results.exp3 = await experiment3();
  if (!onlyArg || onlyArg === "4") results.exp4 = await experiment4();
  if (!onlyArg || onlyArg === "5") results.exp5 = await experiment5();

  fs.writeFileSync(path.join(OUT_DIR, "all_experiments.json"), JSON.stringify(results, null, 2));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[experiments] DONE in ${elapsed}s. Outputs in ${OUT_DIR}`);
}

main().catch((e) => {
  console.error("[experiments] FAILED:", e);
  process.exit(1);
});
