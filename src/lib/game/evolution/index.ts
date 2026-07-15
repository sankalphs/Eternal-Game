// ============================================================================
// EVOLUTION FRAMEWORK — PUBLIC API
//
// Offline genetic algorithm for tuning EnemyAI behaviour parameters.
// No runtime mutation. No engine modification. Deterministic simulations.
// ============================================================================

export * from "./types";
export * from "./Genome";
export * from "./GenomeSerializer";
export * from "./MutationEngine";
export * from "./CrossoverEngine";
export * from "./Population";
export * from "./FitnessEvaluator";
export * from "./SimulationRunner";
export * from "./EvolutionManager";
export * from "./EvolutionReport";
export * from "./SelectionStrategy";
export * from "./GenomeLibrary";
export * from "./FrozenGenomeLibrary";
export * from "./ConvergenceDetector";
export * from "./NarrativeTraitEngine";
export * from "./GenealogyEngine";
export * from "./DatasetLogger";
export * from "./SelfPlayRunner";
export * from "./ResearchReportEngine";
export * from "./ResearchReport";
export * from "./GenomeDirector";
export * from "./DirectorBridge";
export * from "./agents";

import { OPPONENTS } from "../engine";
import { SimulationRunner } from "./SimulationRunner";
import { FitnessEvaluator } from "./FitnessEvaluator";
import { MutationEngine } from "./MutationEngine";
import { CrossoverEngine } from "./CrossoverEngine";
import { EvolutionManager } from "./EvolutionManager";
import { EvolutionReport } from "./EvolutionReport";
import { createAllAgents } from "./agents";
import type { IEvolutionConfig } from "./types";

/** Convenience factory for a complete EvolutionManager with sensible defaults. */
export function createEvolutionManager(config: IEvolutionConfig, baseOpponentIndex = 0) {
  const base = OPPONENTS[baseOpponentIndex] ?? OPPONENTS[0];
  return new EvolutionManager({
    config,
    runner: new SimulationRunner(SimulationRunner.defaultConfig(base)),
    agents: createAllAgents(),
  });
}
