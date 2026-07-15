// ============================================================================
// PHASE 7: EXPERIMENT FRAMEWORK
//
// Supports A/B testing of AI configurations. Each experiment has variants
// (different models, prompt strategies, retrievers) and tracks results.
// ============================================================================

import type { Experiment, ExperimentVariant, ExperimentResult, CampaignEvaluation } from "./research-types";

export class ExperimentManager {
  private experiments: Map<string, Experiment> = new Map();
  private activeExperimentId: string | null = null;
  private assignmentCounter = 0;

  /**
   * Create a new experiment with two or more variants.
   */
  createExperiment(label: string, variants: ExperimentVariant[]): string {
    const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const experiment: Experiment = {
      id,
      label,
      variants,
      results: [],
      active: true,
    };
    this.experiments.set(id, experiment);
    this.activeExperimentId = id;
    return id;
  }

  /**
   * Assign a variant to the next campaign (round-robin for equal split).
   * In a real system, this would use hashing or multi-armed bandit.
   */
  assignVariant(): ExperimentVariant | null {
    const exp = this.getActiveExperiment();
    if (!exp || exp.variants.length === 0) return null;
    const variant = exp.variants[this.assignmentCounter % exp.variants.length];
    this.assignmentCounter++;
    return variant;
  }

  /**
   * Record a result for a variant.
   */
  recordResult(experimentId: string, variantId: string, campaignId: string, metrics: CampaignEvaluation["metrics"]): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) return;
    const result: ExperimentResult = {
      experimentId,
      variantId,
      campaignId,
      metrics,
      timestamp: Date.now(),
    };
    exp.results.push(result);
  }

  /**
   * Get results for a specific experiment, grouped by variant.
   */
  getResults(experimentId: string): Record<string, { count: number; avgMetrics: CampaignEvaluation["metrics"] }> {
    const exp = this.experiments.get(experimentId);
    if (!exp) return {};
    const grouped: Record<string, CampaignEvaluation["metrics"][]> = {};
    for (const r of exp.results) {
      if (!grouped[r.variantId]) grouped[r.variantId] = [];
      grouped[r.variantId].push(r.metrics);
    }
    const result: Record<string, { count: number; avgMetrics: CampaignEvaluation["metrics"] }> = {};
    for (const [variantId, metrics] of Object.entries(grouped)) {
      const avg = this.avgMetrics(metrics);
      result[variantId] = { count: metrics.length, avgMetrics: avg };
    }
    return result;
  }

  /**
   * Stop an experiment.
   */
  stop(experimentId: string): void {
    const exp = this.experiments.get(experimentId);
    if (exp) {
      exp.active = false;
      if (this.activeExperimentId === experimentId) this.activeExperimentId = null;
    }
  }

  getActiveExperiment(): Experiment | null {
    if (!this.activeExperimentId) return null;
    return this.experiments.get(this.activeExperimentId) ?? null;
  }

  getAllExperiments(): Experiment[] {
    return [...this.experiments.values()];
  }

  private avgMetrics(metrics: CampaignEvaluation["metrics"][]): CampaignEvaluation["metrics"] {
    if (metrics.length === 0) return {
      predictionAccuracy: 0, campaignCoherence: 0, narrativeConsistency: 0,
      difficultyBalance: 0, playerBehaviourPrediction: 0, bossAdaptation: 0,
      emotionCurveAccuracy: 0, directorDiversity: 0, avgConfidence: 0, longTermAdaptation: 0,
    };
    const keys = Object.keys(metrics[0]) as (keyof CampaignEvaluation["metrics"])[];
    const result = {} as CampaignEvaluation["metrics"];
    for (const key of keys) {
      result[key] = metrics.reduce((a, m) => a + m[key], 0) / metrics.length;
    }
    return result;
  }
}
