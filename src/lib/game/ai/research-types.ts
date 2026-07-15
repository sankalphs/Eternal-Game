// ============================================================================
// RESEARCH-GRADE AI MIDDLEWARE — SHARED TYPES (extends existing types.ts)
//
// These types extend the existing AI infrastructure with research-grade
// capabilities: memory retrieval, prompt strategies, batch scheduling,
// dataset quality scoring, evaluation, and experiments.
// ============================================================================

import type { AIContext, PromptSet, AIDirectorOutput, FeedbackEntry } from "./types";

// ---- Phase 1/2: Memory Retrieval ----
export interface MemoryRecord {
  id: string;
  source: "world" | "boss" | "campaign" | "myth" | "director_plan" | "prediction";
  content: string;          // serialized JSON or text
  timestamp: number;
  importance: number;        // 0..1
  frequency: number;         // how often this memory type has been accessed
  tags: string[];            // for filtering (e.g. ["kickSpam", "Titan"])
}

export interface RetrievedMemory {
  record: MemoryRecord;
  score: number;             // retrieval score (0..1)
  reason: string;            // why this memory was selected
}

export interface MemoryQuery {
  context: AIContext;
  k: number;                 // top-K memories to retrieve
  sources?: string[];        // filter by source type
  minImportance?: number;    // filter by importance
}

// Retriever interface — swappable (deterministic → embedding → hybrid)
export interface MemoryRetriever {
  retrieve(query: MemoryQuery): RetrievedMemory[];
  index(records: MemoryRecord[]): void;
  clear(): void;
  metadata(): { type: string; indexedCount: number };
}

// ---- Phase 3: Prompt Strategy ----
export interface PromptStrategy {
  id: string;
  contextMaxLength: number;
  fewShotCount: number;
  verbosity: "minimal" | "normal" | "verbose";
  reasoningBudget: number;   // max tokens for model reasoning
  buildPrompt(context: AIContext, memories: RetrievedMemory[]): PromptSet;
}

// ---- Phase 4: Batch Scheduling ----
export interface BatchedRequest {
  id: string;
  request: InferenceRequestLike;
  priority: number;          // 0=highest
  deadline: number;          // timestamp ms
  resolve: (result: any) => void;
  reject: (err: any) => void;
}

export interface InferenceRequestLike {
  prompt: PromptSet;
  maxTokens: number;
  temperature: number;
  requestId: string;
}

export interface BatchScheduleConfig {
  maxBatchSize: number;
  batchWindowMs: number;     // wait this long before flushing
  enableBatching: boolean;
}

export interface BatchStats {
  totalBatches: number;
  avgBatchSize: number;
  totalRequests: number;
  batchedRequests: number;
  cancelledRequests: number;
  avgWaitMs: number;
}

// ---- Phase 5: Dataset Quality ----
export type DatasetQuality = "high" | "medium" | "discard";

export interface DatasetQualityScore {
  predictionCorrectness: number;  // 0..1
  novelty: number;                // 0..1 (how different from other samples)
  behaviourDiversity: number;     // 0..1
  narrativeUniqueness: number;    // 0..1
  campaignImpact: number;         // 0..1 (did the fight outcome matter?)
  confidence: number;             // 0..1
  overall: number;                // weighted average
  quality: DatasetQuality;
}

// ---- Phase 6: Evaluation ----
export interface CampaignEvaluation {
  campaignId: string;
  timestamp: number;
  metrics: {
    predictionAccuracy: number;
    campaignCoherence: number;
    narrativeConsistency: number;
    difficultyBalance: number;
    playerBehaviourPrediction: number;
    bossAdaptation: number;
    emotionCurveAccuracy: number;
    directorDiversity: number;
    avgConfidence: number;
    longTermAdaptation: number;
  };
  chaptersPlayed: number;
  chaptersWon: number;
  totalDuration: number;
  reportText: string;
}

// ---- Phase 7: Experiment ----
export interface ExperimentVariant {
  id: string;
  label: string;
  modelId: string;
  promptStrategyId: string;
  retrieverType: string;
  config: Record<string, unknown>;
}

export interface ExperimentResult {
  experimentId: string;
  variantId: string;
  campaignId: string;
  metrics: CampaignEvaluation["metrics"];
  timestamp: number;
}

export interface Experiment {
  id: string;
  label: string;
  variants: ExperimentVariant[];
  results: ExperimentResult[];
  active: boolean;
}
