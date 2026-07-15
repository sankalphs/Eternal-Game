// ============================================================================
// NARRATIVE TRAIT ENGINE
//
// Translates genome behaviour statistics into narrative traits that the
// Director can consume to describe an opponent's personality.
// ============================================================================

import type { IGenome, INarrativeTrait } from "./types";

function patienceScore(g: IGenome): number {
  return (g.reaction + g.blockChance + (1 - g.aggression)) / 3;
}

function counterScore(g: IGenome): number {
  return (g.blockChance + g.whiffPunish + g.perfection) / 3;
}

export function generateNarrative(genome: IGenome): INarrativeTrait[] {
  const traits: INarrativeTrait[] = [];

  if (patienceScore(genome) > 0.6) {
    traits.push({
      category: "patience",
      description: "The warrior waits.",
      strength: patienceScore(genome),
      sourceGene: "reaction",
    });
  }

  if (counterScore(genome) > 0.6) {
    traits.push({
      category: "counter",
      description: "The warrior studies every mistake.",
      strength: counterScore(genome),
      sourceGene: "blockChance",
    });
  }

  if (genome.aggression > 0.7) {
    traits.push({
      category: "aggression",
      description: "The warrior never retreats.",
      strength: genome.aggression,
      sourceGene: "aggression",
    });
  }

  if (genome.adaptive > 0.6) {
    traits.push({
      category: "adaptation",
      description: "The warrior learns.",
      strength: genome.adaptive,
      sourceGene: "adaptive",
    });
  }

  if (genome.pressure > 0.7) {
    traits.push({
      category: "pressure",
      description: "The warrior gives no ground.",
      strength: genome.pressure,
      sourceGene: "pressure",
    });
  }

  if (genome.mixup > 0.7) {
    traits.push({
      category: "mindGames",
      description: "The warrior strikes from every angle.",
      strength: genome.mixup,
      sourceGene: "mixup",
    });
  }

  if (genome.perfection > 0.6) {
    traits.push({
      category: "perfection",
      description: "The warrior sees the opening before it forms.",
      strength: genome.perfection,
      sourceGene: "perfection",
    });
  }

  if (genome.whiffPunish > 0.6) {
    traits.push({
      category: "punishment",
      description: "The warrior punishes hesitation.",
      strength: genome.whiffPunish,
      sourceGene: "whiffPunish",
    });
  }

  if (genome.antiAir > 0.6) {
    traits.push({
      category: "antiAir",
      description: "The warrior owns the sky.",
      strength: genome.antiAir,
      sourceGene: "antiAir",
    });
  }

  if (traits.length === 0) {
    traits.push({
      category: "balanced",
      description: "The warrior is measured and unpredictable.",
      strength: 0.5,
    });
  }

  return traits.sort((a, b) => b.strength - a.strength);
}
