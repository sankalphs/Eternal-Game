// ============================================================================
// EVOLUTION FRAMEWORK — SHARED INTERFACES
//
// All interfaces are pure data/contracts so an LLM can later modify:
//   - Fitness weights
//   - Mutation rate
//   - Selection strategy
//   - Crossover strategy
//   - Experiment configuration
// without touching the engine or the FSM.
// ============================================================================

import type { GameEngine } from "../engine";
import type { OpponentDef } from "../types";

/**
 * A genome represents ONLY AI behaviour parameters.
 * It intentionally excludes animation, rendering, physics, and body stats.
 */
export interface IGenome {
  id: string;
  version: string;
  generation: number;

  /** Provenance: "initial", "mutation", "crossover", "elitism", "restart", "immigrant". */
  source?: string;

  /** ISO timestamp of creation. */
  createdAt?: string;

  /** Fitness assigned after evaluation (optional until evaluated). */
  fitness?: number;

  /** Unweighted raw score before normalization/penalties. */
  rawFitness?: number;

  // ---- Genealogy (Phase 4) ----
  parentA?: string;
  parentB?: string;
  /** Per-generation fitness values for this genome's lineage. */
  fitnessHistory?: number[];
  /** Narrative traits generated from behaviour statistics (Phase 8). */
  narrativeTraits?: INarrativeTrait[];

  // ---- AI behaviour parameters (all map to fields of OpponentDef) ----

  /** Base attack tendency (0..1). Higher = opens more often. */
  aggression: number;

  /** Base block/dodge probability when reacting to a player attack (0..1). */
  blockChance: number;

  /** Seconds to react to player attacks. Smaller = faster reactions. */
  reaction: number;

  /** Max consecutive attacks in a string (integer >= 1). */
  combo: number;

  /** Chance to punish a missed player attack (0..1). */
  whiffPunish: number;

  /** Chance to anti-air a jumping player (0..1). */
  antiAir: number;

  /** Tendency to maintain offensive pressure; also lowers gaps (0..1). */
  pressure: number;

  /** Tendency to mix high/low/slow attacks and hold wider spacing (0..1). */
  mixup: number;

  /** How much the AI adapts to repeated player patterns (0..1). */
  adaptive: number;

  /** How much aggression/speed rises when low on HP (0..1). */
  rage: number;

  /** Chance to frame-perfectly block an unreactable string (0..1). */
  perfection: number;

  /** Optional extra reaction delay when reading player habits (seconds). */
  readDelay?: number;
}

/** Bounds and metadata for a single gene. */
export interface IGeneSpec {
  key: keyof IGenome;
  min: number;
  max: number;
  default: number;
  integer?: boolean;
  description: string;
}

/** Configuration for the simulation harness. */
export interface ISimulationConfig {
  /** Target frame step in seconds. The engine clamps to a max of 1/30. */
  timeStep: number;

  /** Hard cap on simulated seconds per match. */
  maxDurationSeconds: number;

  /** Number of rounds to win a match (usually 2). */
  roundsToWin: number;

  /** If true, round-end timeouts are skipped so evaluation is fast. */
  fastRoundTransitions: boolean;

  /** If true, Math.random is replaced by a seeded PRNG for reproducibility. */
  deterministic: boolean;

  /** Seed used when deterministic === true. */
  seedBase: number;

  /** Scene used for offline evaluation (no gameplay impact on behaviour). */
  background?: import("../types").BackgroundId;

  /** Base opponent definition used for body stats, HP, damageMul, speedMul. */
  baseOpponent: OpponentDef;
}

/** A single-frame decision produced by a scripted player agent. */
export interface IPlayerAgent {
  readonly id: string;
  update(dt: number, engine: GameEngine): import("../types").InputState;
  reset?(): void;
}

/** Per-round telemetry captured from one match. */
export interface IRoundMetrics {
  /** Round index (0-based). */
  roundIndex: number;

  /** Did the genome AI win this round? */
  genomeWon: boolean;

  /** Final HP fractions. */
  genomeHpFrac: number;
  playerHpFrac: number;

  /** Round duration in seconds. */
  durationSeconds: number;

  /** Whether this round ended by timeout. */
  timeout: boolean;
}

/** Metrics captured from one match. */
export interface IMatchMetrics {
  /** Did the genome AI win the match? */
  genomeWon: boolean;

  /** Rounds won by the genome AI. */
  genomeRoundsWon: number;

  /** Rounds won by the scripted player agent. */
  playerRoundsWon: number;

  /** Per-round breakdown. */
  rounds: IRoundMetrics[];

  /** Final HP fraction of the genome AI (0..1). */
  genomeHpFrac: number;

