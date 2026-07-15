// ============================================================================
// AI PIPELINE — orchestrates the full AI infrastructure.
//
// This is the single entry point. The game component calls
// pipeline.planFight(context) and receives a validated, confidence-scored
// DirectorPlan. The pipeline handles all the intermediate steps.
//
// Flow:
//   Context → Prompt → Inference → Parse → Validate → Score → (Fallback?)
//   → Feedback → Dataset Log
// ============================================================================

import { FeatureEncoder } from "./FeatureEncoder";
import { ContextBuilder } from "./ContextBuilder";
import { PromptBuilder } from "./PromptBuilder";
import { InferenceManager } from "./InferenceManager";
import { ResponseParser } from "./ResponseParser";
import { SchemaValidator } from "./SchemaValidator";
import { ConfidenceEngine } from "./ConfidenceEngine";
import { FeedbackCollector } from "./FeedbackCollector";
import { DatasetLogger } from "./DatasetLogger";
import { MockAdapter, OllamaAdapter, RemoteAPIAdapter } from "./models/Adapters";
import type {
  AIContext, PromptSet, InferenceRequest, InferenceResult,
  AIDirectorOutput, ConfidenceScoredOutput, FeedbackEntry, DatasetSample,
  AIModel, AIModelMetadata,
} from "./types";
import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { PlayerEstimate } from "../prediction/PlayerAnalyzer";
import type { PlayerPrediction } from "../prediction/PredictionEngine";
import type { DerivedWorldState } from "../eventsourcing/WorldHistory";
import type { BossMemory } from "../world/WorldState";
import type { CampaignChapter } from "../campaign/CampaignPlanner";

export interface PipelineResult {
  output: AIDirectorOutput;
  confidence: ConfidenceScoredOutput;
  rawModelOutput: string;
  modelId: string;
  latencyMs: number;
  fromCache: boolean;
  fellback: boolean;
  warnings: string[];
  sampleId: string;
}

export class AIPipeline {
  encoder = new FeatureEncoder();
  contextBuilder = new ContextBuilder();
  promptBuilder = new PromptBuilder();
  inference: InferenceManager;
  parser = new ResponseParser();
  validator = new SchemaValidator();
  confidence = new ConfidenceEngine();
  feedback = new FeedbackCollector();
  dataset = new DatasetLogger();

  private currentSampleId: string | null = null;
  private currentPrediction: PlayerPrediction | null = null;

  constructor() {
    this.inference = new InferenceManager();
    // Register the mock adapter as the default + fallback
    this.inference.registerModel(new MockAdapter());
    this.inference.setActiveModel("mock");
  }

  /**
   * Register a local Ollama model (Gemma, Qwen, Phi, TinyLlama, etc.)
   */
  registerOllamaModel(model: string, baseUrl = "http://localhost:11434"): void {
    this.inference.registerModel(new OllamaAdapter(model, baseUrl));
  }

  /**
   * Register a remote API model (OpenAI-compatible endpoint)
   */
  registerRemoteModel(model: string, endpoint: string, apiKey: string): void {
    this.inference.registerModel(new RemoteAPIAdapter(model, endpoint, apiKey));
  }

  /**
   * Switch the active model.
   */
  setModel(modelId: string): boolean {
    return this.inference.setActiveModel(modelId);
  }

  /**
   * List all registered models.
   */
  listModels(): AIModelMetadata[] {
    return this.inference.listModels().map(id => {
      const model = this.inference.getActiveModel();
      return model?.metadata() ?? { id, label: id, type: "mock" as const, maxTokens: 0, contextWindow: 0, supportsJSON: false, version: "" };
    });
  }

