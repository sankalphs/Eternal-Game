// ============================================================================
// SELECTION STRATEGIES — used by the experiment harness
//
// Pluggable parent selection. Default operator is tournament (k=3), and
// the alternatives are roulette (fitness-proportional) and rank-based.
// Each strategy accepts the already-evaluated population and returns one
// parent per call.
// ============================================================================

import type { OfflineGenome } from "./types";

export type MutationKind = "gaussian" | "uniform" | "polynomial";
export type SelectionKind = "tournament" | "roulette" | "rank";

export interface EvaluatedGenome {
  genome: OfflineGenome;
  fitness: number;
  rawFitness: number;
  matches: number;
  wins: number;
  breakdown?: any;
}

type RngLike = (() => number) | { next: () => number };

function asFn(rng: RngLike): () => number {
  return typeof rng === "function" ? rng : () => rng.next();
}

export function tournamentSelect(
  population: EvaluatedGenome[],
  rng: RngLike,
  k: number,
): OfflineGenome {
  if (population.length === 0) throw new Error("Empty population");
  const rand = asFn(rng);
  let best = population[Math.floor(rand() * population.length)]!;
  for (let i = 1; i < k; i++) {
    const candidate = population[Math.floor(rand() * population.length)]!;
    if (candidate.fitness > best.fitness) best = candidate;
  }
  return best.genome;
}

export function rouletteSelect(population: EvaluatedGenome[], rng: RngLike): OfflineGenome {
  if (population.length === 0) throw new Error("Empty population");
  const rand = asFn(rng);
  const minFitness = Math.min(...population.map((p) => p.fitness), 0);
  const offsets = population.map((p) => p.fitness - minFitness + 1e-6);
  const total = offsets.reduce((a, b) => a + b, 0);
  let cursor = rand() * total;
  for (let i = 0; i < population.length; i++) {
    cursor -= offsets[i]!;
    if (cursor <= 0) return population[i]!.genome;
  }
  return population.at(-1)!.genome;
}

export function rankSelect(
  population: EvaluatedGenome[],
  rng: RngLike,
  selectionPressure = 1.7,
): OfflineGenome {
  if (population.length === 0) throw new Error("Empty population");
  const rand = asFn(rng);
  const sorted = population.slice().sort((a, b) => b.fitness - a.fitness);
  const ranks = sorted.map((_, i) => sorted.length - i);
  const weights = ranks.map((r) => Math.pow(r, selectionPressure));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = rand() * total;
  for (let i = 0; i < sorted.length; i++) {
    cursor -= weights[i]!;
    if (cursor <= 0) return sorted[i]!.genome;
  }
  return sorted.at(-1)!.genome;
}
