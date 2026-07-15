// ============================================================================
// DATASET LOGGER
//
// Generates real training samples from every simulation for later LLM
// fine-tuning. Samples are stored as JSONL with full context, genome,
// archetype, decision policy, result, fitness, metrics, and outcome.
// ============================================================================

import type { IEvaluationResult, IDatasetSample, IGenome, IMatchMetrics } from "./types";
import { generateNarrative } from "./NarrativeTraitEngine";

export class DatasetLogger {
  private samples: IDatasetSample[] = [];
  private generation = 0;

  setGeneration(generation: number): void {
    this.generation = generation;
  }

  /** Logs one match as a training sample. */
  logMatch(
    genome: IGenome,
    archetypeId: string,
    metrics: IMatchMetrics,
    fitness: number,
    objectiveScores: Record<string, number>,
    context: { baseOpponent: string; roundsToWin: number; seed: number },
  ): void {
    const outcome: IDatasetSample["result"]["outcome"] =
      metrics.timeout ? "timeout" :
      metrics.genomeWon ? "win" :
      metrics.playerRoundsWon >= metrics.genomeRoundsWon ? "loss" :
      "draw";

    const narrative = generateNarrative(genome);
    const primaryTrait = narrative[0];

    const sample: IDatasetSample = {
      id: `sample_${Date.now().toString(36)}_${this.samples.length.toString(36)}`,
      timestamp: new Date().toISOString(),
      generation: this.generation,
      context: {
        archetypeId,
        baseOpponent: context.baseOpponent,
        roundsToWin: context.roundsToWin,
        seed: context.seed,
      },
      genome: { ...genome },
      archetype: archetypeId,
      decision: {
        style: primaryTrait?.category ?? "balanced",
        primaryStrategy: this.inferStrategy(genome),
        riskLevel: this.computeRiskLevel(genome),
      },
      result: {
        genomeWon: metrics.genomeWon,
        genomeRoundsWon: metrics.genomeRoundsWon,
        playerRoundsWon: metrics.playerRoundsWon,
        genomeHpFrac: metrics.genomeHpFrac,
        playerHpFrac: metrics.playerHpFrac,
        durationSeconds: metrics.durationSeconds,
        timeout: metrics.timeout,
      },
      fitness,
      objectiveScores: { ...objectiveScores },
      metrics: {
        genomeHits: metrics.genomeHits,
        playerHits: metrics.playerHits,
        genomeDamageDealt: metrics.genomeDamageDealt,
        playerDamageDealt: metrics.playerDamageDealt,
        genomeMaxCombo: metrics.genomeMaxCombo,
        playerMaxCombo: metrics.playerMaxCombo,
        genomeBlockTime: metrics.genomeBlockTime,
        playerBlockTime: metrics.playerBlockTime,
        distanceStdDev: metrics.distanceStdDev,
        genomeAttackKindsUsed: metrics.genomeAttackKindsUsed,
      },
      outcome,
    };

    this.samples.push(sample);
  }

  /** Logs an entire evaluation result (one genome vs all archetypes). */
  logEvaluation(evaluation: IEvaluationResult, context: { baseOpponent: string; roundsToWin: number }): void {
    for (const match of evaluation.matches) {
      this.logMatch(
        evaluation.genome,
        match.archetypeId,
        match,
        evaluation.perArchetype[match.archetypeId] ?? 0,
        evaluation.objectiveScores,
        { ...context, seed: 0 }, // seed not retained here; set to 0 as placeholder
      );
    }
  }

  /** Serializes all samples as JSONL. */
  serializeJSONL(): string {
    return this.samples.map((s) => JSON.stringify(s)).join("\n");
  }

  getSamples(): IDatasetSample[] {
    return this.samples.slice();
  }

  clear(): void {
    this.samples = [];
  }

  private inferStrategy(genome: IGenome): string {
    const scores: Record<string, number> = {
      zoner: genome.mixup + genome.pressure,
      rusher: genome.aggression + genome.pressure,
      turtle: genome.blockChance + (1 - genome.aggression),
      counter: genome.blockChance + genome.whiffPunish + genome.perfection,
      adaptive: genome.adaptive + genome.mixup,
    };
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  }

  private computeRiskLevel(genome: IGenome): number {
    return (genome.aggression + genome.pressure + genome.rage) / 3;
  }
}