  /** Final HP fraction of the player agent (0..1). */
  playerHpFrac: number;

  /** Maximum HP of the genome AI. */
  genomeMaxHp: number;

  /** Maximum HP of the player agent. */
  playerMaxHp: number;

  /** Total simulated seconds. */
  durationSeconds: number;

  /** Whether the match ended by timeout. */
  timeout: boolean;

  /** Number of successful hits landed by the genome AI. */
  genomeHits: number;

  /** Number of successful hits landed by the player agent. */
  playerHits: number;

  /** Max combo length achieved by the genome AI. */
  genomeMaxCombo: number;

  /** Max combo length achieved by the player agent. */
  playerMaxCombo: number;

  /** Time the genome AI spent blocking (seconds). */
  genomeBlockTime: number;

  /** Time the player agent spent blocking (seconds). */
  playerBlockTime: number;

  /** Time the genome AI spent attacking (seconds). */
  genomeAttackTime: number;

  /** Distance samples for pacing/variety calculations. */
  distanceSamples: number[];

  /** Standard deviation of distance (spacing variety). */
  distanceStdDev: number;

  /** Number of distinct attack kinds used by genome AI (punch/kick/roundhouse/super). */
  genomeAttackKindsUsed: number;

  /** Ordered list of genome attack kinds (punch/kick/roundhouse/super/none). */
  genomeAttackSequence: string[];

  /** Count of each attack kind used by genome AI. */
  genomeAttackKindCounts: Record<string, number>;

  /** Count of each combo length used by genome AI. */
  genomeComboCounts: Record<number, number>;

  /** Agent archetype this match was played against. */
  archetypeId: string;

  /** Total damage dealt by genome AI. */
  genomeDamageDealt: number;

  /** Total damage dealt by player agent. */
  playerDamageDealt: number;
}

/** Result of evaluating one genome against all archetypes. */
export interface IEvaluationResult {
  genome: IGenome;
  matches: IMatchMetrics[];
  averageFitness: number;
  rawFitness: number;
  perArchetype: Record<string, number>;
  /** Per-objective raw scores (metric name -> average value). */
  objectiveScores: Record<string, number>;
  warnings: string[];
}

// ============================================================================
// PHASE 1 — Multi-objective fitness weights
// ============================================================================

/** Configurable weights for the multi-objective fitness function. */
export interface IFitnessWeights {
  // ---- Primary objectives ----
  /** Reward winning rounds without eliminating other objectives. */
  winRate: number;

  /** Reward keeping the AI's own HP high. */
  survival: number;

  /** Reward dealing damage / reducing player HP. */
  damage: number;

  // ---- Player experience objectives ----
  /** Reward matches that demand player adaptation (varied archetype performance). */
  forcedAdaptation: number;

  /** Reward using different attacks, ranges, and combos. */
  combatVariety: number;

  /** Reward healthy fight duration (not too fast, not too slow). */
  fightDuration: number;

  /** Reward distinct behaviours across the match. */
  behaviourDiversity: number;

  /** Reward varied combo lengths. */
  comboDiversity: number;

  /** Reward varied spacing (distance std dev). */
  spacingDiversity: number;

  /** Reward switching attack patterns so the player cannot easily predict. */
  unpredictability: number;

  /** Bonus for close finishes (small HP difference). */
  closeFinishBonus: number;

  // ---- Anti-degeneracy penalties ----
  /** Penalize camping / excessive avoidance. */
  campingPenalty: number;

  /** Penalize degenerate infinite blocking. */
  infiniteBlockPenalty: number;

  /** Penalize degenerate infinite aggression that ignores defense. */
  infiniteAggressionPenalty: number;

  /** Penalize repeating the same move. */
  repeatedMovePenalty: number;

  /** Penalize strategies that cause excessive timeouts. */
  timeoutPenalty: number;
}

/** Strategy used to select parents. */
export interface ISelectionStrategy {
  readonly id: string;
  select(population: IScoredGenome[], rng: () => number, count: number): IScoredGenome[];
}

/** A genome paired with its fitness score. */
export interface IScoredGenome {
  genome: IGenome;
  fitness: number;
  rawFitness: number;
  rank?: number;
}

/** Configuration for mutation. */
export interface IMutationConfig {
  /** Per-gene probability of being mutated. */
  rate: number;

  /** Max relative magnitude of a mutation (0..1 of the gene range). */
  magnitude: number;

  /** Probability of a large mutation (escape local optima). */
  catastrophicRate: number;

  /** Probability of a small fine-tuning mutation. */
  fineTuneRate: number;

  /** Minimum value any gene can take after mutation. */
  globalMin: number;

