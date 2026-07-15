// ============================================================================
// EVOLUTION MANAGER
//
// Orchestrates the offline genetic algorithm: selection, elitism, mutation,
// crossover, random restart, early stopping, diversity tracking, and champion
// lineage. The engine, FSM, renderer, and animation are never modified.
// ============================================================================

import type {
  IEvaluationResult,
  IEvolutionConfig,
  IGenerationSnapshot,
  IGenome,
  ILineageNode,
  IMutationEvent,
  IPlayerAgent,
  IScoredGenome,
} from "./types";
import { createRandomGenome, cloneGenome } from "./Genome";
import { Population } from "./Population";
import { FitnessEvaluator } from "./FitnessEvaluator";
import { SimulationRunner } from "./SimulationRunner";
import { MutationEngine } from "./MutationEngine";
import { CrossoverEngine } from "./CrossoverEngine";
import { TournamentSelection } from "./SelectionStrategy";
import { DatasetLogger } from "./DatasetLogger";
import { SelfPlayRunner } from "./SelfPlayRunner";
import { generateNarrative } from "./NarrativeTraitEngine";

export interface EvolutionManagerOptions {
  config: IEvolutionConfig;
  runner: SimulationRunner;
  agents: IPlayerAgent[];
  seedGenomes?: IGenome[];
  onGeneration?: (snapshot: IGenerationSnapshot) => void;
  datasetLogger?: DatasetLogger;
  rng?: () => number;
}

export class EvolutionManager {
  private config: IEvolutionConfig;
  private population: Population;
  private runner: SimulationRunner;
  private agents: IPlayerAgent[];
  private evaluator: FitnessEvaluator;
  private mutator: MutationEngine;
  private crossover: CrossoverEngine;
  private selector: TournamentSelection;
  private rng: () => number;

  private snapshots: IGenerationSnapshot[] = [];
  private mutationHistory: IMutationEvent[] = [];
  private lineage: Map<string, ILineageNode> = new Map();
  private evaluations: IEvaluationResult[] = [];
  private onGeneration?: (snapshot: IGenerationSnapshot) => void;
  private datasetLogger?: DatasetLogger;
  private selfPlayRunner?: SelfPlayRunner;
  private generation = 0;
  private bestFitnessEver = -Infinity;
  private stagnationCounter = 0;
  private stoppedEarly = false;
  private champion: IScoredGenome | null = null;

  constructor(options: EvolutionManagerOptions) {
    this.config = options.config;
    this.runner = options.runner;
    this.agents = options.agents;
    this.rng = options.rng ?? Math.random;
    this.onGeneration = options.onGeneration;
    this.datasetLogger = options.datasetLogger;

    if (this.config.selfPlayWeight && this.config.selfPlayWeight > 0) {
      this.selfPlayRunner = new SelfPlayRunner({
        baseOpponent: this.runner.getConfig().baseOpponent,
        timeStep: this.runner.getConfig().timeStep,
        maxDurationSeconds: this.runner.getConfig().maxDurationSeconds,
        fastRoundTransitions: this.runner.getConfig().fastRoundTransitions,
        deterministic: this.runner.getConfig().deterministic,
        seedBase: this.runner.getConfig().seedBase,
      });
    }

    this.population = new Population(this.config.populationSize);
    this.evaluator = new FitnessEvaluator(this.config.fitness);
    this.mutator = new MutationEngine(this.config.mutation);
    this.crossover = new CrossoverEngine(this.config.crossover);
    this.selector = new TournamentSelection(this.config.tournamentSize);

    if (options.seedGenomes && options.seedGenomes.length > 0) {
      this.population.seed(options.seedGenomes, this.rng);
    } else {
      this.population.initialize(this.rng);
    }
  }

  /** Runs the full evolution loop and returns the champion genome. */
  async run(): Promise<IGenome> {
    for (let g = 0; g < this.config.generations; g++) {
      this.generation = g;
      await this.runGeneration();

      // Yield to the browser/event loop so UI updates can render.
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (this.stoppedEarly) break;
    }

    if (!this.champion) throw new Error("Evolution produced no champion");
    return this.champion.genome;
  }

  /** Runs a single generation. */
  async runGeneration(): Promise<IGenerationSnapshot> {
    // 1. Evaluate every genome.
    const scored = await this.evaluatePopulation();
    this.population.setScores(scored);

    // 2. Snapshot statistics and update champion.
    const best = this.population.getBest()!;
    if (!this.champion || best.fitness > this.champion.fitness) {
      this.champion = { ...best };
    }
    const worst = scored[scored.length - 1];
    const avg = scored.reduce((sum, s) => sum + s.fitness, 0) / scored.length;
    const diversity = this.population.measureDiversity();

    const snapshot: IGenerationSnapshot = {
      generation: this.generation,
      bestFitness: best.fitness,
      averageFitness: avg,
      worstFitness: worst.fitness,
      diversity,
      bestGenomeId: best.genome.id,
      mutationEvents: this.mutationHistory.filter((m) => m.generation === this.generation),
    };
    this.snapshots.push(snapshot);
    this.onGeneration?.(snapshot);

    // 3. Early stopping.
    if (best.fitness > this.bestFitnessEver + this.config.earlyStoppingMinDelta) {
      this.bestFitnessEver = best.fitness;
      this.stagnationCounter = 0;
    } else {
      this.stagnationCounter++;
    }

    if (this.stagnationCounter >= this.config.earlyStoppingPatience) {
      this.stoppedEarly = true;
      return snapshot;
    }

    // 4. Diversity collapse / random restart.
    const lowDiversity = diversity < this.config.diversityThreshold;
    const restartGeneration =
      this.config.randomRestartInterval > 0 &&
      this.generation > 0 &&
      this.generation % this.config.randomRestartInterval === 0;

    if (lowDiversity || restartGeneration) {
      this.population.injectRandomImmigrants(
        this.config.randomRestartFraction,
        this.rng,
        this.generation + 1,
      );
    }

    // 5. Build next generation.
    const nextGeneration = this.breedNextGeneration(scored);
    this.population.setScores(nextGeneration.map((g) => ({ genome: g, fitness: 0, rawFitness: 0 })));

    return snapshot;
  }

