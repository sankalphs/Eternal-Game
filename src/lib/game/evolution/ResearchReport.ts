// ============================================================================
// RESEARCH REPORT
//
// Exportable research report containing diversity, entropy, convergence,
// Pareto front, fitness distribution, and champion comparison.
// ============================================================================

import type { IResearchReport } from "./types";
import { ResearchReportEngine } from "./ResearchReportEngine";
import type { EvolutionReportOptions } from "./EvolutionReport";

export interface ResearchReportOptions extends EvolutionReportOptions {
  diversityThreshold?: number;
}

export class ResearchReport {
  private data: IResearchReport;

  constructor(options: ResearchReportOptions) {
    const engine = new ResearchReportEngine();
    const population = options.evaluations.map((e) => ({
      genome: e.genome,
      fitness: e.averageFitness,
      rawFitness: e.rawFitness,
    }));
    this.data = engine.generate(
      population,
      options.evaluations,
      options.snapshots,
      options.diversityThreshold,
    );
  }

  toJSON(): IResearchReport {
    return JSON.parse(JSON.stringify(this.data));
  }

  serialize(pretty = true): string {
    return JSON.stringify(this.data, null, pretty ? 2 : undefined);
  }
}
