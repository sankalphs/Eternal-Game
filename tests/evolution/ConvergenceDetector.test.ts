// ============================================================================
// CONVERGENCE DETECTOR TESTS
// ============================================================================

import { describe, expect, it } from "bun:test";
import { ConvergenceDetector, DEFAULT_CONVERGENCE_CONFIG } from "../../src/lib/game/evolution/ConvergenceDetector";
import type { IGenerationSnapshot } from "../../src/lib/game/evolution/types";

const makeSnapshots = (fitnesses: number[]): IGenerationSnapshot[] => {
  return fitnesses.map((f, i) => ({
    generation: i,
    bestFitness: f,
    averageFitness: f * 0.8,
    worstFitness: f * 0.5,
    diversity: 0.05 + i * 0.001,
    bestGenomeId: `g_${i}`,
    mutationEvents: [],
  }));
};

describe("ConvergenceDetector", () => {
  it("detects a fitness plateau", () => {
    const detector = new ConvergenceDetector({ plateauWindow: 5, plateauMinDelta: 0.01 });
    // Constant fitness → plateau
    const snaps = makeSnapshots([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const result = detector.evaluate(snaps);
    expect(result.plateau).toBe(true);
  });

  it("does not flag plateau when fitness is improving", () => {
    const detector = new ConvergenceDetector({ plateauWindow: 5, plateauMinDelta: 0.01 });
    const snaps = makeSnapshots([0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1]);
    const result = detector.evaluate(snaps);
    expect(result.plateau).toBe(false);
  });

  it("detects diversity collapse", () => {
    const detector = new ConvergenceDetector({ diversityMin: 0.1 });
    const snaps = makeSnapshots([0.5]);
    snaps[0].diversity = 0.05; // below threshold
    const result = detector.evaluate(snaps);
    expect(result.diversityCollapsed).toBe(true);
  });

  it("detects ELO stabilisation", () => {
    const detector = new ConvergenceDetector({ eloStabilisationWindow: 10, eloStabilisationEpsilon: 5 });
    // Feed constant ELO
    for (let i = 0; i < 15; i++) {
      detector.recordElo(1500);
    }
    const result = detector.evaluate(makeSnapshots([0.5]));
    expect(result.eloStable).toBe(true);
  });

  it("returns not converged without enough data", () => {
    const detector = new ConvergenceDetector();
    const result = detector.evaluate(makeSnapshots([0.5, 0.6]));
    expect(result.converged).toBe(false);
  });

  it("returns converged when fitness plateau + diversity collapse", () => {
    const detector = new ConvergenceDetector({
      plateauWindow: 5, plateauMinDelta: 0.01,
      diversityMin: 0.1,
    });
    const snaps = makeSnapshots([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    snaps[snaps.length - 1].diversity = 0.05;
    const result = detector.evaluate(snaps);
    expect(result.plateau).toBe(true);
    expect(result.diversityCollapsed).toBe(true);
    expect(result.converged).toBe(true);
  });
});
