// ============================================================================
// CROSSOVER ENGINE
//
// Supports uniform, single-point, and arithmetic crossover.
// All strategies operate only on AI behaviour genes.
// ============================================================================

import type { ICrossoverConfig, IGenome } from "./types";
import { GENOME_SPECS, cloneGenome, randomInRange } from "./Genome";

export class CrossoverEngine {
  constructor(private config: ICrossoverConfig) {}

  /**
   * Produces a child from two parents. If crossover does not trigger,
   * the fitter parent is cloned.
   */
  crossover(
    parentA: IGenome,
    parentB: IGenome,
    generation: number,
    rng: () => number = Math.random,
  ): { child: IGenome; parentIds: [string, string] } {
    if (rng() >= this.config.rate) {
      const fitter = (parentA.fitness ?? 0) >= (parentB.fitness ?? 0) ? parentA : parentB;
      const child = cloneGenome(fitter, "elitism-clone", generation);
      return { child, parentIds: [fitter.id, fitter.id] };
    }

    const child = cloneGenome(parentA, "crossover", generation);
    const parentIds: [string, string] = [parentA.id, parentB.id];

    switch (this.config.strategy) {
      case "uniform":
        this.uniformCrossover(child, parentA, parentB, rng);
        break;
      case "singlePoint":
        this.singlePointCrossover(child, parentA, parentB, rng);
        break;
      case "arithmetic":
        this.arithmeticCrossover(child, parentA, parentB, rng);
        break;
      default:
        this.uniformCrossover(child, parentA, parentB, rng);
    }

    return { child, parentIds };
  }

  private uniformCrossover(child: IGenome, a: IGenome, b: IGenome, rng: () => number): void {
    for (const spec of GENOME_SPECS) {
      if (rng() >= this.config.uniformBias) {
        (child[spec.key as keyof IGenome] as number) = b[spec.key as keyof IGenome] as number;
      }
    }
  }

  private singlePointCrossover(child: IGenome, a: IGenome, b: IGenome, rng: () => number): void {
    const point = Math.floor(rng() * GENOME_SPECS.length);
    for (let i = point; i < GENOME_SPECS.length; i++) {
      const spec = GENOME_SPECS[i];
      (child[spec.key as keyof IGenome] as number) = b[spec.key as keyof IGenome] as number;
    }
  }

  private arithmeticCrossover(child: IGenome, a: IGenome, b: IGenome, rng: () => number): void {
    const alpha = rng();
    for (const spec of GENOME_SPECS) {
      const av = a[spec.key as keyof IGenome] as number;
      const bv = b[spec.key as keyof IGenome] as number;
      let value = alpha * av + (1 - alpha) * bv;
      if (spec.integer) value = Math.round(value);
      (child[spec.key as keyof IGenome] as number) = value;
    }
  }

  setConfig(config: ICrossoverConfig): void {
    this.config = config;
  }

  getConfig(): ICrossoverConfig {
    return { ...this.config };
  }

  static defaultConfig(): ICrossoverConfig {
    return {
      rate: 0.75,
      strategy: "uniform",
      uniformBias: 0.5,
    };
  }
}
