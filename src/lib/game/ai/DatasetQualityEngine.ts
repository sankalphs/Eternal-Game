// ============================================================================
// PHASE 5: DATASET QUALITY ENGINE
//
// Scores every training sample. Only high-quality samples are exported
// for fine-tuning. Metrics: prediction correctness, novelty, behaviour
// diversity, narrative uniqueness, campaign impact, confidence.
// ============================================================================

import type { DatasetSample, DatasetQualityScore, DatasetQuality } from "./research-types";

export class DatasetQualityEngine {
  private scoredSamples: { sample: DatasetSample; score: DatasetQualityScore }[] = [];

  /**
   * Score a dataset sample using all quality dimensions.
   */
  score(sample: DatasetSample, allSamples: DatasetSample[]): DatasetQualityScore {
    const predictionCorrectness = this.scorePredictionCorrectness(sample);
    const novelty = this.scoreNovelty(sample, allSamples);
    const behaviourDiversity = this.scoreBehaviourDiversity(sample);
    const narrativeUniqueness = this.scoreNarrativeUniqueness(sample, allSamples);
    const campaignImpact = this.scoreCampaignImpact(sample);
    const confidence = sample.confidence;

    // Weighted average
    const overall =
      predictionCorrectness * 0.25 +
      novelty * 0.15 +
      behaviourDiversity * 0.15 +
      narrativeUniqueness * 0.10 +
      campaignImpact * 0.20 +
      confidence * 0.15;

    const quality: DatasetQuality = overall >= 0.65 ? "high" : overall >= 0.4 ? "medium" : "discard";

    const score: DatasetQualityScore = {
      predictionCorrectness, novelty, behaviourDiversity,
      narrativeUniqueness, campaignImpact, confidence,
      overall, quality,
    };

    this.scoredSamples.push({ sample, score });
    return score;
  }

  /**
   * Filter samples — only return high-quality ones for fine-tuning.
   */
  filterHighQuality(): { sample: DatasetSample; score: DatasetQualityScore }[] {
    return this.scoredSamples.filter(s => s.score.quality === "high");
  }

  /**
   * Get all scored samples (for the research dashboard).
   */
  getAll(): { sample: DatasetSample; score: DatasetQualityScore }[] {
    return [...this.scoredSamples];
  }

  /**
   * Get quality distribution stats.
   */
  getStats(): { high: number; medium: number; discard: number; avgScore: number } {
    const high = this.scoredSamples.filter(s => s.score.quality === "high").length;
    const medium = this.scoredSamples.filter(s => s.score.quality === "medium").length;
    const discard = this.scoredSamples.filter(s => s.score.quality === "discard").length;
    const avgScore = this.scoredSamples.length > 0
      ? this.scoredSamples.reduce((a, s) => a + s.score.overall, 0) / this.scoredSamples.length
      : 0;
    return { high, medium, discard, avgScore };
  }

  // ---- Individual scoring functions ----

  private scorePredictionCorrectness(sample: DatasetSample): number {
    // If the player won, the prediction was "correct" (the Director planned well)
    // If the player lost, check if the prediction captured the player's weakness
    if (sample.actualResult.playerWon) {
      // Win = the Director's plan led to a good fight (player could win)
      return 0.7 + sample.confidence * 0.3;
    } else {
      // Loss = check if the prediction identified the right weakness
      // If the model had low confidence on a loss, it correctly identified uncertainty
      return 0.4 + (1 - sample.confidence) * 0.3;
    }
  }

  private scoreNovelty(sample: DatasetSample, all: DatasetSample[]): number {
    // How different is this sample's context from all others?
    // Compare feature vectors (simple L1 distance)
    const features = sample.context.features;
    let minDistance = Infinity;
    for (const other of all) {
      if (other.id === sample.id) continue;
      const otherFeatures = other.context.features;
      let dist = 0;
      for (const key of Object.keys(features)) {
        const a = (features as any)[key] ?? 0;
        const b = (otherFeatures as any)[key] ?? 0;
        dist += Math.abs(a - b);
      }
      minDistance = Math.min(minDistance, dist);
    }
    // Higher distance = more novel. Normalize: distance of 2+ = novelty 1
    return Math.min(1, minDistance / 2);
  }

  private scoreBehaviourDiversity(sample: DatasetSample): number {
    // How many different attack types did the player use?
    // This is a proxy — we check if the context shows varied predictions
    const pred = sample.context.prediction;
    const values = Object.values(pred);
    const variance = values.length > 0
      ? values.reduce((a, b) => a + Math.abs(b - 0.5), 0) / values.length
      : 0;
    // High variance from 0.5 = diverse predictions = diverse behaviour
    return Math.min(1, variance * 2);
  }

  private scoreNarrativeUniqueness(sample: DatasetSample, all: DatasetSample[]): number {
    // Is the narrative/intent unique?
    const intent = sample.parsedOutput?.intent ?? "";
    const similarIntents = all.filter(s =>
      s.id !== sample.id &&
      s.parsedOutput?.intent === intent
    ).length;
    // Fewer similar intents = more unique
    return Math.max(0, 1 - similarIntents / 10);
  }

  private scoreCampaignImpact(sample: DatasetSample): number {
    // Did this fight matter? (high damage both ways = impactful)
    const dmg = sample.actualResult.damageDealt + sample.actualResult.damageTaken;
    return Math.min(1, dmg / 300);
  }
}
