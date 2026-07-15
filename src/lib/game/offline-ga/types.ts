import type { OpponentDef } from "../types";

export type OfflineGeneKey =
  | "aggression"
  | "defensePriority"
  | "dodgeProbability"
  | "counterAttackTendency"
  | "comboContinuationThreshold"
  | "blockFrequency"
  | "punishWindow"
  | "riskTolerance"
  | "distancePreference"
  | "jumpFrequency"
  | "projectileUsage"
  | "ultimateUsageThreshold";

export type OfflineGeneMap = Record<OfflineGeneKey, number>;

export interface OfflineGeneSpec {
  key: OfflineGeneKey;
  defaultValue: number;
  description: string;
}

export interface OfflineGenome {
  id: string;
  version: string;
  generation: number;
  genes: OfflineGeneMap;
  fitness?: number;
  rawFitness?: number;
  source: "initial" | "elitism" | "crossover" | "mutation" | "checkpoint";
  parentIds: string[];
  createdAt: string;
}

export interface FitnessWeights {
  winRate: number;
  remainingHp: number;
  damageDealt: number;
  damageAvoided: number;
  comboEfficiency: number;
  survivalTime: number;
}

export interface MatchFitnessBreakdown {
  winRate: number;
  remainingHp: number;
  damageDealt: number;
  damageAvoided: number;
  comboEfficiency: number;
  survivalTime: number;
}

export interface EvaluatedGenome {
  genome: OfflineGenome;
  fitness: number;
  rawFitness: number;
  matches: number;
  wins: number;
  breakdown: MatchFitnessBreakdown;
}

export interface MutationStats {
  mutatedGenes: number;
  totalGenes: number;
  averageAbsoluteDelta: number;
  maxAbsoluteDelta: number;
}

export interface GenerationStats {
  generation: number;
  bestFitness: number;
  averageFitness: number;
  diversity: number;
  mutationStats: MutationStats;
  bestGenomeId: string;
  evaluatedMatches: number;
}

export interface BaselineValidationResult {
  baselineId: string;
  baselineName: string;
  fights: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  accepted: boolean;
}

export interface ValidationReport {
  threshold: number;
  fightsPerBaseline: number;
  accepted: boolean;
  results: BaselineValidationResult[];
  failedBaselineIds: string[];
}

export interface OfflineEvolutionConfig {
  populationSize: number;
  generations: number;
  maxGenerations: number;
  matchesPerGenome: number;
  mutationRate: number;
  mutationStdDev: number;
  crossoverRate: number;
  eliteFraction: number;
  tournamentSize: number;
  seed: number;
  fitnessWeights: FitnessWeights;
  validationWinRateThreshold: number;
  validationMatchesPerBaseline: number;
  checkpointDir: string;
  outputPath: string;
  parallelism: number;
  baselinePressureWeight: number;
}

export interface OfflineEvolutionCheckpoint {
  version: string;
  generation: number;
  rngState: number;
  population: OfflineGenome[];
  stats: GenerationStats[];
  baselineFitnessWeights: Record<string, number>;
  bestGenome: OfflineGenome | null;
}

export interface BestGenomeArtifact {
  genome: OfflineGeneMap;
  genomeId: string;
  fitness: number;
  validationReport: ValidationReport;
  winRateByBaseline: Record<string, number>;
  generationDiscovered: number;
  metadata: {
    version: string;
    seed: number;
    exportedAt: string;
    sourceGenome: OfflineGenome;
  };
}

export interface BaselineOpponent {
  id: string;
  opponent: OpponentDef;
}
