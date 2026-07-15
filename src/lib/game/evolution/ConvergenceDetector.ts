// ============================================================================
// PROJECT ETERNAL — CONVERGENCE DETECTOR
//
// Watches evolution runs and decides when to FREEZE the library.
// Uses three signals:
//   1. Fitness plateau (top fitness stops improving over N generations)
//   2. Population diversity collapse (everyone converges to the same genome)
//   3. ELO stabilisation (rating delta over the last N matches < threshold)
//
// The detector is offline and deterministic. It is the gate between
// the live EvolutionManager and the frozen GenomeLibrary.
// ============================================================================

import type { IGenerationSnapshot, IScoredGenome } from "./types";
import { genomeDistance } from "./Genome";

export interface ConvergenceConfig {
  plateauWindow: number;             // N generations to look back
  plateauMinDelta: number;           // top-fitness delta required to "not be plateaued"
  diversityMin: number;              // min average pairwise distance to count as diverse
  eloStabilisationWindow: number;    // N matches to look back for ELO
  eloStabilisationEpsilon: number;    // max avg |delta| over the window
}

export const DEFAULT_CONVERGENCE_CONFIG: ConvergenceConfig = {
  plateauWindow: 15,
  plateauMinDelta: 0.005,
  diversityMin: 0.04,
  eloStabilisationWindow: 200,
  eloStabilisationEpsilon: 8,
};

export interface ConvergenceStatus {
  plateau: boolean;
  diversityCollapsed: boolean;
  eloStable: boolean;
  converged: boolean;
  reasons: string[];
  metrics: {
    topFitnessDelta: number;
    avgPairwiseDistance: number;
    eloMeanAbsDelta: number;
  };
}

export class ConvergenceDetector {
  private config: ConvergenceConfig;
  private eloHistory: { rating: number; ts: number }[] = [];

  constructor(config: Partial<ConvergenceConfig> = {}) {
    this.config = { ...DEFAULT_CONVERGENCE_CONFIG, ...config };
  }

  /**
   * Decide whether the most recent snapshot represents convergence.
   * Pass the full snapshot history (newest last).
   */
  evaluate(snapshots: IGenerationSnapshot[]): ConvergenceStatus {
    const cfg = this.config;
    const reasons: string[] = [];

    // 1. Fitness plateau
    let topFitnessDelta = 0;
    let plateau = false;
    if (snapshots.length >= cfg.plateauWindow) {
      const window = snapshots.slice(-cfg.plateauWindow);
      const fitnesses = window.map(s => s.bestFitness ?? 0);
      const first = fitnesses[0];
      const last = fitnesses[fitnesses.length - 1];
      topFitnessDelta = last - first;
      plateau = topFitnessDelta < cfg.plateauMinDelta;
      if (plateau) {
        reasons.push(
          `fitness plateau: Δ=${topFitnessDelta.toFixed(4)} < ${cfg.plateauMinDelta} over ${cfg.plateauWindow} gens`,
        );
      }
    }

    // 2. Population diversity (use the IGenerationSnapshot.diversity field)
    let avgPairwiseDistance = 1.0;
    let diversityCollapsed = false;
    const latest = snapshots[snapshots.length - 1];
    if (latest && typeof latest.diversity === "number") {
      avgPairwiseDistance = latest.diversity;
      diversityCollapsed = avgPairwiseDistance < cfg.diversityMin;
      if (diversityCollapsed) {
        reasons.push(
          `diversity collapse: avg=${avgPairwiseDistance.toFixed(3)} < ${cfg.diversityMin}`,
        );
      }
    }

    // 3. ELO stabilisation
    let eloMeanAbsDelta = 0;
    let eloStable = false;
    if (this.eloHistory.length >= cfg.eloStabilisationWindow) {
      const window = this.eloHistory.slice(-cfg.eloStabilisationWindow);
      const deltas: number[] = [];
      for (let i = 1; i < window.length; i++) {
        deltas.push(Math.abs(window[i].rating - window[i - 1].rating));
      }
      eloMeanAbsDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      eloStable = eloMeanAbsDelta < cfg.eloStabilisationEpsilon;
      if (eloStable) {
        reasons.push(
          `ELO stable: avg|Δ|=${eloMeanAbsDelta.toFixed(2)} < ${cfg.eloStabilisationEpsilon} over ${cfg.eloStabilisationWindow} matches`,
        );
      }
    }

    // Converged when at least 2 of 3 signals are positive (fitness plateau is mandatory)
    const converged = plateau && (diversityCollapsed || eloStable || snapshots.length >= 200);

    return {
      plateau,
      diversityCollapsed,
      eloStable,
      converged,
      reasons,
      metrics: { topFitnessDelta, avgPairwiseDistance, eloMeanAbsDelta },
    };
  }

  recordElo(elo: number): void {
    this.eloHistory.push({ rating: elo, ts: Date.now() });
    if (this.eloHistory.length > 5000) {
      this.eloHistory = this.eloHistory.slice(-5000);
    }
  }

  resetElo(): void {
    this.eloHistory = [];
  }

  getConfig(): ConvergenceConfig {
    return this.config;
  }
}

function averagePairwiseDistance(pop: IScoredGenome[]): number {
  if (pop.length < 2) return 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < pop.length; i++) {
    for (let j = i + 1; j < pop.length; j++) {
      total += genomeDistance(pop[i].genome, pop[j].genome);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}
