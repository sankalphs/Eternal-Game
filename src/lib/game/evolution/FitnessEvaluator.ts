// ============================================================================
// FITNESS EVALUATOR — Multi-objective player-experience fitness
//
// Winning alone is NOT fitness. Produces a weighted, configurable score from
// challenge, forced adaptation, combat variety, fight duration, behaviour
// diversity, combo/spacing diversity, unpredictability, close-finish bonus,
// and anti-degeneracy penalties. Every component is exposed as a weight so an
// LLM can tune it through a single configuration object.
// ============================================================================

import type { IEvaluationResult, IFitnessWeights, IMatchMetrics } from "./types";

export class FitnessEvaluator {
  constructor(private weights: IFitnessWeights) {}

  /**
   * Evaluates a genome across all archetype matches and returns the averaged
   * fitness plus per-archetype and per-objective breakdown.
   */
  evaluate(genomeFitness: Omit<IEvaluationResult, "averageFitness" | "rawFitness" | "objectiveScores">): IEvaluationResult {
    const matches = genomeFitness.matches;
    if (matches.length === 0) {
      return {
        ...genomeFitness,
        averageFitness: 0,
        rawFitness: 0,
        perArchetype: {},
        objectiveScores: {},
      };
    }

    const perArchetype: Record<string, number> = {};
    const objectiveAccumulator: Record<string, number> = {};
    let total = 0;

    for (const m of matches) {
      const { score, objectives } = this.scoreMatch(m);
      perArchetype[m.archetypeId] = score;
      total += score;
      for (const [key, value] of Object.entries(objectives)) {
        objectiveAccumulator[key] = (objectiveAccumulator[key] ?? 0) + value;
      }
    }

    const objectiveScores: Record<string, number> = {};
    for (const key of Object.keys(objectiveAccumulator)) {
      objectiveScores[key] = objectiveAccumulator[key] / matches.length;
    }

    const rawFitness = total / matches.length;

    return {
      ...genomeFitness,
      averageFitness: rawFitness,
      rawFitness,
      perArchetype,
      objectiveScores,
    };
  }