  private async evaluatePopulation(): Promise<IScoredGenome[]> {
    const ranked = this.population.getRanked();
    const results: IScoredGenome[] = [];

    for (const entry of ranked) {
      const matches = this.agents.map((agent) => {
        const seed = this.hashSeed(entry.genome.id, agent.id, this.generation);
        return this.runner.runMatch(entry.genome, agent, seed);
      });

      let evaluation = this.evaluator.evaluate({
        genome: entry.genome,
        matches,
        perArchetype: {},
        warnings: [],
      });

      // Optional self-play bonus.
      if (this.selfPlayRunner && this.config.selfPlayWeight && this.config.selfPlayWeight > 0) {
        const selfPlayBonus = await this.evaluateSelfPlay(entry.genome, ranked.map((r) => r.genome));
        evaluation.averageFitness += selfPlayBonus * this.config.selfPlayWeight;
        evaluation.rawFitness += selfPlayBonus * this.config.selfPlayWeight;
      }

      entry.genome.fitness = evaluation.averageFitness;
      entry.genome.rawFitness = evaluation.rawFitness;
      entry.genome.fitnessHistory = [...(entry.genome.fitnessHistory ?? []), evaluation.averageFitness];
      entry.genome.narrativeTraits = generateNarrative(entry.genome);

      results.push({
        genome: entry.genome,
        fitness: evaluation.averageFitness,
        rawFitness: evaluation.rawFitness,
      });
      this.evaluations.push(evaluation);

      // Dataset generation.
      this.datasetLogger?.setGeneration(this.generation);
      if (this.config.generateDataset) {
        this.datasetLogger?.logEvaluation(evaluation, {
          baseOpponent: this.runner.getConfig().baseOpponent.name,
          roundsToWin: this.runner.getConfig().roundsToWin,
        });
      }
    }

    return results.sort((a, b) => b.fitness - a.fitness);
  }

  private async evaluateSelfPlay(genome: IGenome, opponents: IGenome[]): Promise<number> {
    if (!this.selfPlayRunner) return 0;
    const tournament = this.selfPlayRunner.runTournament([genome, ...opponents.slice(0, 4)], "roundRobin");
    const standing = tournament.standings.find((s) => s.genomeId === genome.id);
    if (!standing) return 0;
    const total = standing.wins + standing.losses + standing.draws;
    if (total === 0) return 0;
    return standing.score / (total * 3);
  }

  private breedNextGeneration(scored: IScoredGenome[]): IGenome[] {
    const next: IGenome[] = [];

    // Elitism: carry the best genomes forward unchanged.
    const elites = this.population.getElites(this.config.elitismCount);
    for (const elite of elites) {
      const clone = cloneGenome(elite, "elitism", this.generation + 1);
      this.lineage.set(clone.id, {
        generation: this.generation + 1,
        genomeId: clone.id,
        parentIds: [elite.id],
        source: "elitism",
        fitness: elite.fitness ?? 0,
      });
      next.push(clone);
    }

    // Fill the rest via selection + crossover + mutation.
    while (next.length < this.config.populationSize) {
      const parents = this.selector.select(scored, this.rng, 2);
      const { child, parentIds } = this.crossover.crossover(
        parents[0].genome,
        parents[1].genome,
        this.generation + 1,
        this.rng,
      );

      // Stamp parentage and generation before mutation.
      child.parentA = parentIds[0];
      child.parentB = parentIds[1];

      const { child: mutated, event } = this.mutator.mutate(child, this.generation + 1, this.rng);
      if (event.changedGenes.length > 0) {
        this.mutationHistory.push(event);
      }

      this.lineage.set(mutated.id, {
        generation: this.generation + 1,
        genomeId: mutated.id,
        parentIds,
        source: mutated.source ?? "breed",
        fitness: mutated.fitness ?? 0,
        fitnessHistory: mutated.fitnessHistory,
      });

      next.push(mutated);
    }

    return next;
  }

  /** Deterministic seed for a (genome, agent, generation) triplet. */
  private hashSeed(genomeId: string, agentId: string, generation: number): number {
    let h = 2166136261;
    const str = `${genomeId}:${agentId}:${generation}`;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  getSnapshots(): IGenerationSnapshot[] {
    return this.snapshots.slice();
  }

  getMutationHistory(): IMutationEvent[] {
    return this.mutationHistory.slice();
  }

  getLineage(): ILineageNode[] {
    return Array.from(this.lineage.values()).sort((a, b) => a.generation - b.generation);
  }

  getEvaluations(): IEvaluationResult[] {
    return this.evaluations.slice();
  }

  getDatasetLogger(): DatasetLogger | undefined {
    return this.datasetLogger;
  }

  getChampion(): IScoredGenome | null {
    return this.champion;
  }

  isStoppedEarly(): boolean {
    return this.stoppedEarly;
  }

  setConfig(config: IEvolutionConfig): void {
    this.config = config;
    this.evaluator.setWeights(config.fitness);
    this.mutator.setConfig(config.mutation);
    this.crossover.setConfig(config.crossover);
    this.selector.setTournamentSize(config.tournamentSize);
  }
}