  /** Maximum value any gene can take after mutation. */
  globalMax: number;
}

/** Configuration for crossover. */
export interface ICrossoverConfig {
  /** Probability that crossover produces a child; otherwise clones a parent. */
  rate: number;

  /** Supported strategies: "uniform", "singlePoint", "arithmetic". */
  strategy: CrossoverStrategy;

  /** For uniform crossover: probability of taking a gene from parent A. */
  uniformBias: number;
}

export type CrossoverStrategy = "uniform" | "singlePoint" | "arithmetic";

/** Top-level evolution hyperparameters. */
export interface IEvolutionConfig {
  populationSize: number;
  generations: number;
  elitismCount: number;
  tournamentSize: number;
  mutation: IMutationConfig;
  crossover: ICrossoverConfig;
  fitness: IFitnessWeights;

  /** Number of top genomes saved each generation for the lineage trace. */
  lineageSize: number;

  /** If best fitness does not improve for this many generations, stop early. */
  earlyStoppingPatience: number;

  /** Minimum improvement required to reset the early-stopping counter. */
  earlyStoppingMinDelta: number;

  /** Every N generations, inject random immigrants to preserve diversity. */
  randomRestartInterval: number;

  /** Fraction of the population replaced by random immigrants at restart. */
  randomRestartFraction: number;

  /** Diversity threshold below which a restart is triggered. */
  diversityThreshold: number;

  /** Optional self-play weight added to the fitness score (Phase 7). */
  selfPlayWeight?: number;

  /** Whether to generate dataset samples during evaluation (Phase 6). */
  generateDataset?: boolean;
}

/** Snapshot of one generation for reporting. */
export interface IGenerationSnapshot {
  generation: number;
  bestFitness: number;
  averageFitness: number;
  worstFitness: number;
  diversity: number;
  bestGenomeId: string;
  mutationEvents: IMutationEvent[];
  /** Population entropy (Phase 10). */
  entropy?: number;
  /** Champion improvement over previous generation. */
  championImprovement?: number;
  /** Average behaviour diversity in the population. */
  behaviourDiversity?: number;
}

/** Record of a mutation applied during evolution. */
export interface IMutationEvent {
  generation: number;
  genomeId: string;
  parentId?: string;
  source: string;
  changedGenes: Array<{ gene: keyof IGenome; oldValue: number; newValue: number }>;
}

/** Final lineage node for the champion trace. */
export interface ILineageNode {
  generation: number;
  genomeId: string;
  parentIds: string[];
  source: string;
  fitness: number;
  /** Per-generation fitness trace for this lineage branch. */
  fitnessHistory?: number[];
}

/** Genealogy tree node with children (Phase 4). */
export interface IGenealogyNode extends ILineageNode {
  children: IGenealogyNode[];
  depth: number;
}

/** Complete exportable report. */
export interface IEvolutionReportData {
  config: IEvolutionConfig;
  snapshots: IGenerationSnapshot[];
  champion: IGenome;
  lineage: ILineageNode[];
  mutationHistory: IMutationEvent[];
  archetypePerformance: Record<string, number>;
  exportedAt: string;
}

// ============================================================================
// PHASE 3 — Genome Library
// ============================================================================

/** Named style evolved toward a specific Pareto optimum. */
export type GenomeStyle =
  | "balanced"
  | "aggressive"
  | "counter"
  | "patient"
  | "rushdown"
  | "mindGame"
  | "adaptive"
  | "zoner"
  | "pressure";

/** Entry in the exported genome library. */
export interface ILibraryEntry {
  style: GenomeStyle;
  genome: IGenome;
  /** Fitness weights used to evolve this style. */
  weights: IFitnessWeights;
  /** Benchmark scores across all archetypes. */
  benchmarks: Record<string, number>;
  /** Narrative description for the Director. */
  narrative: string;
}

/** Director-facing library of evolved styles. */
export interface IGenomeLibrary {
  version: string;
  exportedAt: string;
  baseOpponent: string;
  entries: Record<GenomeStyle, ILibraryEntry>;
}

// ============================================================================
// PHASE 6 — Dataset Generation
// ============================================================================

/** A single training sample for future LLM fine-tuning. */
export interface IDatasetSample {
  /** Unique sample id. */
  id: string;

  /** When the sample was generated. */
  timestamp: string;

  /** Evolution generation. */
  generation: number;

  /** Simulation context. */
  context: {
    archetypeId: string;
    baseOpponent: string;
    roundsToWin: number;
    seed: number;
  };

  /** The genome used for the AI. */
  genome: IGenome;

  /** The player archetype faced. */
  archetype: string;

