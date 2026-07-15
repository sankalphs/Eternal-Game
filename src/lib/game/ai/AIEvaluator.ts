// ============================================================================
// PHASE 6: AI EVALUATION FRAMEWORK
//
// Evaluates every completed campaign across 10 metrics. Generates reports
// for benchmarking and model comparison.
// ============================================================================

import type { CampaignEvaluation } from "./research-types";
import type { FeedbackEntry } from "./types";

export interface EvaluationInput {
  campaignId: string;
  feedbackEntries: FeedbackEntry[];
  chaptersPlayed: number;
  chaptersWon: number;
  totalDuration: number;
  bossAdaptationCount: number;     // how many bosses adapted to player
  emotionCurveTarget: string[];    // the planned emotions
  emotionCurveActual: string[];    // what emotions actually occurred (from player wins/losses)
  directorPlanDiversity: number;   // how many unique boss styles were used
}

export class AIEvaluator {
  private evaluations: CampaignEvaluation[] = [];

  /**
   * Evaluate a completed campaign across all 10 metrics.
   */
  evaluate(input: EvaluationInput): CampaignEvaluation {
    const { campaignId, feedbackEntries, chaptersPlayed, chaptersWon, totalDuration, bossAdaptationCount, emotionCurveTarget, emotionCurveActual, directorPlanDiversity } = input;

    // 1. Prediction accuracy: average across all feedback entries
    const predictionAccuracy = feedbackEntries.length > 0
      ? feedbackEntries.reduce((a, e) => a + e.predictionAccuracy, 0) / feedbackEntries.length
      : 0.5;

    // 2. Campaign coherence: did the player complete most chapters?
    const campaignCoherence = chaptersPlayed > 0 ? chaptersPlayed / 8 : 0;

    // 3. Narrative consistency: how well did the emotion curve match reality?
    const narrativeConsistency = this.scoreEmotionMatch(emotionCurveTarget, emotionCurveActual, chaptersWon);

    // 4. Difficulty balance: win rate should be ~50-70% for good pacing
    const winRate = chaptersPlayed > 0 ? chaptersWon / chaptersPlayed : 0;
    const difficultyBalance = winRate >= 0.5 && winRate <= 0.75 ? 1.0 : Math.max(0, 1 - Math.abs(winRate - 0.625) * 2);

    // 5. Player behaviour prediction: same as predictionAccuracy but weighted toward recent
    const recent = feedbackEntries.slice(-5);
    const playerBehaviourPrediction = recent.length > 0
      ? recent.reduce((a, e) => a + e.predictionAccuracy, 0) / recent.length
      : predictionAccuracy;

    // 6. Boss adaptation: did bosses actually adapt to the player?
    const bossAdaptation = Math.min(1, bossAdaptationCount / Math.max(1, chaptersPlayed * 0.5));

    // 7. Emotion curve accuracy: how many target emotions were "hit"?
    const emotionCurveAccuracy = this.scoreEmotionMatch(emotionCurveTarget, emotionCurveActual, chaptersWon);

    // 8. Director diversity: how many unique configurations were used?
    const directorDiversity = Math.min(1, directorPlanDiversity / 5);

    // 9. Average confidence
    const avgConfidence = feedbackEntries.length > 0
      ? feedbackEntries.reduce((a, e) => a + (e.directorPlanUsed ? 0.8 : 0.4), 0) / feedbackEntries.length
      : 0.5;

    // 10. Long-term adaptation: compare first-half vs second-half prediction accuracy
    const half = Math.floor(feedbackEntries.length / 2);
    const firstHalf = feedbackEntries.slice(0, half);
    const secondHalf = feedbackEntries.slice(half);
    const firstAcc = firstHalf.length > 0 ? firstHalf.reduce((a, e) => a + e.predictionAccuracy, 0) / firstHalf.length : 0.5;
    const secondAcc = secondHalf.length > 0 ? secondHalf.reduce((a, e) => a + e.predictionAccuracy, 0) / secondHalf.length : 0.5;
    const longTermAdaptation = Math.max(0, Math.min(1, secondAcc - firstAcc + 0.5)); // improvement = higher score

    const metrics: CampaignEvaluation["metrics"] = {
      predictionAccuracy: round(predictionAccuracy),
      campaignCoherence: round(campaignCoherence),
      narrativeConsistency: round(narrativeConsistency),
      difficultyBalance: round(difficultyBalance),
      playerBehaviourPrediction: round(playerBehaviourPrediction),
      bossAdaptation: round(bossAdaptation),
      emotionCurveAccuracy: round(emotionCurveAccuracy),
      directorDiversity: round(directorDiversity),
      avgConfidence: round(avgConfidence),
      longTermAdaptation: round(longTermAdaptation),
    };

    const reportText = this.generateReport(campaignId, metrics, input);

    const evaluation: CampaignEvaluation = {
      campaignId,
      timestamp: Date.now(),
      metrics,
      chaptersPlayed,
      chaptersWon,
      totalDuration,
      reportText,
    };

    this.evaluations.push(evaluation);
    return evaluation;
  }

