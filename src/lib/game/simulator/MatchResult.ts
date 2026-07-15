// ============================================================================
// SIMULATOR — MATCH RESULT TYPES
//
// Pure data structures describing what happened in a fight. Designed for
// zero-allocation reuse in hot loops (fixed-shape objects, no nested
// arrays-of-arrays where avoidable).
// ============================================================================

// ---- Per-side aggregate stats from one fight ----
export interface SideStats {
  /** Total HP dealt. */
  damageDealt: number;
  /** Total HP taken. */
  damageTaken: number;
  /** Successful hits landed. */
  hits: number;
  /** Hits blocked by the defender. */
  hitsBlocked: number;
  /** Maximum combo length. */
  maxCombo: number;
  /** Total combo count. */
  totalCombos: number;
  /** Combo length distribution. */
  comboHistogram: Record<number, number>;
  /** Attack-kind distribution. */
  attackKinds: Record<string, number>;
  /** Approx. attack time (s). */
  attackTime: number;
  /** Approx. block time (s). */
  blockTime: number;
  /** Approx. distance to opponent — mean. */
  distanceMean: number;
  /** Approx. distance to opponent — stddev. */
  distanceStdDev: number;
  /** Final HP fraction (0..1). */
  hpFrac: number;
  /** Max HP. */
  maxHp: number;
  /** Number of rounds won. */
  roundsWon: number;
}

// ---- Per-round breakdown ----
export interface RoundResult {
  roundIndex: number;
  /** Side index 0 (player) or 1 (enemy) that won. */
  winnerSide: 0 | 1 | null;
  /** Whether the round ended by timeout. */
  timeout: boolean;
  /** Final HP fractions per side. */
  hpFrac: [number, number];
  /** Round duration (s). */
  durationSeconds: number;
  /** Damage dealt per side. */
  damage: [number, number];
  /** Max combo per side. */
  maxCombo: [number, number];
}

// ---- The full result of one fight ----
export interface FightResult {
  /** Unique run id. */
  id: string;
  /** Seed used. */
  seed: number;
  /** Identifier of the match type. */
  matchType: MatchTypeId;
  /** Identifier of the first fighter (label). */
  sideAId: string;
  /** Identifier of the second fighter. */
  sideBId: string;
  /** 0 = sideA won, 1 = sideB won, null = draw. */
  winnerSide: 0 | 1 | null;
  /** Aggregate stats per side. */
  sideA: SideStats;
  sideB: SideStats;
  /** Rounds played. */
  rounds: RoundResult[];
  /** Total wall-time in seconds (only useful for speed analysis). */
  durationSeconds: number;
  /** Did the match end by timeout? */
  timedOut: boolean;
  /** Free-form metadata (e.g. archetype, model, prompt version). */
  meta: FightMetadata;
  /** Director decisions (if any). */
  directorDecisions: DirectorDecision[];
}

// ---- Free-form metadata (typed) ----
export interface FightMetadata {
  /** Match type id (echoed on the FightResult for convenience). */
  matchType?: MatchTypeId;
  /** Subject id (the focal genome / model / student). */
  subjectId?: string;
  archetypeId?: string;
  genomeId?: string;
  genomeIds?: [string, string];
  modelId?: string;
  promptVersion?: string;
  datasetVersion?: string;
  directorVersion?: "V3" | "V4";
  teacherVersion?: string;
  studentVersion?: string;
  baseOpponent?: string;
  roundsToWin?: number;
  // Campaign fields
  campaignId?: string;
  chapterIndex?: number;
  emotion?: string;
  difficulty?: string;
  // Tags
  tags?: string[];
  /** Free-form extras (predictedConfidence, predictionAccuracy, llmAgreement, etc.) */
  [key: string]: unknown;
}

// ---- A director decision captured during a fight ----
export interface DirectorDecision {
  phase: "pre-fight" | "mid-fight" | "post-fight";
  side: 0 | 1 | "system";
  decision: string;
  rationale?: string;
  /** Snapshot of relevant state. */
  context?: Record<string, number | string | boolean>;
}

// ---- All match type ids ----
export type MatchTypeId =
  | "ga_vs_ga"
  | "ga_vs_archetype"
  | "student_vs_ga"
  | "student_vs_teacher"
  | "student_vs_baseline"
  | "director_v3_vs_v4"
  | "campaign_vs_campaign";

// ---- Aggregated result over many fights ----
export interface SeriesResult {
  /** Id of the series. */
  id: string;
  /** Match type. */
  matchType: MatchTypeId;
  /** Side A id. */
  sideAId: string;
  /** Side B id. */
  sideBId: string;
  /** All fight results. */
  fights: FightResult[];
  /** Aggregate stats. */
  aggregate: SeriesAggregate;
}

export interface SeriesAggregate {
  /** Total fights. */
  n: number;
  /** Side A wins. */
  winsA: number;
  /** Side B wins. */
  winsB: number;
  /** Draws. */
  draws: number;
  /** Side A win rate. */
  winRateA: number;
  /** Side B win rate. */
  winRateB: number;
  /** Average fight duration (s). */
  avgDuration: number;
  /** Average damage dealt by side A. */
  avgDamageA: number;
  /** Average damage dealt by side B. */
  avgDamageB: number;
  /** Average combo variety per side. */
  avgComboVariety: number;
  /** Average behaviour diversity (Shannon). */
  avgBehaviourDiversity: number;
  /** Average prediction accuracy (if a predictor was attached). */
  avgPredictionAccuracy: number;
  /** Total simulation time (s). */
  totalSimSeconds: number;
  /** Wall time (s). */
  totalWallSeconds: number;
  /** Fights per second. */
  throughputFps: number;
}

// ---- Empty stats factory (zero-alloc reuse) ----
export function emptySideStats(maxHp: number): SideStats {
  return {
    damageDealt: 0,
    damageTaken: 0,
    hits: 0,
    hitsBlocked: 0,
    maxCombo: 0,
    totalCombos: 0,
    comboHistogram: Object.create(null),
    attackKinds: Object.create(null),
    attackTime: 0,
    blockTime: 0,
    distanceMean: 0,
    distanceStdDev: 0,
    hpFrac: 1,
    maxHp,
    roundsWon: 0,
  };
}
