// ============================================================================
// RESEARCH REPORT ENGINE
//
// Produces evaluation reports for research analysis: diversity, entropy,
// convergence, Pareto front, fitness distribution, and champion comparison.
// ============================================================================

import type { IGenome, IResearchReport, IScoredGenome, IEvaluationResult } from "./types";
import { genomeDistance } from "./Genome";

export class ResearchReportEngine {
  /** Generates a research report from a scored population and evaluation results. */
  generate(
    population: IScoredGenome[],
    evaluations: IEvaluationResult[],
    snapshots: { generation: number; bestFitness: number; averageFitness: number; diversity: number }[],
    diversityThreshold = 0.05,
  ): IResearchReport {
    const genomeDiversity = this.averagePairwiseDistance(population.map((p) => p.genome));
    const behaviourDiversity = this.averageBehaviourDiversity(evaluations);
    const populationEntropy = this.populationEntropy(population);
    const fitnessDistribution = this.fitnessDistribution(population);
    const paretoFront = this.computeParetoFront(evaluations);
    const championComparison = this.championComparison(evaluations);

    return {
      genomeDiversity,
      behaviourDiversity,
      evolutionSpeed: this.evolutionSpeed(snapshots),
      converged: genomeDiversity < diversityThreshold,
      populationEntropy,
      fitnessDistribution,
      paretoFront,
      championComparison,
      generatedAt: new Date().toISOString(),
    };
  }

  private averagePairwiseDistance(genomes: IGenome[]): number {
    if (genomes.length < 2) return 0;
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < genomes.length; i++) {
      for (let j = i + 1; j < genomes.length; j++) {
        total += genomeDistance(genomes[i], genomes[j]);
        pairs++;
      }
    }
    return pairs === 0 ? 0 : total / pairs;
  }

  private averageBehaviourDiversity(evaluations: IEvaluationResult[]): number {
    if (evaluations.length === 0) return 0;
    const values = evaluations.map((e) => e.objectiveScores["behaviourDiversity"] ?? 0);
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private evolutionSpeed(snapshots: { generation: number; bestFitness: number; averageFitness: number }[]): number {
    if (snapshots.length < 2) return 0;
    const first = snapshots[0].bestFitness;
    const last = snapshots[snapshots.length - 1].bestFitness;
    const improvement = last - first;
    return improvement / snapshots.length;
  }

  private populationEntropy(population: IScoredGenome[]): number {
    if (population.length === 0) return 0;
    const min = Math.min(...population.map((p) => p.fitness));
    const max = Math.max(...population.map((p) => p.fitness));
    if (max === min) return 0;

    // Bin fitness into 5 buckets and compute Shannon entropy.
    const bins = 5;
    const counts = new Array(bins).fill(0);
    for (const p of population) {
      const idx = Math.min(bins - 1, Math.floor(((p.fitness - min) / (max - min)) * bins));
      counts[idx]++;
    }

    const probs = counts.map((c) => c / population.length).filter((p) => p > 0);
    const h = -probs.reduce((sum, p) => sum + p * Math.log2(p), 0);
    const maxH = Math.log2(bins);
    return maxH === 0 ? 0 : h / maxH;
  }

  private fitnessDistribution(population: IScoredGenome[]): IResearchReport["fitnessDistribution"] {
    const values = population.map((p) => p.fitness);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const buckets = new Array(10).fill(0);
    for (const v of values) {
      const idx = max === min ? 0 : Math.min(9, Math.floor(((v - min) / (max - min)) * 10));
      buckets[idx]++;
    }
    return { min, max, buckets };
  }

  /** Pareto front across (fitness, behaviourDiversity) objectives. */
  private computeParetoFront(evaluations: IEvaluationResult[]): IGenome[] {
    const candidates = evaluations.map((e) => ({
      genome: e.genome,
      fitness: e.averageFitness,
      diversity: e.objectiveScores["behaviourDiversity"] ?? 0,
    }));

    return candidates
      .filter((a) =>
        !candidates.some(
          (b) =>
            b !== a &&
            (b.fitness > a.fitness || b.diversity > a.diversity) &&
            b.fitness >= a.fitness &&
            b.diversity >= a.diversity,
        ),
      )
      .map((c) => c.genome);
  }

  private championComparison(evaluations: IEvaluationResult[]): IResearchReport["championComparison"] {
    const best = [...evaluations].sort((a, b) => b.averageFitness - a.averageFitness).slice(0, 5);
    return best.map((e) => ({
      genomeId: e.genome.id,
      fitness: e.averageFitness,
      archetypeStrengths: e.perArchetype,
      style: e.genome.narrativeTraits?.[0]?.category ?? "balanced",
    }));
  }
}