  /** Scores a single match and returns the weighted score plus raw objectives. */
  scoreMatch(m: IMatchMetrics): { score: number; objectives: Record<string, number> } {
    const w = this.weights;

    // ---- primary objectives ----
    const winScore = m.genomeWon ? 1 : 0;
    const survivalScore = m.genomeHpFrac;
    const damageScore = Math.min(1, m.genomeDamageDealt / Math.max(m.playerMaxHp, 1));

    // ---- forced adaptation ----
    // Reward genomes that perform well across different archetypes indirectly:
    // here we reward matches where the AI had to block, dodge, and respond.
    const blockRatio = m.genomeBlockTime / Math.max(m.durationSeconds, 1);
    const forcedAdaptationScore = Math.min(1, blockRatio * 1.5 + (m.genomeHits > 0 ? 0.2 : 0));

    // ---- combat variety ----
    const attackVariety = Math.min(1, m.genomeAttackKindsUsed / 3);
    const spacingVariety = Math.min(1, m.distanceStdDev / 80);
    const combatVarietyScore = (attackVariety + spacingVariety) / 2;

    // ---- fight duration ----
    // Ideal match length: 15-30 seconds. Too fast = degenerate; too slow = boring/timeout.
    const idealMin = 12;
    const idealMax = 35;
    let fightDurationScore = 0;
    if (m.durationSeconds >= idealMin && m.durationSeconds <= idealMax) {
      fightDurationScore = 1;
    } else if (m.durationSeconds < idealMin) {
      fightDurationScore = Math.max(0, 1 - (idealMin - m.durationSeconds) / idealMin);
    } else {
      fightDurationScore = Math.max(0, 1 - (m.durationSeconds - idealMax) / 30);
    }

    // ---- behaviour diversity ----
    // Use the entropy of attack-kind distribution.
    const totalAttackTime = Object.values(m.genomeAttackKindCounts).reduce((a, b) => a + b, 0);
    const behaviourDiversityScore = totalAttackTime > 0
      ? entropy(Object.values(m.genomeAttackKindCounts).map((v) => v / totalAttackTime))
      : 0;

    // ---- combo diversity ----
    const comboEntries = Object.entries(m.genomeComboCounts);
    const comboDiversityScore = comboEntries.length > 1
      ? entropy(comboEntries.map(([, v]) => v / Math.max(...comboEntries.map(([, c]) => c))))
      : 0.3;

    // ---- spacing diversity ----
    const spacingDiversityScore = spacingVariety;

    // ---- unpredictability ----
    // Penalize repeating the same attack back-to-back.
    const repeatedRatio = this.computeRepeatedMoveRatio(m.genomeAttackSequence);
    const unpredictabilityScore = Math.max(0, 1 - repeatedRatio);

    // ---- close finish bonus ----
    const hpDiff = Math.abs(m.genomeHpFrac - m.playerHpFrac);
    const closeFinishScore = 1 - hpDiff;

    // ---- anti-degeneracy penalties ----
    const attackRatio = m.genomeAttackTime / Math.max(m.durationSeconds, 1);
    const campingPenalty = Math.max(0, m.durationSeconds > 50 && m.genomeAttackTime < 3 ? 0.4 : 0);
    const infiniteBlockPenalty = blockRatio > 0.5 ? (blockRatio - 0.5) * 2.5 : 0;
    const infiniteAggressionPenalty = attackRatio > 0.7 && m.genomeHits < 4 ? 0.35 : 0;
    const repeatedMovePenalty = repeatedRatio;
    const timeoutPenalty = m.timeout ? 0.5 : 0;

    const score =
      w.winRate * winScore +
      w.survival * survivalScore +
      w.damage * damageScore +
      w.forcedAdaptation * forcedAdaptationScore +
      w.combatVariety * combatVarietyScore +
      w.fightDuration * fightDurationScore +
      w.behaviourDiversity * behaviourDiversityScore +
      w.comboDiversity * comboDiversityScore +
      w.spacingDiversity * spacingDiversityScore +
      w.unpredictability * unpredictabilityScore +
      w.closeFinishBonus * closeFinishScore -
      w.campingPenalty * campingPenalty -
      w.infiniteBlockPenalty * infiniteBlockPenalty -
      w.infiniteAggressionPenalty * infiniteAggressionPenalty -
      w.repeatedMovePenalty * repeatedMovePenalty -
      w.timeoutPenalty * timeoutPenalty;

    const objectives: Record<string, number> = {
      win: winScore,
      survival: survivalScore,
      damage: damageScore,
      forcedAdaptation: forcedAdaptationScore,
      combatVariety: combatVarietyScore,
      fightDuration: fightDurationScore,
      behaviourDiversity: behaviourDiversityScore,
      comboDiversity: comboDiversityScore,
      spacingDiversity: spacingDiversityScore,
      unpredictability: unpredictabilityScore,
      closeFinish: closeFinishScore,
      campingPenalty,
      infiniteBlockPenalty,
      infiniteAggressionPenalty,
      repeatedMovePenalty,
      timeoutPenalty: m.timeout ? 1 : 0,
    };

    return { score: Math.max(0, score), objectives };
  }

  private computeRepeatedMoveRatio(sequence: string[]): number {
    if (sequence.length < 2) return 0;
    let repeats = 0;
    for (let i = 1; i < sequence.length; i++) {
      if (sequence[i] === sequence[i - 1]) repeats++;
    }
    return repeats / (sequence.length - 1);
  }

  setWeights(weights: IFitnessWeights): void {
    this.weights = weights;
  }

  getWeights(): IFitnessWeights {
    return { ...this.weights };
  }

  static defaultWeights(): IFitnessWeights {
    return {
      winRate: 0.18,
      survival: 0.1,
      damage: 0.1,
      forcedAdaptation: 0.08,
      combatVariety: 0.08,
      fightDuration: 0.08,
      behaviourDiversity: 0.07,
      comboDiversity: 0.05,
      spacingDiversity: 0.05,
      unpredictability: 0.06,
      closeFinishBonus: 0.05,
      campingPenalty: 0.04,
      infiniteBlockPenalty: 0.04,
      infiniteAggressionPenalty: 0.03,
      repeatedMovePenalty: 0.03,
      timeoutPenalty: 0.02,
    };
  }
}

/** Shannon entropy of a probability distribution (normalized to [0,1]). */
function entropy(probs: number[]): number {
  const safe = probs.filter((p) => p > 0);
  if (safe.length <= 1) return 0;
  const h = -safe.reduce((sum, p) => sum + p * Math.log2(p), 0);
  const max = Math.log2(safe.length);
  return max === 0 ? 0 : h / max;
}