  /** High-level AI decision policy represented by the genome. */
  decision: {
    style: string;
    primaryStrategy: string;
    riskLevel: number;
  };

  /** Match result. */
  result: {
    genomeWon: boolean;
    genomeRoundsWon: number;
    playerRoundsWon: number;
    genomeHpFrac: number;
    playerHpFrac: number;
    durationSeconds: number;
    timeout: boolean;
  };

  /** Fitness and objective scores. */
  fitness: number;
  objectiveScores: Record<string, number>;

  /** Telemetry metrics. */
  metrics: {
    genomeHits: number;
    playerHits: number;
    genomeDamageDealt: number;
    playerDamageDealt: number;
    genomeMaxCombo: number;
    playerMaxCombo: number;
    genomeBlockTime: number;
    playerBlockTime: number;
    distanceStdDev: number;
    genomeAttackKindsUsed: number;
  };

  /** Outcome label for classification. */
  outcome: "win" | "loss" | "draw" | "timeout";
}

// ============================================================================
// PHASE 7 — Self Play
// ============================================================================

/** Result of a single genome-vs-genome match. */
export interface ISelfPlayMatch {
  genomeAId: string;
  genomeBId: string;
  winnerId: string | "draw";
  roundsWonA: number;
  roundsWonB: number;
  durationSeconds: number;
}

/** Tournament format. */
export type TournamentFormat = "roundRobin" | "swiss" | "singleElimination";

/** Self-play tournament result. */
export interface ISelfPlayTournament {
  format: TournamentFormat;
  matches: ISelfPlayMatch[];
  standings: Array<{ genomeId: string; wins: number; losses: number; draws: number; score: number }>;
}

// ============================================================================
// PHASE 8 — Narrative Connection
// ============================================================================

/** A narrative trait derived from genome statistics. */
export interface INarrativeTrait {
  /** Trait category: e.g. "patience", "aggression", "counter", "adaptation". */
  category: string;

  /** Human-readable description. */
  description: string;

  /** Strength 0..1. */
  strength: number;

  /** Genome gene primarily responsible. */
  sourceGene?: keyof IGenome;
}

// ============================================================================
// PHASE 9 — Director Integration
// ============================================================================

/** Director intent when selecting a genome style. */
export type DirectorIntent =
  | "teachSpacing"
  | "punishRecklessness"
  | "emotionalClimax"
  | "introduceMechanic"
  | "buildTension"
  | "rewardPatience"
  | "testAdaptation"
  | "balanced";

/** Minimal player profile used by the Director to choose a style. */
export interface IDirectorPlayerProfile {
  aggression: number;
  defense: number;
  reaction: number;
  adaptability: number;
  patience: number;
  winRate: number;
  preferredRange: "close" | "mid" | "far";
}

/** Selection input for the Director. */
export interface IGenomeSelectionInput {
  intent: DirectorIntent;
  playerProfile?: IDirectorPlayerProfile;
  campaignStage?: number;
  previousStyle?: GenomeStyle;
}

// ============================================================================
// PHASE 10 — Research Features
// ============================================================================

/** Research/evaluation report. */
export interface IResearchReport {
  /** Average pairwise genome distance. */
  genomeDiversity: number;

  /** Average behaviour diversity across matches. */
  behaviourDiversity: number;

  /** Generations per unit fitness improvement. */
  evolutionSpeed: number;

  /** Whether the population converged (diversity < threshold). */
  converged: boolean;

  /** Shannon entropy of the population. */
  populationEntropy: number;

  /** Fitness distribution buckets. */
  fitnessDistribution: { min: number; max: number; buckets: number[] };

  /** Pareto-optimal genomes across multiple objectives. */
  paretoFront: IGenome[];

  /** Champion comparison table. */
  championComparison: Array<{
    genomeId: string;
    fitness: number;
    archetypeStrengths: Record<string, number>;
    style: string;
  }>;

  generatedAt: string;
}

// ============================================================================
// BONUS — LLM Integration Interfaces
// ============================================================================

/** Experiment configuration an LLM can propose. */
export interface ILLMExperimentConfig {
  name: string;
  description: string;
  fitness: Partial<IFitnessWeights>;
  mutation?: Partial<IMutationConfig>;
  crossover?: Partial<ICrossoverConfig>;
  selectionStrategy?: string;
  populationSize?: number;
  generations?: number;
  targetStyles?: GenomeStyle[];
}

/** LLM-modifiable configuration surface. */
export interface ILLMConfigurableSurface {
  fitnessWeights: IFitnessWeights;
  mutationConfig: IMutationConfig;
  selectionStrategy: ISelectionStrategy;
  crossoverConfig: ICrossoverConfig;
  experiments: ILLMExperimentConfig[];
}
