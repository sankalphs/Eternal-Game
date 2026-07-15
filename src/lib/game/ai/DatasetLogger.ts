// ============================================================================
// PHASE 9: DATASET LOGGER
//
// Automatically creates training examples from every AI interaction.
// Each sample includes: context, prompt, model output, parsed output,
// validation result, confidence, and the actual match result.
//
// This makes future fine-tuning almost automatic — export the dataset,
// fine-tune a model on it, and plug the fine-tuned model back in.
// ============================================================================

import type { AIContext, PromptSet, AIDirectorOutput, DatasetSample } from "./types";
import type { FeedbackEntry } from "./types";
import type { FeedbackCollector } from "./FeedbackCollector";

export class DatasetLogger {
  private samples: DatasetSample[] = [];
  private maxSamples = 1000;

  /**
   * Log a complete training sample from an AI interaction.
   */
  log(params: {
    context: AIContext;
    prompt: PromptSet;
    modelOutput: string;
    parsedOutput: AIDirectorOutput | null;
    validated: boolean;
    confidence: number;
    fellback: boolean;
    modelId: string;
  }): string {
    const id = `sample_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const sample: DatasetSample = {
      id,
      timestamp: Date.now(),
      context: params.context,
      prompt: params.prompt,
      modelOutput: params.modelOutput,
      parsedOutput: params.parsedOutput,
      validated: params.validated,
      confidence: params.confidence,
      fellback: params.fellback,
      actualResult: {
        playerWon: false,
        roundsToWin: 0,
        damageDealt: 0,
        damageTaken: 0,
      },
      modelId: params.modelId,
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.shift();

    return id;
  }

  /**
   * Update a sample with the actual match result (called after the fight).
   */
  updateResult(sampleId: string, result: {
    playerWon: boolean;
    roundsToWin: number;
    damageDealt: number;
    damageTaken: number;
  }): void {
    const sample = this.samples.find(s => s.id === sampleId);
    if (sample) {
      sample.actualResult = result;
    }
  }

  /**
   * Export all samples as a JSON string (for fine-tuning).
   * Format: one JSON object per line (JSONL).
   */
  exportJSONL(): string {
    return this.samples
      .filter(s => s.validated && !s.fellback) // only good samples
      .map(s => JSON.stringify({
        // Fine-tuning format: input → output
        input: JSON.stringify(s.context),
        output: JSON.stringify(s.parsedOutput),
        metadata: {
          modelId: s.modelId,
          confidence: s.confidence,
          playerWon: s.actualResult.playerWon,
          damageRatio: s.actualResult.damageDealt / Math.max(1, s.actualResult.damageDealt + s.actualResult.damageTaken),
        },
      }))
      .join("\n");
  }

  /**
   * Export as a full JSON array (for inspection / debug panel).
   */
  exportJSON(): string {
    return JSON.stringify(this.samples, null, 2);
  }

  /**
   * Get dataset statistics.
   */
  getStats(): {
    totalSamples: number;
    validSamples: number;
    fallbackSamples: number;
    avgConfidence: number;
    winRate: number;
  } {
    const valid = this.samples.filter(s => s.validated);
    const nonFallback = this.samples.filter(s => !s.fellback);
    const withResults = this.samples.filter(s => s.actualResult.playerWon !== false || s.actualResult.damageDealt > 0);

    return {
      totalSamples: this.samples.length,
      validSamples: valid.length,
      fallbackSamples: this.samples.length - nonFallback.length,
      avgConfidence: nonFallback.length > 0
        ? nonFallback.reduce((a, s) => a + s.confidence, 0) / nonFallback.length
        : 0,
      winRate: withResults.length > 0
        ? withResults.filter(s => s.actualResult.playerWon).length / withResults.length
        : 0,
    };
  }

  /**
   * Get all samples (for the debug panel).
   */
  getSamples(): DatasetSample[] {
    return [...this.samples];
  }

  /**
   * Clear all samples.
   */
  clear(): void {
    this.samples = [];
  }
}
