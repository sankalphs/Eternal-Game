// ============================================================================
// PROJECT ETERNAL — INTENT TRAINING SAMPLE
//
// The new training sample format. This is what the fine-tuned model
// learns from. INPUT is the IntentContext (all the player / world /
// campaign / genome / narrative / emotion data). OUTPUT is the
// IntentOutput (intent / reasoning / expectedPlayerReaction /
// highLevelPlan / confidence).
//
// Crucially: NO weather, NO camera, NO music, NO hazards, NO boss
// style, NO difficulty in the OUTPUT. The Director handles those.
//
// This is the canonical schema. The Modal training script consumes
// these. The exported JSONL files use this exact shape.
// ============================================================================

import type { IntentOutput } from "./IntentSchema";
import type { GameDesignContext } from "../gamedesigner/types";

// Re-export IntentContext as a re-export of GameDesignContext for
// clarity. The two types are structurally identical in the new
// architecture — the model sees the full context, but it only
// produces intent.
export type IntentContext = GameDesignContext;

// --------------------------------------------------------------------------
//  INPUT — what the model sees
// --------------------------------------------------------------------------

export interface IntentTrainingInput {
  /** The compressed intent context (player / world / campaign / etc). */
  context: IntentContext;
  /** Pre-rendered prompt text (system + developer + user). The training
   *  pipeline uses this directly; it avoids re-rendering the prompt
   *  on every epoch. */
  promptText: string;
  /** Pre-rendered user message only. For chat-style fine-tuning. */
  userText: string;
  /** Pre-rendered system message. */
  systemText: string;
  /** Context hash (for dedup). */
  contextHash: string;
}

// --------------------------------------------------------------------------
//  OUTPUT — what the model produces
// --------------------------------------------------------------------------

export interface IntentTrainingOutput {
  intent: IntentOutput;
  /** Rendered target text (canonical JSON). */
  targetText: string;
  /** Categorised intent (for analytics). */
  intentCategory: string;
  /** Ground-truth confidence (0..1) — derived from quality. */
  groundTruthConfidence: number;
}

// --------------------------------------------------------------------------
//  Sample
// --------------------------------------------------------------------------

export type SampleOrigin =
  | "ga_vs_ga"               // GA evolved genome vs GA evolved player archetype
  | "ga_vs_player_archetype" // GA evolved genome vs scripted player archetype
  | "ga_vs_frozen_champion"  // GA evolved genome vs frozen champion
  | "student_vs_champion"    // Student model intent vs frozen champion
  | "student_vs_distilled"   // Student intent vs distilled teacher
  | "student_vs_ga"          // Student intent vs GA-derived intent
  | "director_intent_eval"   // Director V3 vs V5 (intent-aware) head-to-head
  | "replay_eval"            // Replay-evaluated intent
  | "active_learning"        // Active-learning-flagged intent
  | "offline_distillation"   // Offline-distilled intent
  | "research_validation"    // Research-dashboard-validated intent
  | "human_reviewed"         // Human-curated
  | "synthetic";             // Pure synthetic from PromptLibrary few-shot

export type SampleGrade = "gold" | "high" | "medium" | "low" | "discard";

export interface IntentTrainingSample {
  id: string;
  timestamp: number;

  input: IntentTrainingInput;
  output: IntentTrainingOutput;

  // ---- Provenance ----
  origin: SampleOrigin;
  grade: SampleGrade;
  /** Confidence from the model/teacher (0..1). */
  teacherConfidence: number;
  /** Quality score (0..1) from the QualityEngine. */
  quality: number;
  /** Whether the sample passed validation. */
  validated: boolean;
  /** Whether the sample was a fallback (rejected by the Director). */
  fellback: boolean;
  /** Tags for filtering (e.g. "overconfident", "turtle", "frustrated"). */
  tags: string[];

  // ---- Real outcome (filled in after a replay) ----
  actualResult: {
    playerWon: boolean;
    roundsToWin: number;
    damageDealt: number;
    damageTaken: number;
    durationSeconds: number;
    engaged: boolean;
  } | null;

  // ---- Replay evaluation ----
  replay: {
    baselineDirectorScore: number;     // score of Director V3 baseline
    intentDirectorScore: number;       // score of Director V5 (intent-aware)
    delta: number;                     // intent - baseline
  } | null;

  // ---- Versioning ----
  versions: {
    dataset: string;
    genome: string;
    teacher: string;
    prompt: string;
    model: string;
    trainingConfig: string;
    distillation: string;
    experiment: string;
  };

  /** Free-form notes from the curator / generator. */
  notes: string;
}

// --------------------------------------------------------------------------
//  Builder
// --------------------------------------------------------------------------

export class IntentTrainingSampleBuilder {
  private next: Partial<IntentTrainingSample> = {};

  constructor(id?: string) {
    this.next.id = id ?? `is_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.next.timestamp = Date.now();
  }

  setContext(context: GameDesignContext, promptText: string, userText: string, systemText: string, contextHash: string): this {
    this.next.input = { context, promptText, userText, systemText, contextHash };
    return this;
  }

  setOutput(intent: IntentOutput, targetText: string, intentCategory: string, groundTruthConfidence: number): this {
    this.next.output = {
      intent,
      targetText,
      intentCategory,
      groundTruthConfidence,
    };
    return this;
  }

  setProvenance(origin: SampleOrigin, grade: SampleGrade, teacherConfidence: number, quality: number, validated: boolean, fellback: boolean, tags: string[]): this {
    this.next.origin = origin;
    this.next.grade = grade;
    this.next.teacherConfidence = teacherConfidence;
    this.next.quality = quality;
    this.next.validated = validated;
    this.next.fellback = fellback;
    this.next.tags = tags;
    if (!this.next.actualResult) this.next.actualResult = null;
    if (!this.next.replay) this.next.replay = null;
    return this;
  }

  setActualResult(r: IntentTrainingSample["actualResult"]): this {
    this.next.actualResult = r;
    return this;
  }

  setReplay(r: IntentTrainingSample["replay"]): this {
    this.next.replay = r;
    return this;
  }

  setVersions(v: IntentTrainingSample["versions"]): this {
    this.next.versions = v;
    return this;
  }

  setNotes(notes: string): this {
    this.next.notes = notes;
    return this;
  }

  build(): IntentTrainingSample {
    if (!this.next.input) throw new Error("IntentTrainingSampleBuilder: input not set");
    if (!this.next.output) throw new Error("IntentTrainingSampleBuilder: output not set");
    if (!this.next.origin) throw new Error("IntentTrainingSampleBuilder: origin not set");
    if (!this.next.grade) this.next.grade = "medium";
    if (!this.next.versions) throw new Error("IntentTrainingSampleBuilder: versions not set");
    if (!this.next.notes) this.next.notes = "";
    if (!this.next.tags) this.next.tags = [];
    if (!this.next.actualResult) this.next.actualResult = null;
    if (!this.next.replay) this.next.replay = null;
    return this.next as IntentTrainingSample;
  }
}
