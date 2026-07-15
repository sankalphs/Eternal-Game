import { Rng } from "../simulator/Rng";
import type { OfflineGeneKey, OfflineGeneMap, OfflineGeneSpec, OfflineGenome } from "./types";

export const OFFLINE_GENOME_VERSION = "offline-ga.1.0.0";

export const OFFLINE_GENE_SPECS: OfflineGeneSpec[] = [
  { key: "aggression", defaultValue: 0.5, description: "How often the agent initiates offense." },
  { key: "defensePriority", defaultValue: 0.5, description: "How strongly the agent values reducing incoming damage." },
  { key: "dodgeProbability", defaultValue: 0.35, description: "Chance to evade instead of standing ground." },
  { key: "counterAttackTendency", defaultValue: 0.45, description: "Likelihood of answering unsafe enemy actions." },
  { key: "comboContinuationThreshold", defaultValue: 0.5, description: "How readily the agent continues a combo string." },
  { key: "blockFrequency", defaultValue: 0.4, description: "Baseline blocking frequency under pressure." },
  { key: "punishWindow", defaultValue: 0.45, description: "Tolerance for committing to whiff punishes." },
  { key: "riskTolerance", defaultValue: 0.5, description: "Willingness to trade safety for reward." },
  { key: "distancePreference", defaultValue: 0.5, description: "Preferred range, from close to far." },
  { key: "jumpFrequency", defaultValue: 0.25, description: "Preference for aerial approaches and anti-air exchanges." },
  { key: "projectileUsage", defaultValue: 0.2, description: "Preference for ranged pressure where supported by the game." },
  { key: "ultimateUsageThreshold", defaultValue: 0.65, description: "How early the agent spends its ultimate resource." },
];

export const OFFLINE_GENE_KEYS: OfflineGeneKey[] = OFFLINE_GENE_SPECS.map((spec) => spec.key);

let genomeIdCounter = 0;

export function createRandomOfflineGenome(rng: Rng, generation: number, source: OfflineGenome["source"] = "initial"): OfflineGenome {
  const genes = {} as OfflineGeneMap;
  for (const key of OFFLINE_GENE_KEYS) {
    genes[key] = rng.next();
  }
  return createOfflineGenome(genes, generation, source, []);
}

export function createOfflineGenome(
  genes: OfflineGeneMap,
  generation: number,
  source: OfflineGenome["source"],
  parentIds: string[],
): OfflineGenome {
  return {
    id: nextGenomeId(generation),
    version: OFFLINE_GENOME_VERSION,
    generation,
    genes: clampGenes(genes),
    source,
    parentIds,
    createdAt: new Date().toISOString(),
  };
}

export function cloneOfflineGenome(genome: OfflineGenome, generation: number, source: OfflineGenome["source"]): OfflineGenome {
  return {
    ...genome,
    id: nextGenomeId(generation),
    generation,
    genes: { ...genome.genes },
    source,
    parentIds: [genome.id],
    fitness: undefined,
    rawFitness: undefined,
    createdAt: new Date().toISOString(),
  };
}

export function clampGenes(genes: OfflineGeneMap): OfflineGeneMap {
  const clamped = {} as OfflineGeneMap;
  for (const key of OFFLINE_GENE_KEYS) {
    const value = genes[key];
    clamped[key] = clamp01(Number.isFinite(value) ? value : 0);
  }
  return clamped;
}

export function genomeDistance(a: OfflineGenome, b: OfflineGenome): number {
  let sum = 0;
  for (const key of OFFLINE_GENE_KEYS) {
    const diff = a.genes[key] - b.genes[key];
    sum += diff * diff;
  }
  return Math.sqrt(sum / OFFLINE_GENE_KEYS.length);
}

