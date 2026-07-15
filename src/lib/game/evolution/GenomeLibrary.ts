// ============================================================================
// GENOME LIBRARY
//
// Evolves a set of Pareto-optimal champions, each specialized toward a
// distinct play-style. The Director can later choose among these frozen
// genomes instead of receiving a single champion.
// ============================================================================

import { OPPONENTS } from "../engine";
import type {
  GenomeStyle,
  IEvolutionConfig,
  IFitnessWeights,
  ILibraryEntry,
  IGenomeLibrary,
  IPlayerAgent,
} from "./types";
import { FitnessEvaluator } from "./FitnessEvaluator";
import { SimulationRunner } from "./SimulationRunner";
import { EvolutionManager } from "./EvolutionManager";
import { createAllAgents } from "./agents";
import { generateNarrative } from "./NarrativeTraitEngine";

export const STYLE_WEIGHTS: Record<GenomeStyle, Partial<IFitnessWeights>> = {
  balanced: {},
  aggressive: {
    winRate: 0.25,
    damage: 0.2,
    fightDuration: 0.05,
    infiniteAggressionPenalty: 0.01,
  },
  counter: {
    forcedAdaptation: 0.18,
    combatVariety: 0.05,
    unpredictability: 0.1,
    closeFinishBonus: 0.12,
  },
  patient: {
    survival: 0.2,
    closeFinishBonus: 0.15,
    campingPenalty: 0.01,
    infiniteBlockPenalty: 0.01,
  },
  rushdown: {
    winRate: 0.22,
    damage: 0.18,
    fightDuration: 0.05,
    spacingDiversity: 0.02,
  },
  mindGame: {
    unpredictability: 0.2,
    combatVariety: 0.15,
    behaviourDiversity: 0.15,
    forcedAdaptation: 0.1,
  },
  adaptive: {
    forcedAdaptation: 0.2,
    combatVariety: 0.12,
    behaviourDiversity: 0.12,
    winRate: 0.1,
  },
  zoner: {
    spacingDiversity: 0.2,
    combatVariety: 0.1,
    behaviourDiversity: 0.1,
    closeFinishBonus: 0.05,
  },
  pressure: {
    winRate: 0.2,
    damage: 0.15,
    forcedAdaptation: 0.1,
    fightDuration: 0.05,
    infiniteAggressionPenalty: 0.01,
  },
};

export interface GenomeLibraryOptions {
  baseConfig: IEvolutionConfig;
  styles?: GenomeStyle[];
  baseOpponentIndex?: number;
  onStyleStart?: (style: GenomeStyle) => void;
  onStyleComplete?: (style: GenomeStyle, entry: ILibraryEntry) => void;
  onGeneration?: (style: GenomeStyle, generation: number, bestFitness: number) => void;
}

export function loadGenomeLibrary(libraryJson: string): IGenomeLibrary {
  const parsed = JSON.parse(libraryJson) as IGenomeLibrary;
  return parsed;
}

export class GenomeLibrary {
  private baseConfig: IEvolutionConfig;
  private styles: GenomeStyle[];
  private baseOpponentIndex: number;
  private agents: IPlayerAgent[];

  constructor(options: GenomeLibraryOptions) {
    this.baseConfig = options.baseConfig;
    this.styles = options.styles ?? Object.keys(STYLE_WEIGHTS) as GenomeStyle[];
    this.baseOpponentIndex = options.baseOpponentIndex ?? 0;
    this.agents = createAllAgents();
  }

  /** Evolves the full library of styles. */
  async evolve(): Promise<IGenomeLibrary> {
    const entries: Partial<Record<GenomeStyle, ILibraryEntry>> = {};
    const base = OPPONENTS[this.baseOpponentIndex] ?? OPPONENTS[0];

    for (const style of this.styles) {
      const entry = await this.evolveStyle(style);
      entries[style] = entry;
    }

    return {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      baseOpponent: base.name,
      entries: entries as Record<GenomeStyle, ILibraryEntry>,
    };
  }

  /** Evolves one style toward its Pareto optimum. */
  async evolveStyle(style: GenomeStyle): Promise<ILibraryEntry> {
    const base = OPPONENTS[this.baseOpponentIndex] ?? OPPONENTS[0];
    const weights = this.styleWeights(style);
    const config: IEvolutionConfig = {
      ...this.baseConfig,
      fitness: weights,
    };

    const runner = new SimulationRunner({
      timeStep: 1 / 30,
      maxDurationSeconds: 120,
      roundsToWin: 2,
      fastRoundTransitions: true,
      deterministic: true,
      seedBase: this.hashStyleSeed(style),
      background: "sunset",
      baseOpponent: base,
    });

    const manager = new EvolutionManager({
      config,
      runner,
      agents: this.agents,
    });

    const genome = await manager.run();
    const benchmarks = this.benchmark(genome);

    return {
      style,
      genome,
      weights,
      benchmarks,
      narrative: generateNarrative(genome).map((t) => t.description).join(" "),
    };
  }

  /** Benchmarks a genome against all archetypes and returns per-archetype fitness. */
  benchmark(genome: IGenome): Record<string, number> {
    const base = OPPONENTS[this.baseOpponentIndex] ?? OPPONENTS[0];
    const runner = new SimulationRunner({
      timeStep: 1 / 30,
      maxDurationSeconds: 120,
      roundsToWin: 2,
      fastRoundTransitions: true,
      deterministic: true,
      seedBase: 42,
      background: "sunset",
      baseOpponent: base,
    });

    const evaluator = new FitnessEvaluator(FitnessEvaluator.defaultWeights());
    const benchmarks: Record<string, number> = {};

    for (const agent of this.agents) {
      const seed = this.hashSeed(genome.id, agent.id);
      const metrics = runner.runMatch(genome, agent, seed);
      const { score } = evaluator.scoreMatch(metrics);
      benchmarks[agent.id] = score;
    }

    return benchmarks;
  }

  private styleWeights(style: GenomeStyle): IFitnessWeights {
    const defaults = FitnessEvaluator.defaultWeights();
    const override = STYLE_WEIGHTS[style] ?? {};
    return { ...defaults, ...override };
  }

  private hashStyleSeed(style: string): number {
    let h = 2166136261;
    for (let i = 0; i < style.length; i++) {
      h ^= style.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private hashSeed(a: string, b: string): number {
    let h = 2166136261;
    const str = `${a}:${b}`;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
}
