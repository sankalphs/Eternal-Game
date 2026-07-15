// ============================================================================
// PHASE 4: GAME DESIGN DATASET LOGGER
//
// Logs every (context, plan, outcome) triple as a supervised training
// sample. Built ON TOP of the existing DatasetLogger pattern (src/lib/game/
// ai/DatasetLogger.ts) — does NOT replace it.
//
// Each sample is the input → output pair the model will learn from.
// Exports as JSONL with no placeholders.
// ============================================================================

import type { GameDesignContext } from "./types";
import type { GameDesignPlan } from "./GameDesignPlan";
import { GameDesignQualityEngine, type GameDesignQualityScore } from "./GameDesignQualityEngine";

export interface GameDesignActualResult {
  playerWon: boolean;
  roundsToWin: number;
  damageDealt: number;
  damageTaken: number;
  durationSeconds: number;
  // Did the player engage with the design (e.g. didn't quit immediately)?
  engaged: boolean;
}

export interface GameDesignSample {
  id: string;
  timestamp: number;

  // Input
  context: GameDesignContext;
  contextHash: string;           // sha-like, for dedup

  // Output
  plan: GameDesignPlan;
  explanation: string;

  // Metadata
  modelId: string;
  promptVersion: string;
  rawModelOutput: string;
  validated: boolean;
  warnings: string[];
  errors: string[];
  confidence: number;
  fellback: boolean;             // true if the Director rejected the plan

  // Quality
  quality: GameDesignQualityScore | null;

  // Real outcome (filled in after the fight)
  actualResult: GameDesignActualResult;
}

/**
 * Cheap deterministic 32-bit hash for dedup.
 * Not cryptographic — only used to detect duplicate inputs.
 */
