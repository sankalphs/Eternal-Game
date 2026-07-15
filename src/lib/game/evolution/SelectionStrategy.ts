// ============================================================================
// SELECTION STRATEGIES
//
// Pluggable parent selection. Default is tournament selection.
// New strategies can be added without changing the evolution engine.
// ============================================================================

import type { IScoredGenome, ISelectionStrategy } from "./types";

export class TournamentSelection implements ISelectionStrategy {
  readonly id = "tournament";

  constructor(private tournamentSize: number) {}

  select(population: IScoredGenome[], rng: () => number, count: number): IScoredGenome[] {
    const selected: IScoredGenome[] = [];
    for (let i = 0; i < count; i++) {
      selected.push(this.selectOne(population, rng));
    }
    return selected;
  }

  private selectOne(population: IScoredGenome[], rng: () => number): IScoredGenome {
    if (population.length === 0) throw new Error("Empty population");
    let best = population[Math.floor(rng() * population.length)];
    for (let i = 1; i < this.tournamentSize; i++) {
      const candidate = population[Math.floor(rng() * population.length)];
      if (candidate.fitness > best.fitness) best = candidate;
    }
    return best;
  }

  setTournamentSize(size: number): void {
    this.tournamentSize = size;
  }
}

export class RouletteSelection implements ISelectionStrategy {
  readonly id = "roulette";

  select(population: IScoredGenome[], rng: () => number, count: number): IScoredGenome[] {
    const selected: IScoredGenome[] = [];
    const minFitness = Math.min(...population.map((p) => p.fitness), 0);
    const total = population.reduce((sum, p) => sum + (p.fitness - minFitness + 1e-6), 0);

    for (let i = 0; i < count; i++) {
      let cursor = rng() * total;
      for (const p of population) {
        cursor -= p.fitness - minFitness + 1e-6;
        if (cursor <= 0) {
          selected.push(p);
          break;
        }
      }
    }
    return selected;
  }
}
