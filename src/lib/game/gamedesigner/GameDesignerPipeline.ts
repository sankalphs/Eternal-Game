// ============================================================================
// GAME DESIGNER PIPELINE — top-level orchestrator
//
// Wires the GameDesigner together with the Director V4, the dataset logger,
// the quality engine, the prompt library, the explanation engine, and the
// training readiness exporter. The component layer uses ONLY this class.
//
// Layered on top of the existing AI middleware — does NOT replace it.
// ============================================================================

import { GameDesigner } from "./GameDesigner";
import { GameDesignContextBuilder, type BuildContextParams } from "./GameDesignContextBuilder";
import { GameDesignDatasetLogger, type GameDesignSample, type GameDesignActualResult } from "./GameDesignDatasetLogger";
import { GameDesignQualityEngine, type GameDesignQualityScore } from "./GameDesignQualityEngine";
import { PromptLibrary, PromptVersionTracker } from "./PromptLibrary";
import { ExplanationEngine } from "./ExplanationEngine";
import { GameDesignOutputValidator } from "./GameDesignOutputValidator";
import { ReplayEvaluator, type ReplayReport } from "./ReplayEvaluator";
import { TrainingReadinessExporter, type ExportBundle, type ExportOptions, type DatasetStats } from "./TrainingReadinessExporter";
import { DirectorEngineV4, type DirectorV4Deps, type DirectorPlanV4 } from "../director/DirectorEngineV4";
import {
  DeterministicMockAdapter,
  createModelAdapter,
  type GameDesignerModelId,
  type ModelAdapterOptions,
} from "./ModelAdapters";
import type { AIModel } from "../ai/types";

export class GameDesignerPipeline {
  contextBuilder = new GameDesignContextBuilder();
  designer: GameDesigner;
  dataset = new GameDesignDatasetLogger();
  quality = new GameDesignQualityEngine();
  promptLibrary = new PromptLibrary();
  promptTracker = new PromptVersionTracker();
  explanations = new ExplanationEngine();
  validator = new GameDesignOutputValidator();
  replay = new ReplayEvaluator();
  exporter: TrainingReadinessExporter;
  directorV4 = new DirectorEngineV4();
  private activeModel: AIModel;

  constructor(opts?: {
    model?: GameDesignerModelId;
    modelOptions?: ModelAdapterOptions;
    activePromptVersion?: string;
    datasetMaxSamples?: number;
  }) {
    if (opts?.model) {
      this.activeModel = createModelAdapter(opts.model, opts.modelOptions);
    } else {
      this.activeModel = new DeterministicMockAdapter();
    }

    this.designer = new GameDesigner({
      model: this.activeModel,
      promptLibrary: this.promptLibrary,
      validator: this.validator,
      explanations: this.explanations,
      dataset: this.dataset,
    });

    if (opts?.activePromptVersion) {
      this.designer.setPromptVersion(opts.activePromptVersion);
    }

    this.exporter = new TrainingReadinessExporter(this.dataset);
    if (opts?.datasetMaxSamples) {
      this.dataset = new GameDesignDatasetLogger(opts.datasetMaxSamples);
      this.exporter = new TrainingReadinessExporter(this.dataset);
      this.designer.deps.dataset = this.dataset;
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Switch model at runtime.
   */
  setModel(model: GameDesignerModelId, modelOptions?: ModelAdapterOptions): void {
    this.activeModel = createModelAdapter(model, modelOptions);
    this.designer.setModel(this.activeModel);
  }

  /**
   * Switch prompt version at runtime.
   */
  setPromptVersion(version: string): boolean {
    return this.designer.setPromptVersion(version);
  }

  /**
   * Run the full pipeline:
   *   1. Build GameDesignContext from all available state.
   *   2. Ask the GameDesigner for a high-level design plan.
   *   3. Forward to the Director V4.
   *   4. The Director converts the plan into a DirectorPlanV3 (gameplay).
   */
  async planFight(params: BuildContextParams & { previousDirectorPlans?: import("../director/DirectorEngineV3").DirectorPlanV3[]; modelConfidenceThreshold?: number }): Promise<{
    design: import("./GameDesigner").DesignResult;
    director: DirectorPlanV4;
  }> {
    const ctx = this.contextBuilder.build(params);
    const design = await this.designer.design(ctx);
    this.promptTracker.record(design.sampleId, design.promptVersion);

    // Build Director V4 deps
    const v4Deps: DirectorV4Deps = {
      estimate: params.playerEstimate,
      prediction: params.playerPrediction,
      worldState: params.worldState ?? this.contextBuilder["deriveEmptyWorld"](),
      campaignPlan: params.campaignPlan ?? this.contextBuilder["emptyCampaignPlan"](),
      chapterIndex: params.chapterIndex,
      storyEvent: params.narrativeState,
      gameDesigner: this.designer,
      contextBuilder: this.contextBuilder,
      buildContextExtra: {
        genomeLibrary: params.genomeLibrary,
        currentDifficultyId: params.currentDifficultyId,
        arenaId: params.arenaId,
        arenaDamage: params.arenaDamage,
        activeHazardTypes: params.activeHazardTypes,
        campaignResults: params.campaignResults,
        narrativeState: params.narrativeState,
        bossMemory: params.bossMemory,
      },
      previousDirectorPlans: params.previousDirectorPlans ?? [],
      modelConfidenceThreshold: params.modelConfidenceThreshold ?? 0.5,
    };

    const director = await this.directorV4.planFight(v4Deps);
    return { design, director };
  }

  /**
   * Update a sample with the actual fight result.
   */
  recordResult(sampleId: string, result: GameDesignActualResult): void {
    this.dataset.updateResult(sampleId, result);
  }

  /**
   * Get all logged samples.
   */
  getSamples(): GameDesignSample[] {
    return this.dataset.getSamples();
  }

  /**
   * Get dataset statistics.
   */
  getStats() {
    return this.dataset.getStats();
  }

  /**
   * Export the dataset for fine-tuning.
   */
  exportForFineTuning(opts?: Partial<ExportOptions>): ExportBundle {
    return this.exporter.exportBundle(opts);
  }

  /**
   * Run a replay evaluation.
   */
  async runReplayEvaluation(newModel: GameDesignerModelId, newModelOptions?: ModelAdapterOptions): Promise<ReplayReport> {
    const replayDesigner = new GameDesigner({
      model: createModelAdapter(newModel, newModelOptions),
      promptLibrary: this.promptLibrary,
      validator: this.validator,
      explanations: this.explanations,
      dataset: this.dataset,
    });
    return this.replay.replay({
      samples: this.dataset.getSamples(),
      designer: replayDesigner,
      sourceModelId: this.activeModel.metadata().id,
      newModelId: createModelAdapter(newModel, newModelOptions).metadata().id,
    });
  }

  /**
   * Read-only access to the design quality engine.
   */
  scoreSample(sample: GameDesignSample): GameDesignQualityScore {
    return this.quality.score(sample);
  }

  /**
   * Read-only access to the prompt version tracker.
   */
  getPromptVersionStats(): Record<string, number> {
    return this.promptTracker.countByVersion();
  }
}
