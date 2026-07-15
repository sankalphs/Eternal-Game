// ============================================================================
// EVOLUTION REPORT
//
// Aggregates generation statistics, champion lineage, mutation history,
// fitness graph data, diversity, and exports everything to JSON.
// ============================================================================

import type {
  IEvaluationResult,
  IEvolutionConfig,
  IEvolutionReportData,
  IGenerationSnapshot,
  IGenome,
  ILineageNode,
  IMutationEvent,
} from "./types";
import { serializeGenome } from "./GenomeSerializer";

export interface EvolutionReportOptions {
  config: IEvolutionConfig;
  snapshots: IGenerationSnapshot[];
  champion: IGenome;
  lineage: ILineageNode[];
  mutationHistory: IMutationEvent[];
  evaluations: IEvaluationResult[];
}

export class EvolutionReport {
  private data: IEvolutionReportData;

  constructor(options: EvolutionReportOptions) {
    this.data = {
      config: options.config,
      snapshots: options.snapshots,
      champion: options.champion,
      lineage: options.lineage,
      mutationHistory: options.mutationHistory,
      archetypePerformance: this.computeArchetypePerformance(options.evaluations),
      exportedAt: new Date().toISOString(),
    };
  }

  /** Returns the raw report object. */
  toJSON(): IEvolutionReportData {
    return JSON.parse(JSON.stringify(this.data));
  }

  /** Serializes the full report. */
  serialize(pretty = true): string {
    return JSON.stringify(this.data, null, pretty ? 2 : undefined);
  }

  /** Serializes only the champion genome (the runtime loadable artifact). */
  serializeChampion(pretty = true): string {
    return serializeGenome(this.data.champion);
  }

  /** Returns fitness graph data: [{ generation, best, average, worst, diversity }]. */
  getFitnessGraphData(): Array<{
    generation: number;
    best: number;
    average: number;
    worst: number;
    diversity: number;
  }> {
    return this.data.snapshots.map((s) => ({
      generation: s.generation,
      best: s.bestFitness,
      average: s.averageFitness,
      worst: s.worstFitness,
      diversity: s.diversity,
    }));
  }

  /** Returns the champion lineage as an ordered list. */
  getChampionLineage(): ILineageNode[] {
    const map = new Map(this.data.lineage.map((n) => [n.genomeId, n]));
    const championId = this.data.champion.id;
    const path: ILineageNode[] = [];
    let current = map.get(championId);
    const visited = new Set<string>();

    while (current && !visited.has(current.genomeId)) {
      path.unshift(current);
      visited.add(current.genomeId);
      const parent = current.parentIds[0];
      current = parent ? map.get(parent) : undefined;
    }

    return path;
  }

  /** Returns per-generation mutation counts. */
  getMutationCounts(): Array<{ generation: number; count: number }> {
    const counts = new Map<number, number>();
    for (const m of this.data.mutationHistory) {
      counts.set(m.generation, (counts.get(m.generation) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([generation, count]) => ({ generation, count }))
      .sort((a, b) => a.generation - b.generation);
  }

  /** Returns the final champion genome. */
  getChampion(): IGenome {
    return this.data.champion;
  }

  private computeArchetypePerformance(evaluations: IEvaluationResult[]): Record<string, number> {
    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};

    for (const e of evaluations) {
      for (const [archetype, score] of Object.entries(e.perArchetype)) {
        sums[archetype] = (sums[archetype] ?? 0) + score;
        counts[archetype] = (counts[archetype] ?? 0) + 1;
      }
    }

    const result: Record<string, number> = {};
    for (const key of Object.keys(sums)) {
      result[key] = sums[key] / (counts[key] || 1);
    }
    return result;
  }
}
