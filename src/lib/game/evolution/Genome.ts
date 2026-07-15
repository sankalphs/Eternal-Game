// ============================================================================
// GENOME — AI behaviour parameter schema
//
// Contains ONLY parameters consumed by the rule-based EnemyAI.
// No animation, rendering, physics, or body-type data lives here.
// ============================================================================

import type { IGenome, IGeneSpec } from "./types";

export const GENOME_VERSION = "1.0.0";

/**
 * Full specification for every gene in the genome.
 * This is the single source of truth for defaults, bounds, and metadata.
 */
export const GENOME_SPECS: IGeneSpec[] = [
  {
    key: "aggression",
    min: 0.0,
    max: 1.0,
    default: 0.45,
    integer: false,
    description: "Base attack tendency when in range.",
  },
  {
    key: "blockChance",
    min: 0.0,
    max: 1.0,
    default: 0.25,
    integer: false,
    description: "Base probability of blocking or rolling away from a player attack.",
  },
  {
    key: "reaction",
    min: 0.05,
    max: 0.8,
    default: 0.35,
    integer: false,
    description: "Seconds required to react to a player attack.",
  },
  {
    key: "combo",
    min: 1,
    max: 6,
    default: 2,
    integer: true,
    description: "Maximum number of consecutive attacks in a pressure string.",
  },
  {
    key: "whiffPunish",
    min: 0.0,
    max: 1.0,
    default: 0.25,
    integer: false,
    description: "Chance to dash in and punish a missed player attack.",
  },
  {
    key: "antiAir",
    min: 0.0,
    max: 1.0,
    default: 0.2,
    integer: false,
    description: "Chance to meet a jumping player with a jump-kick.",
  },
  {
    key: "pressure",
    min: 0.0,
    max: 1.0,
    default: 0.35,
    integer: false,
    description: "Tendency to keep gaps short and interrupt block into counters.",
  },
  {
    key: "mixup",
    min: 0.0,
    max: 1.0,
    default: 0.3,
    integer: false,
    description: "Tendency to alternate attack heights and hold wider spacing.",
  },
  {
    key: "adaptive",
    min: 0.0,
    max: 1.0,
    default: 0.25,
    integer: false,
    description: "How quickly the AI learns to pre-empt repeated player habits.",
  },
  {
    key: "rage",
    min: 0.0,
    max: 1.0,
    default: 0.3,
    integer: false,
    description: "Aggression/speed boost when the AI is below 30% HP.",
  },
  {
    key: "perfection",
    min: 0.0,
    max: 1.0,
    default: 0.1,
    integer: false,
    description: "Chance to frame-perfectly block unreactable strings.",
  },
  {
    key: "readDelay",
    min: 0.0,
    max: 0.3,
    default: 0.05,
    integer: false,
    description: "Extra reaction delay when reading player habits.",
  },
];

/** Map of gene key to spec for O(1) lookup. */
export const GENOME_SPEC_MAP = new Map<keyof IGenome, IGeneSpec>(
  GENOME_SPECS.map((s) => [s.key as keyof IGenome, s]),
);

/** Gene keys that are part of the behaviour schema. */
export const GENE_KEYS = GENOME_SPECS.map((s) => s.key as keyof IGenome);

/** Creates a fresh genome with default values. */
export function createDefaultGenome(overrides?: Partial<IGenome>): IGenome {
  const genome = {} as IGenome;
  for (const spec of GENOME_SPECS) {
    (genome[spec.key as keyof IGenome] as number) = spec.default;
  }
  genome.id = `genome_${generateShortId()}`;
  genome.version = GENOME_VERSION;
  genome.generation = 0;
  genome.source = "initial";
  genome.createdAt = new Date().toISOString();

  if (overrides) {
    Object.assign(genome, overrides);
  }
  return genome;
}

/** Creates a randomized genome within bounds. */
export function createRandomGenome(rng: () => number, generation = 0): IGenome {
  const genome = createDefaultGenome();
  genome.generation = generation;
  genome.source = "random";
  for (const spec of GENOME_SPECS) {
    (genome[spec.key as keyof IGenome] as number) = randomInRange(rng, spec.min, spec.max, spec.integer);
  }
  return genome;
}

/** Clones a genome and assigns a new id. */
export function cloneGenome(
  genome: IGenome,
  source: string,
  generation: number,
  parents?: { parentA?: string; parentB?: string },
): IGenome {
  return {
    ...genome,
    id: `genome_${generateShortId()}`,
    generation,
    source,
    createdAt: new Date().toISOString(),
    fitness: undefined,
    rawFitness: undefined,
    parentA: parents?.parentA ?? genome.parentA,
    parentB: parents?.parentB ?? genome.parentB,
    fitnessHistory: genome.fitnessHistory ? [...genome.fitnessHistory] : undefined,
    narrativeTraits: genome.narrativeTraits ? [...genome.narrativeTraits] : undefined,
  };
}

/** Validates that every gene is within its declared bounds. */
export function validateGenome(genome: IGenome): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const spec of GENOME_SPECS) {
    const value = genome[spec.key as keyof IGenome] as number;
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`${String(spec.key)} must be a number`);
      continue;
    }
    if (value < spec.min || value > spec.max) {
      errors.push(`${String(spec.key)} = ${value} is outside [${spec.min}, ${spec.max}]`);
    }
    if (spec.integer && !Number.isInteger(value)) {
      errors.push(`${String(spec.key)} = ${value} must be an integer`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Returns a new genome with every gene clamped to its bounds. */
export function clampGenome(genome: IGenome): IGenome {
  const clamped = cloneGenome(genome, genome.source ?? "clamp", genome.generation);
  for (const spec of GENOME_SPECS) {
    let value = genome[spec.key as keyof IGenome] as number;
    value = Math.max(spec.min, Math.min(spec.max, value));
    if (spec.integer) value = Math.round(value);
    (clamped[spec.key as keyof IGenome] as number) = value;
  }
  return clamped;
}

/** Computes Euclidean distance between two genomes in gene space. */
export function genomeDistance(a: IGenome, b: IGenome): number {
  let sum = 0;
  for (const spec of GENOME_SPECS) {
    const range = spec.max - spec.min || 1;
    const diff = ((a[spec.key as keyof IGenome] as number) - (b[spec.key as keyof IGenome] as number)) / range;
    sum += diff * diff;
  }
  return Math.sqrt(sum / GENOME_SPECS.length);
}

/** Helper: random number in [min, max], optionally integer. */
export function randomInRange(rng: () => number, min: number, max: number, integer = false): number {
  const v = min + rng() * (max - min);
  return integer ? Math.round(v) : v;
}

function generateShortId(): string {
  return `${Date.now().toString(36)}_${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}