export function populationDiversity(population: OfflineGenome[]): number {
  if (population.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < population.length; i++) {
    for (let j = i + 1; j < population.length; j++) {
      sum += genomeDistance(population[i]!, population[j]!);
      pairs++;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

export function gaussianMutate(
  genome: OfflineGenome,
  generation: number,
  rng: Rng,
  mutationRate: number,
  mutationStdDev: number,
): { genome: OfflineGenome; mutatedGenes: number; averageAbsoluteDelta: number; maxAbsoluteDelta: number } {
  const child = cloneOfflineGenome(genome, generation, "mutation");
  let mutatedGenes = 0;
  let totalDelta = 0;
  let maxDelta = 0;

  for (const key of OFFLINE_GENE_KEYS) {
    if (!rng.chance(mutationRate)) continue;
    const oldValue = child.genes[key];
    const delta = rng.normal() * mutationStdDev;
    child.genes[key] = clamp01(oldValue + delta);
    const absDelta = Math.abs(child.genes[key] - oldValue);
    totalDelta += absDelta;
    maxDelta = Math.max(maxDelta, absDelta);
    mutatedGenes++;
  }

  return {
    genome: child,
    mutatedGenes,
    averageAbsoluteDelta: mutatedGenes === 0 ? 0 : totalDelta / mutatedGenes,
    maxAbsoluteDelta: maxDelta,
  };
}

export function uniformMutate(
  genome: OfflineGenome,
  generation: number,
  rng: Rng,
  mutationRate: number,
  range: number,
): { genome: OfflineGenome; mutatedGenes: number; averageAbsoluteDelta: number; maxAbsoluteDelta: number } {
  const child = cloneOfflineGenome(genome, generation, "mutation");
  let mutatedGenes = 0;
  let totalDelta = 0;
  let maxDelta = 0;
  const half = range / 2;
  for (const key of OFFLINE_GENE_KEYS) {
    if (!rng.chance(mutationRate)) continue;
    const oldValue = child.genes[key];
    const delta = rng.uniform(-half, half);
    child.genes[key] = clamp01(oldValue + delta);
    const absDelta = Math.abs(child.genes[key] - oldValue);
    totalDelta += absDelta;
    maxDelta = Math.max(maxDelta, absDelta);
    mutatedGenes++;
  }
  return {
    genome: child,
    mutatedGenes,
    averageAbsoluteDelta: mutatedGenes === 0 ? 0 : totalDelta / mutatedGenes,
    maxAbsoluteDelta: maxDelta,
  };
}

export function polynomialMutate(
  genome: OfflineGenome,
  generation: number,
  rng: Rng,
  mutationRate: number,
  strength: number,
  distributionIndex: number,
): { genome: OfflineGenome; mutatedGenes: number; averageAbsoluteDelta: number; maxAbsoluteDelta: number } {
  const child = cloneOfflineGenome(genome, generation, "mutation");
  let mutatedGenes = 0;
  let totalDelta = 0;
  let maxDelta = 0;
  for (const key of OFFLINE_GENE_KEYS) {
    if (!rng.chance(mutationRate)) continue;
    const oldValue = child.genes[key];
    const u = rng.next();
    const sign = u < 0.5 ? -1 : 1;
    const normalized = sign < 0 ? 2 * u : 2 * (u - 0.5);
    const safe = Math.max(0, normalized);
    const x = Math.pow(safe, 1 / (distributionIndex + 1));
    const delta = sign * strength * (1 - x);
    child.genes[key] = clamp01(oldValue + delta);
    const absDelta = Math.abs(child.genes[key] - oldValue);
    totalDelta += absDelta;
    maxDelta = Math.max(maxDelta, absDelta);
    mutatedGenes++;
  }
  return {
    genome: child,
    mutatedGenes,
    averageAbsoluteDelta: mutatedGenes === 0 ? 0 : totalDelta / mutatedGenes,
    maxAbsoluteDelta: maxDelta,
  };
}

export function uniformCrossover(parentA: OfflineGenome, parentB: OfflineGenome, generation: number, rng: Rng): OfflineGenome {
  const genes = {} as OfflineGeneMap;
  for (const key of OFFLINE_GENE_KEYS) {
    genes[key] = rng.chance(0.5) ? parentA.genes[key] : parentB.genes[key];
  }
  return createOfflineGenome(genes, generation, "crossover", [parentA.id, parentB.id]);
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function nextGenomeId(generation: number): string {
  genomeIdCounter++;
  return `offline_${generation}_${genomeIdCounter.toString(36).padStart(6, "0")}`;
}
