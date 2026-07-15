import type { FightResult } from "../simulator/MatchResult";
import type { EvaluatedGenome, FitnessWeights, MatchFitnessBreakdown, OfflineGenome } from "./types";

export function defaultFitnessWeights(): FitnessWeights {
  return {
    winRate: 0.35,
    remainingHp: 0.18,
    damageDealt: 0.18,
    damageAvoided: 0.14,
    comboEfficiency: 0.08,
    survivalTime: 0.07,
  };
}

export class OfflineFitnessEvaluator {
  constructor(private weights: FitnessWeights) {}

  evaluate(genome: OfflineGenome, fights: FightResult[], side: 0 | 1): EvaluatedGenome {
    if (fights.length === 0) {
      return {
        genome,
        fitness: 0,
        rawFitness: 0,
        matches: 0,
        wins: 0,
        breakdown: emptyBreakdown(),
      };
    }

    const totals = emptyBreakdown();
    let wins = 0;
    for (const fight of fights) {
      if (fight.winnerSide === side) wins++;
      const own = side === 0 ? fight.sideA : fight.sideB;
      const enemy = side === 0 ? fight.sideB : fight.sideA;

      totals.winRate += fight.winnerSide === side ? 1 : 0;
      totals.remainingHp += own.hpFrac;
      totals.damageDealt += normalizeDamage(own.damageDealt, enemy.maxHp);
      totals.damageAvoided += 1 - normalizeDamage(enemy.damageDealt, own.maxHp);
      totals.comboEfficiency += comboEfficiency(own.maxCombo, own.totalCombos, own.hits);
      totals.survivalTime += survivalTimeScore(fight.durationSeconds, fight.timedOut);
    }

    const breakdown = divideBreakdown(totals, fights.length);
    const rawFitness = weightedScore(breakdown, this.weights);
    return {
      genome,
      fitness: rawFitness,
      rawFitness,
      matches: fights.length,
      wins,
      breakdown,
    };
  }

  scoreFight(fight: FightResult, side: 0 | 1): number {
    return this.evaluate({} as OfflineGenome, [fight], side).fitness;
  }

  setWeights(weights: FitnessWeights): void {
    this.weights = weights;
  }

  getWeights(): FitnessWeights {
    return { ...this.weights };
  }
}

function weightedScore(scores: MatchFitnessBreakdown, weights: FitnessWeights): number {
  return (
    weights.winRate * scores.winRate +
    weights.remainingHp * scores.remainingHp +
    weights.damageDealt * scores.damageDealt +
    weights.damageAvoided * scores.damageAvoided +
    weights.comboEfficiency * scores.comboEfficiency +
    weights.survivalTime * scores.survivalTime
  );
}

function comboEfficiency(maxCombo: number, totalCombos: number, hits: number): number {
  const comboDepth = Math.min(1, maxCombo / 8);
  const conversion = hits <= 0 ? 0 : Math.min(1, totalCombos / hits);
  return comboDepth * 0.7 + conversion * 0.3;
}

function survivalTimeScore(durationSeconds: number, timedOut: boolean): number {
  const target = 45;
  const score = Math.min(1, durationSeconds / target);
  return timedOut ? score * 0.75 : score;
}

function normalizeDamage(damage: number, maxHp: number): number {
  return Math.max(0, Math.min(1, damage / Math.max(1, maxHp)));
}

function emptyBreakdown(): MatchFitnessBreakdown {
  return {
    winRate: 0,
    remainingHp: 0,
    damageDealt: 0,
    damageAvoided: 0,
    comboEfficiency: 0,
    survivalTime: 0,
  };
}

function divideBreakdown(scores: MatchFitnessBreakdown, divisor: number): MatchFitnessBreakdown {
  return {
    winRate: scores.winRate / divisor,
    remainingHp: scores.remainingHp / divisor,
    damageDealt: scores.damageDealt / divisor,
    damageAvoided: scores.damageAvoided / divisor,
    comboEfficiency: scores.comboEfficiency / divisor,
    survivalTime: scores.survivalTime / divisor,
  };
}
