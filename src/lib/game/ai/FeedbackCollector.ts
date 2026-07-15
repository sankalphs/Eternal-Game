// ============================================================================
// PHASE 8: FEEDBACK COLLECTOR
//
// After every fight, compares predictions to reality. Builds evaluation
// metrics over time so we can measure if the AI is getting better.
// ============================================================================

import type { PlayerPrediction } from "../prediction/PredictionEngine";
import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { FeedbackEntry } from "./types";

export interface FeedbackMetrics {
  predictionAccuracy: number;   // avg across all predictions
  decisionAccuracy: number;     // how often the Director's plan was "correct"
  campaignAccuracy: number;     // how often the campaign's emotion hit
  narrativeAccuracy: number;    // how often the narrative resonated (win rate proxy)
  totalEvaluations: number;
  recentTrend: "improving" | "stable" | "declining";
}

export class FeedbackCollector {
  private entries: FeedbackEntry[] = [];
  private maxEntries = 100;

  /**
   * Record a feedback entry after a match.
   * Compares what was predicted vs what actually happened.
   */
  record(params: {
    requestId: string;
    prediction: PlayerPrediction;
    actualProfile: PlayerProfile;
    playerWon: boolean;
    directorPlanUsed: boolean;
    modelId: string;
    latencyMs: number;
  }): FeedbackEntry {
    const { requestId, prediction, actualProfile, playerWon, directorPlanUsed, modelId, latencyMs } = params;

    // Convert actual behaviour to the same format as predictions
    const actual: Record<string, number> = {
      kickSpam: this.actualKickSpam(actualProfile),
      earlyRush: this.actualEarlyRush(actualProfile),
      panicRoll: Math.min(1, actualProfile.rollFrequency / 10),
      superSave: actualProfile.superTiming > 0 && actualProfile.superTiming < 0.4 ? 0.9 : 0.1,
      blockTurtle: actualProfile.defense,
      whiffPunish: Math.min(1, actualProfile.averageComboLength / 3),
      hazardAvoid: 0.5, // can't directly measure, use neutral
      adaptationRate: Math.min(1, Object.keys(actualProfile.favouriteAttacks).length / 4),
    };

    // Calculate prediction accuracy (1 - average absolute error)
    const predictionKeys = Object.keys(prediction).filter(k => typeof prediction[k as keyof PlayerPrediction] === "number" && k in actual);
    let totalError = 0;
    let count = 0;
    for (const key of predictionKeys) {
      const predicted = prediction[key as keyof PlayerPrediction] as number;
      const actualVal = actual[key] ?? 0.5;
      totalError += Math.abs(predicted - actualVal);
      count++;
    }
    const accuracy = count > 0 ? Math.max(0, 1 - totalError / count) : 0.5;

    const entry: FeedbackEntry = {
      requestId,
      timestamp: Date.now(),
      prediction: this.extractPredictionMap(prediction),
      actualBehaviour: actual,
      predictionAccuracy: accuracy,
      directorPlanUsed,
      playerWon,
      modelId,
      latencyMs,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();

    return entry;
  }

  /**
   * Get aggregated metrics.
   */
  getMetrics(): FeedbackMetrics {
    if (this.entries.length === 0) {
      return {
        predictionAccuracy: 0.5,
        decisionAccuracy: 0.5,
        campaignAccuracy: 0.5,
        narrativeAccuracy: 0.5,
        totalEvaluations: 0,
        recentTrend: "stable",
      };
    }

    const recent = this.entries.slice(-20);
    const older = this.entries.slice(0, Math.max(0, this.entries.length - 20));

    const avgPrediction = avg(recent.map(e => e.predictionAccuracy));
    const avgDecision = avg(recent.map(e => e.directorPlanUsed ? 1 : 0));
    const avgCampaign = avg(recent.map(e => e.playerWon ? 1 : 0.3)); // win=good campaign pacing

    // Trend: compare recent vs older
    const olderAvg = older.length > 0 ? avg(older.map(e => e.predictionAccuracy)) : avgPrediction;
    let trend: "improving" | "stable" | "declining" = "stable";
    if (avgPrediction > olderAvg + 0.05) trend = "improving";
    else if (avgPrediction < olderAvg - 0.05) trend = "declining";

    return {
      predictionAccuracy: avgPrediction,
      decisionAccuracy: avgDecision,
      campaignAccuracy: avgCampaign,
      narrativeAccuracy: avgCampaign, // proxy: win rate
      totalEvaluations: this.entries.length,
      recentTrend: trend,
    };
  }

  /** Get all entries (for the dataset logger). */
  getEntries(): FeedbackEntry[] {
    return [...this.entries];
  }

  private actualKickSpam(p: PlayerProfile): number {
    const kick = p.favouriteAttacks["kick"] ?? 0;
    const total = Object.values(p.favouriteAttacks).reduce((a, b) => a + b, 0);
    return total > 0 ? kick / total : 0.3;
  }

  private actualEarlyRush(p: PlayerProfile): number {
    return Math.min(1, p.aggression * 0.8 + (p.preferredSpacing === "close" ? 0.2 : 0));
  }

  private extractPredictionMap(pred: PlayerPrediction): Record<string, number> {
    return {
      kickSpam: pred.kickSpam,
      earlyRush: pred.earlyRush,
      panicRoll: pred.panicRoll,
      superSave: pred.superSave,
      blockTurtle: pred.blockTurtle,
      whiffPunish: pred.whiffPunish,
      hazardAvoid: pred.hazardAvoid,
      adaptationRate: pred.adaptationRate,
    };
  }
}

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