  /**
   * Generate a human-readable report.
   */
  private generateReport(id: string, m: CampaignEvaluation["metrics"], input: EvaluationInput): string {
    const lines: string[] = [];
    lines.push(`=== Campaign Evaluation: ${id} ===`);
    lines.push(`Chapters: ${input.chaptersPlayed}/8 played, ${input.chaptersWon} won`);
    lines.push(`Duration: ${input.totalDuration}s`);
    lines.push("");
    lines.push("Metrics (0..1, higher is better):");
    lines.push(`  Prediction Accuracy:      ${m.predictionAccuracy.toFixed(3)} ${this.bar(m.predictionAccuracy)}`);
    lines.push(`  Campaign Coherence:       ${m.campaignCoherence.toFixed(3)} ${this.bar(m.campaignCoherence)}`);
    lines.push(`  Narrative Consistency:    ${m.narrativeConsistency.toFixed(3)} ${this.bar(m.narrativeConsistency)}`);
    lines.push(`  Difficulty Balance:       ${m.difficultyBalance.toFixed(3)} ${this.bar(m.difficultyBalance)}`);
    lines.push(`  Player Behaviour Predict:  ${m.playerBehaviourPrediction.toFixed(3)} ${this.bar(m.playerBehaviourPrediction)}`);
    lines.push(`  Boss Adaptation:          ${m.bossAdaptation.toFixed(3)} ${this.bar(m.bossAdaptation)}`);
    lines.push(`  Emotion Curve Accuracy:    ${m.emotionCurveAccuracy.toFixed(3)} ${this.bar(m.emotionCurveAccuracy)}`);
    lines.push(`  Director Diversity:       ${m.directorDiversity.toFixed(3)} ${this.bar(m.directorDiversity)}`);
    lines.push(`  Average Confidence:       ${m.avgConfidence.toFixed(3)} ${this.bar(m.avgConfidence)}`);
    lines.push(`  Long-term Adaptation:     ${m.longTermAdaptation.toFixed(3)} ${this.bar(m.longTermAdaptation)}`);
    lines.push("");
    const avg = Object.values(m).reduce((a, b) => a + b, 0) / 10;
    lines.push(`  OVERALL: ${avg.toFixed(3)} ${this.bar(avg)}`);
    return lines.join("\n");
  }

  private bar(v: number): string {
    const filled = Math.round(v * 20);
    return `[${"█".repeat(filled)}${"░".repeat(20 - filled)}]`;
  }

  private scoreEmotionMatch(target: string[], actual: string[], won: number): number {
    if (target.length === 0) return 0.5;
    // Simplified: if the player won, the emotion "landed"
    // (they felt what we wanted them to feel enough to keep playing)
    return Math.min(1, won / Math.max(1, target.length));
  }

  getEvaluations(): CampaignEvaluation[] {
    return [...this.evaluations];
  }

  getLatest(): CampaignEvaluation | null {
    return this.evaluations[this.evaluations.length - 1] ?? null;
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