  /**
   * Run the full AI pipeline to generate a DirectorPlan for the next fight.
   * Called BEFORE combat, never during.
   */
  async planFight(params: {
    profile: PlayerProfile;
    estimate: PlayerEstimate;
    prediction: PlayerPrediction;
    worldState: DerivedWorldState;
    bossMemory: BossMemory | null;
    chapter: CampaignChapter | null;
    chapterIndex: number;
    totalChapters: number;
    objective: string;
  }): Promise<PipelineResult> {
    const { profile, estimate, prediction, worldState, bossMemory, chapter, chapterIndex, totalChapters, objective } = params;
    this.currentPrediction = prediction;

    // 1. Encode features
    const features = this.encoder.encode(profile, estimate);

    // 2. Build context
    let context = this.contextBuilder.build({
      features, prediction, worldState, bossMemory, chapter, chapterIndex, totalChapters, objective,
    });
    // Compress if needed (based on active model's context window)
    context = this.contextBuilder.compress(context, 4096);

    // 3. Build prompt
    const prompt = this.promptBuilder.build(context);

    // 4. Run inference
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const inferenceResult = await this.inference.infer({
      prompt,
      maxTokens: 1024,
      temperature: 0.7,
      requestId,
    });

    // 5. Parse response
    const { output: parsedOutput, warnings: parseWarnings } = this.parser.parse(inferenceResult.text);

    // If parsing completely failed, use emergency fallback
    if (!parsedOutput) {
      const fallbackOutput: AIDirectorOutput = {
        weather: "clear", lighting: "normal", camera: "wide", music: "ancient",
        crowd: "silent", hazards: [], bossStyle: "aggressive", bossEmotion: "resolute",
        dialogueStyle: "cold", difficulty: "normal", arenaStage: 0,
        narrative: "A standard encounter.", intent: "Fallback: parsing failed.",
      };
      return this.finalize(fallbackOutput, context, prompt, inferenceResult, [], ["Parsing failed — emergency fallback"], 0.0, true);
    }

    // 6. Validate schema
    const { output: validatedOutput, errors: validationErrors, warnings: validationWarnings } = this.validator.validate(parsedOutput);
    const allWarnings = [...parseWarnings, ...validationWarnings];

    // 7. Score confidence
    const modelReliability = inferenceResult.modelId === "mock" ? 0.7 : 0.8;
    const confidence = this.confidence.score(validatedOutput, parseWarnings, validationWarnings, modelReliability);

    // 8. Check if fallback needed
    const fellback = this.confidence.shouldFallback(confidence);

    // 9. Log dataset sample
    const sampleId = this.dataset.log({
      context, prompt,
      modelOutput: inferenceResult.text,
      parsedOutput: validatedOutput,
      validated: validationErrors.length === 0,
      confidence: confidence.overall,
      fellback,
      modelId: inferenceResult.modelId,
    });
    this.currentSampleId = sampleId;

    return this.finalize(validatedOutput, context, prompt, inferenceResult, allWarnings, validationErrors, confidence.overall, fellback, sampleId);
  }

  /**
   * Record feedback after the match (called by the component).
   */
  recordFeedback(params: {
    profile: PlayerProfile;
    playerWon: boolean;
    directorPlanUsed: boolean;
    latencyMs: number;
    modelId: string;
  }): void {
    if (!this.currentPrediction) return;

    const entry = this.feedback.record({
      requestId: this.currentSampleId ?? "unknown",
      prediction: this.currentPrediction,
      actualProfile: params.profile,
      playerWon: params.playerWon,
      directorPlanUsed: params.directorPlanUsed,
      modelId: params.modelId,
      latencyMs: params.latencyMs,
    });

    // Update the dataset sample with the result
    if (this.currentSampleId) {
      this.dataset.updateResult(this.currentSampleId, {
        playerWon: params.playerWon,
        roundsToWin: 0,
        damageDealt: params.profile.totalDamageDealt,
        damageTaken: params.profile.totalDamageTaken,
      });
    }
  }

  /**
   * Get all debug stats (for the AI Debug Panel).
   */
  getDebugStats() {
    return {
      inference: this.inference.getStats(),
      feedback: this.feedback.getMetrics(),
      dataset: this.dataset.getStats(),
      models: this.listModels(),
    };
  }

  /**
   * Export the dataset (for fine-tuning).
   */
  exportDataset(): string {
    return this.dataset.exportJSONL();
  }

  // ---- Internal ----

  private finalize(
    output: AIDirectorOutput,
    context: AIContext,
    prompt: PromptSet,
    inference: InferenceResult,
    warnings: string[],
    errors: string[],
    confidenceScore: number,
    fellback: boolean,
    sampleId?: string,
  ): PipelineResult {
    const confidence = this.confidence.score(output, warnings, errors, inference.modelId === "mock" ? 0.7 : 0.8);

    const id = sampleId ?? this.dataset.log({
      context, prompt,
      modelOutput: inference.text,
      parsedOutput: output,
      validated: errors.length === 0,
      confidence: confidenceScore,
      fellback,
      modelId: inference.modelId,
    });

    return {
      output,
      confidence,
      rawModelOutput: inference.text,
      modelId: inference.modelId,
      latencyMs: inference.latencyMs,
      fromCache: inference.fromCache,
      fellback,
      warnings: [...warnings, ...errors],
      sampleId: id,
    };
  }
}
