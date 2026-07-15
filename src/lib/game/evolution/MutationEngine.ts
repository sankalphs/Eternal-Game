// ============================================================================
// MUTATION ENGINE
//
// Applies bounded, configurable mutations to a genome.
// Supports normal, catastrophic, and fine-tune mutations.
// ============================================================================

import type { IGenome, IMutationEvent, IMutationConfig } from "./types";
import { GENOME_SPECS, GENOME_SPEC_MAP, cloneGenome, randomInRange } from "./Genome";

export class MutationEngine {
  constructor(private config: IMutationConfig) {}

  /**
   * Mutates a genome in-place and returns a mutation event log.
   * The caller is responsible for assigning a new id and generation.
   */
  mutate(parent: IGenome, generation: number, rng: () => number = Math.random): { child: IGenome; event: IMutationEvent } {
    const child = cloneGenome(parent, "mutation", generation);
    const changedGenes: IMutationEvent["changedGenes"] = [];

    for (const spec of GENOME_SPECS) {
      if (rng() >= this.config.rate) continue;

      const oldValue = child[spec.key as keyof IGenome] as number;
      const range = spec.max - spec.min;
      let magnitude = this.config.magnitude * range;

      if (rng() < this.config.catastrophicRate) {
        magnitude *= 3;
      } else if (rng() < this.config.fineTuneRate) {
        magnitude *= 0.2;
      }

      const delta = (rng() * 2 - 1) * magnitude;
      let newValue = oldValue + delta;
      newValue = Math.max(this.config.globalMin, Math.min(this.config.globalMax, newValue));
      newValue = Math.max(spec.min, Math.min(spec.max, newValue));
      if (spec.integer) newValue = Math.round(newValue);

      (child[spec.key as keyof IGenome] as number) = newValue;
      changedGenes.push({ gene: spec.key as keyof IGenome, oldValue, newValue });
    }

    const event: IMutationEvent = {
      generation,
      genomeId: child.id,
      parentId: parent.id,
      source: child.source ?? "mutation",
      changedGenes,
    };

    return { child, event };
  }

  /** Updates the engine's mutation hyperparameters at runtime. */
  setConfig(config: IMutationConfig): void {
    this.config = config;
  }

  getConfig(): IMutationConfig {
    return { ...this.config };
  }

  /**
   * Convenience: returns the default mutation config used by the framework.
   * An LLM can edit this object without changing MutationEngine.
   */
  static defaultConfig(): IMutationConfig {
    return {
      rate: 0.18,
      magnitude: 0.12,
      catastrophicRate: 0.02,
      fineTuneRate: 0.25,
      globalMin: 0.0,
      globalMax: 1.0,
    };
  }
}

/** Mutates a single gene value by key without side effects. */
export function mutateGeneValue(
  genome: IGenome,
  key: keyof IGenome,
  magnitude: number,
  rng: () => number,
): number {
  const spec = GENOME_SPEC_MAP.get(key);
  if (!spec) return genome[key] as number;
  const range = spec.max - spec.min;
  const delta = (rng() * 2 - 1) * magnitude * range;
  let value = (genome[key] as number) + delta;
  value = Math.max(spec.min, Math.min(spec.max, value));
  return spec.integer ? Math.round(value) : value;
}