function hash32(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export class GameDesignDatasetLogger {
  private samples: GameDesignSample[] = [];
  private maxSamples: number;
  private qualityEngine = new GameDesignQualityEngine();
  private seenHashes: Set<string> = new Set();

  constructor(maxSamples = 5000) {
    this.maxSamples = maxSamples;
  }

  /**
   * Log a new sample. Returns its id.
   */
  log(params: {
    context: GameDesignContext;
    plan: GameDesignPlan;
    explanation: string;
    modelId: string;
    promptVersion: string;
    rawModelOutput: string;
    validated: boolean;
    warnings: string[];
    errors: string[];
    confidence: number;
    fellback: boolean;
  }): string {
    const id = `gd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const contextHash = hash32(this.canonicalContextString(params.context));

    const sample: GameDesignSample = {
      id,
      timestamp: Date.now(),
      context: params.context,
      contextHash,
      plan: params.plan,
      explanation: params.explanation,
      modelId: params.modelId,
      promptVersion: params.promptVersion,
      rawModelOutput: params.rawModelOutput,
      validated: params.validated,
      warnings: params.warnings,
      errors: params.errors,
      confidence: params.confidence,
      fellback: params.fellback,
      quality: null,
      actualResult: {
        playerWon: false,
        roundsToWin: 0,
        damageDealt: 0,
        damageTaken: 0,
        durationSeconds: 0,
        engaged: false,
      },
    };

    sample.quality = this.qualityEngine.score(sample);
    this.samples.push(sample);
    this.seenHashes.add(contextHash);

    if (this.samples.length > this.maxSamples) {
      const removed = this.samples.shift();
      if (removed && !this.samples.some(s => s.contextHash === removed.contextHash)) {
        this.seenHashes.delete(removed.contextHash);
      }
    }

    return id;
  }

  /**
   * Update the actual result after a fight.
   */
  updateResult(sampleId: string, result: GameDesignActualResult): void {
    const sample = this.samples.find(s => s.id === sampleId);
    if (sample) {
      sample.actualResult = result;
      sample.quality = this.qualityEngine.score(sample);
    }
  }

  /**
   * Get all samples.
   */
  getSamples(): GameDesignSample[] {
    return [...this.samples];
  }

  /**
   * Get samples with results recorded.
   */
  getSamplesWithResults(): GameDesignSample[] {
    return this.samples.filter(s => s.actualResult.engaged || s.actualResult.damageDealt > 0);
  }

  /**
   * Get a sample by id.
   */
  getById(id: string): GameDesignSample | null {
    return this.samples.find(s => s.id === id) ?? null;
  }

  /**
   * Remove duplicates by contextHash. Returns count removed.
   */
  dedup(): number {
    const seen = new Set<string>();
    const next: GameDesignSample[] = [];
    let removed = 0;
    for (const s of this.samples) {
      if (seen.has(s.contextHash)) {
        removed++;
        continue;
      }
      seen.add(s.contextHash);
      next.push(s);
    }
    this.samples = next;
    this.seenHashes = seen;
    return removed;
  }

  /**
   * Remove invalid samples (failed validation, fellback, low quality).
   */
  pruneInvalid(opts: { minQuality?: number; requireResult?: boolean } = {}): number {
    const minQuality = opts.minQuality ?? 0;
    const requireResult = opts.requireResult ?? false;
    const before = this.samples.length;
    this.samples = this.samples.filter(s => {
      if (!s.validated) return false;
      if (s.fellback) return false;
      if (s.quality && s.quality.overall < minQuality) return false;
      if (requireResult && (!s.actualResult.engaged && s.actualResult.damageDealt === 0)) return false;
      return true;
    });
    // Rebuild seen set
    this.seenHashes = new Set(this.samples.map(s => s.contextHash));
    return before - this.samples.length;
  }

  /**
   * Clear all samples.
   */
  clear(): void {
    this.samples = [];
    this.seenHashes.clear();
  }

  /**
   * Export as JSONL for fine-tuning. Each line is a (input, output) pair.
   */
  exportJSONL(): string {
    return this.samples
      .map(s => JSON.stringify(this.toTrainingPair(s)))
      .join("\n");
  }

  /**
   * Export the full sample for debugging / inspection.
   */
  exportJSON(): string {
    return JSON.stringify(this.samples, null, 2);
  }

  /**
   * Get dataset statistics.
   */
  getStats(): {
    totalSamples: number;
    validatedSamples: number;
    fellbackSamples: number;
    withResults: number;
    avgConfidence: number;
    avgQuality: number;
    byVersion: Record<string, number>;
    byModel: Record<string, number>;
    byQuality: Record<string, number>;
  } {
    const total = this.samples.length;
    const validated = this.samples.filter(s => s.validated).length;
    const fellback = this.samples.filter(s => s.fellback).length;
    const withResults = this.samples.filter(s => s.actualResult.engaged || s.actualResult.damageDealt > 0).length;
    const validScores = this.samples.filter(s => s.quality).map(s => s.quality!.overall);
    const avgQuality = validScores.length > 0 ? validScores.reduce((a, b) => a + b, 0) / validScores.length : 0;
    const avgConfidence = this.samples.length > 0
      ? this.samples.reduce((a, s) => a + s.confidence, 0) / this.samples.length
      : 0;

    const byVersion: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byQuality: Record<string, number> = { high: 0, medium: 0, low: 0 };
    for (const s of this.samples) {
      byVersion[s.promptVersion] = (byVersion[s.promptVersion] ?? 0) + 1;
      byModel[s.modelId] = (byModel[s.modelId] ?? 0) + 1;
      if (s.quality) byQuality[s.quality.quality] = (byQuality[s.quality.quality] ?? 0) + 1;
    }

    return {
      totalSamples: total,
      validatedSamples: validated,
      fellbackSamples: fellback,
      withResults,
      avgConfidence,
      avgQuality,
      byVersion,
      byModel,
      byQuality,
    };
  }

  /**
   * Convert a sample to the supervised training pair.
   * `input` is the GameDesignContext (JSON).
   * `output` is the GameDesignPlan (JSON).
   */
  toTrainingPair(sample: GameDesignSample): {
    input: string;
    output: string;
    metadata: Record<string, unknown>;
  } {
    return {
      input: JSON.stringify(sample.context),
      output: JSON.stringify(sample.plan),
      metadata: {
        id: sample.id,
        timestamp: sample.timestamp,
        modelId: sample.modelId,
        promptVersion: sample.promptVersion,
        confidence: sample.confidence,
        quality: sample.quality,
        actualResult: sample.actualResult,
        explanation: sample.explanation,
      },
    };
  }

  private canonicalContextString(ctx: GameDesignContext): string {
    // Drop noisy / time-dependent fields for the dedup hash.
    return JSON.stringify({
      topline: ctx.topline,
      emotionalCurve: ctx.emotionalCurve ? {
        currentEmotion: ctx.emotionalCurve.currentEmotion,
        currentIntensity: ctx.emotionalCurve.currentIntensity,
        trajectory: ctx.emotionalCurve.trajectory,
      } : null,
      currentChapter: ctx.currentChapter ? {
        chapterIndex: ctx.currentChapter.chapterIndex,
        emotion: ctx.currentChapter.emotion,
        bossStyle: ctx.currentChapter.bossStyle,
        difficulty: ctx.currentChapter.difficulty,
      } : null,
      worldState: {
        corruptionLevel: ctx.worldState.corruptionLevel,
        darknessLevel: ctx.worldState.darknessLevel,
        hopeLevel: ctx.worldState.hopeLevel,
        worldFear: ctx.worldState.worldFear,
        bloodMoonActive: ctx.worldState.bloodMoonActive,
      },
      playerEstimate: {
        skill: ctx.playerEstimate.skill,
        confidence: ctx.playerEstimate.confidence,
        patience: ctx.playerEstimate.patience,
      },
    });
  }
}
