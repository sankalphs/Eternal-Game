// ============================================================================
// POPULATION
//
// Maintains the current generation, measures diversity, supports tournament
// selection, elitism, and genome similarity metrics.
// ============================================================================

import type { IGenome, IScoredGenome } from "./types";
import { GENOME_SPECS, cloneGenome, createRandomGenome, genomeDistance } from "./Genome";

export class Population {
  private genomes: IGenome[] = [];
  private scored: IScoredGenome[] = [];

  constructor(public size: number) {}

  /** Initializes with random genomes. */
  initialize(rng: () => number): void {
    this.genomes = Array.from({ length: this.size }, () => createRandomGenome(rng, 0));
    this.scored = this.genomes.map((g) => ({ genome: g, fitness: -Infinity, rawFitness: -Infinity }));
  }

  /** Seeds the population from an imported opponent or prior champion. */
  seed(seedGenomes: IGenome[], rng: () => number): void {
    this.genomes = seedGenomes.slice(0, this.size);
    while (this.genomes.length < this.size) {
      this.genomes.push(createRandomGenome(rng, 0));
    }
    this.scored = this.genomes.map((g) => ({ genome: g, fitness: -Infinity, rawFitness: -Infinity }));
  }

  /** Sets evaluated genomes (called by EvolutionManager after fitness eval). */
  setScores(scored: IScoredGenome[]): void {
    this.scored = scored.slice().sort((a, b) => b.fitness - a.fitness);
    this.genomes = this.scored.map((s) => s.genome);
  }

  /** Returns genomes sorted by fitness (best first). */
  getRanked(): IScoredGenome[] {
    return this.scored.slice();
  }

  /** Returns the current best genome or null if not yet scored. */
  getBest(): IScoredGenome | null {
    return this.scored[0] ?? null;
  }

  /** Returns the N best genomes. */
  getElites(count: number): IGenome[] {
    return this.scored.slice(0, count).map((s) => s.genome);
  }

  /** Tournament selection: returns one genome. */
  tournamentSelect(rng: () => number, tournamentSize: number): IGenome {
    if (this.scored.length === 0) throw new Error("Population not scored");
    let best = this.scored[Math.floor(rng() * this.scored.length)];
    for (let i = 1; i < tournamentSize; i++) {
      const candidate = this.scored[Math.floor(rng() * this.scored.length)];
      if (candidate.fitness > best.fitness) best = candidate;
    }
    return best.genome;
  }

  /**
   * Population diversity: average pairwise normalized distance between the top
   * half of the population. 0 = identical, 1 = maximally different.
   */
  measureDiversity(): number {
    if (this.scored.length < 2) return 0;
    const subset = this.scored.slice(0, Math.max(2, Math.floor(this.scored.length / 2)));
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < subset.length; i++) {
      for (let j = i + 1; j < subset.length; j++) {
        total += genomeDistance(subset[i].genome, subset[j].genome);
        pairs++;
      }
    }
    return pairs === 0 ? 0 : total / pairs;
  }

  /** Average diversity of each genome from the population centroid. */
  measureCentroidDiversity(): number {
    if (this.scored.length < 2) return 0;
    const centroid = this.computeCentroid();
    let total = 0;
    for (const s of this.scored) {
      total += genomeDistance(s.genome, centroid);
    }
    return total / this.scored.length;
  }

  /** Computes the mean value of every gene. */
  computeCentroid(): IGenome {
    const centroid = cloneGenome(this.scored[0]?.genome ?? createRandomGenome(Math.random, 0), "centroid", 0);
    for (const spec of GENOME_SPECS) {
      let sum = 0;
      for (const s of this.scored) {
        sum += s.genome[spec.key as keyof IGenome] as number;
      }
      (centroid[spec.key as keyof IGenome] as number) = sum / this.scored.length;
    }
    return centroid;
  }

  /** Replaces the weakest fraction of the population with random immigrants. */
  injectRandomImmigrants(fraction: number, rng: () => number, generation: number): IGenome[] {
    const count = Math.max(1, Math.floor(this.size * fraction));
    const immigrants: IGenome[] = [];
    for (let i = 0; i < count; i++) {
      immigrants.push(createRandomGenome(rng, generation));
    }
    // Replace the lowest-scored individuals.
    this.scored = this.scored.slice(0, this.size - count);
    for (const immigrant of immigrants) {
      this.scored.push({ genome: immigrant, fitness: -Infinity, rawFitness: -Infinity });
    }
    this.genomes = this.scored.map((s) => s.genome);
    return immigrants;
  }

  get sizeValue(): number {
    return this.size;
  }
}
