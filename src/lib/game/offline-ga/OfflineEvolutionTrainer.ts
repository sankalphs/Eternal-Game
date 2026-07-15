import path from "path";
import { Rng } from "../simulator/Rng";
import type { FightResult } from "../simulator/MatchResult";
import {
  createRandomOfflineGenome,
  gaussianMutate,
  OFFLINE_GENE_KEYS,
  OFFLINE_GENOME_VERSION,
  populationDiversity,
  uniformCrossover,
} from "./Genome";
import { defaultFitnessWeights, OfflineFitnessEvaluator } from "./Fitness";
import { OfflineCheckpointStore } from "./CheckpointStore";
import { defaultBaselineOpponents, HeadlessFightingSimulatorAdapter, type FightingSimulator } from "./SimulatorAdapter";
import type {
  BaselineOpponent,
  BestGenomeArtifact,
  EvaluatedGenome,
  GenerationStats,
  MutationStats,
  OfflineEvolutionCheckpoint,
  OfflineEvolutionConfig,
  OfflineGenome,
  ValidationReport,
} from "./types";

export interface OfflineEvolutionTrainerOptions {
  config?: Partial<OfflineEvolutionConfig>;
  simulator?: FightingSimulator;
  baselines?: BaselineOpponent[];
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface OfflineEvolutionResult {
  bestGenome: OfflineGenome;
  validationReport: ValidationReport;
  stats: GenerationStats[];
  accepted: boolean;
  outputPath: string;
}

export class OfflineEvolutionTrainer {
  private config: OfflineEvolutionConfig;
  private simulator: FightingSimulator;
  private baselines: BaselineOpponent[];
  private logger: Pick<Console, "log" | "warn" | "error">;
  private rng: Rng;
  private evaluator: OfflineFitnessEvaluator;
  private checkpoints: OfflineCheckpointStore;
  private population: OfflineGenome[] = [];
  private stats: GenerationStats[] = [];
  private bestGenome: OfflineGenome | null = null;
  private baselineFitnessWeights: Record<string, number> = {};

  constructor(options: OfflineEvolutionTrainerOptions = {}) {
    this.config = { ...defaultOfflineEvolutionConfig(), ...(options.config ?? {}) };
    this.simulator = options.simulator ?? new HeadlessFightingSimulatorAdapter();
    this.baselines = options.baselines ?? defaultBaselineOpponents();
    this.logger = options.logger ?? console;
    this.rng = new Rng(this.config.seed);
    this.evaluator = new OfflineFitnessEvaluator(this.config.fitnessWeights);
    this.checkpoints = new OfflineCheckpointStore(this.config.checkpointDir);
  }

  async run(): Promise<OfflineEvolutionResult> {
    this.initializePopulation();
    let validationReport: ValidationReport | null = null;

    while (this.currentGeneration() < this.config.maxGenerations) {
      const generation = this.currentGeneration();
      const evaluated = await this.evaluatePopulation(generation);
      const generationStats = this.recordGeneration(generation, evaluated);
      this.saveCheckpoint(generation);
      this.logger.log(
        `[offline-ga] generation=${generation} best=${generationStats.bestFitness.toFixed(4)} avg=${generationStats.averageFitness.toFixed(4)} diversity=${generationStats.diversity.toFixed(4)}`,
      );

      if (generation + 1 >= this.config.generations || Object.keys(this.baselineFitnessWeights).length > 0) {
        validationReport = this.validateBestGenome(generation);
        if (validationReport.accepted) break;
        this.increasePressureAgainstFailedBaselines(validationReport);
      }

      if (generation + 1 >= this.config.maxGenerations) break;
      this.population = this.breedNextGeneration(evaluated, generation + 1);
    }

    if (!this.bestGenome) throw new Error("Offline GA produced no best genome");
    const finalReport = validationReport ?? this.validateBestGenome(this.bestGenome.generation);
    const artifact = this.createArtifact(this.bestGenome, finalReport);
    this.checkpoints.saveBestGenome(this.config.outputPath, artifact);

    return {
      bestGenome: this.bestGenome,
      validationReport: finalReport,
      stats: this.stats.slice(),
      accepted: finalReport.accepted,
      outputPath: path.resolve(this.config.outputPath),
    };
  }

  loadLatestCheckpoint(): boolean {
    const checkpoint = this.checkpoints.loadLatest();
    if (!checkpoint) return false;
    this.population = checkpoint.population;
    this.stats = checkpoint.stats;
    this.baselineFitnessWeights = checkpoint.baselineFitnessWeights;
    this.bestGenome = checkpoint.bestGenome;
    this.rng.setState(checkpoint.rngState);
    return true;
  }

  private initializePopulation(): void {
    if (this.population.length > 0) return;
    this.population = Array.from({ length: this.config.populationSize }, () => createRandomOfflineGenome(this.rng, 0));
  }

  private async evaluatePopulation(generation: number): Promise<EvaluatedGenome[]> {
    const evaluated: EvaluatedGenome[] = [];
    const parallelism = Math.max(1, this.config.parallelism);

    for (let i = 0; i < this.population.length; i += parallelism) {
      const batch = this.population.slice(i, i + parallelism);
      const results = await Promise.all(batch.map((genome, offset) => this.evaluateGenome(genome, generation, i + offset)));
      evaluated.push(...results);
      await Promise.resolve();
    }

    return evaluated.sort((a, b) => b.fitness - a.fitness);
  }

  private async evaluateGenome(genome: OfflineGenome, generation: number, genomeIndex: number): Promise<EvaluatedGenome> {
    const fights: FightResult[] = [];
    for (let match = 0; match < this.config.matchesPerGenome; match++) {
      const opponent = this.pickOpponentGenome(genome);
      const seed = this.seedFor(generation, genomeIndex, match, 0x9e3779b9);
      fights.push(this.simulator.fightGenomeVsGenome({ genomeA: genome, genomeB: opponent, seed }));
    }

    for (const baseline of this.baselines) {
      const pressure = this.baselineFitnessWeights[baseline.id] ?? 0;
      if (pressure <= 0) continue;
      const seed = this.seedFor(generation, genomeIndex, baseline.id.length, 0x85ebca6b);
      fights.push(this.simulator.fightGenomeVsBaseline({ genome, baseline, seed }));
    }

    const evaluated = this.evaluator.evaluate(genome, fights, 0);
    const pressureBonus = this.computeBaselinePressureBonus(genome, generation, genomeIndex);
    evaluated.fitness += pressureBonus;
    evaluated.rawFitness += pressureBonus;
    evaluated.genome.fitness = evaluated.fitness;
    evaluated.genome.rawFitness = evaluated.rawFitness;
    return evaluated;
  }

  private computeBaselinePressureBonus(genome: OfflineGenome, generation: number, genomeIndex: number): number {
    let bonus = 0;
    for (const baseline of this.baselines) {
      const pressure = this.baselineFitnessWeights[baseline.id] ?? 0;
      if (pressure <= 0) continue;
      const seed = this.seedFor(generation, genomeIndex, baseline.id.length, 0xc2b2ae35);
      const fight = this.simulator.fightGenomeVsBaseline({ genome, baseline, seed });
      bonus += this.evaluator.scoreFight(fight, 0) * pressure * this.config.baselinePressureWeight;
    }
    return bonus;
  }

  private recordGeneration(generation: number, evaluated: EvaluatedGenome[]): GenerationStats {
    const best = evaluated[0];
    if (!best) throw new Error("Cannot record an empty generation");

    if (!this.bestGenome || best.fitness > (this.bestGenome.fitness ?? -Infinity)) {
      this.bestGenome = { ...best.genome, fitness: best.fitness, rawFitness: best.rawFitness };
    }

    const averageFitness = evaluated.reduce((sum, item) => sum + item.fitness, 0) / evaluated.length;
    const generationStats: GenerationStats = {
      generation,
      bestFitness: best.fitness,
      averageFitness,
      diversity: populationDiversity(this.population),
      mutationStats: this.lastMutationStats ?? emptyMutationStats(),
      bestGenomeId: best.genome.id,
      evaluatedMatches: evaluated.reduce((sum, item) => sum + item.matches, 0),
    };
    this.stats.push(generationStats);
    this.lastMutationStats = emptyMutationStats();
    return generationStats;
  }

  private lastMutationStats: MutationStats = emptyMutationStats();

  private breedNextGeneration(evaluated: EvaluatedGenome[], generation: number): OfflineGenome[] {
    const eliteCount = Math.max(1, Math.floor(this.config.populationSize * this.config.eliteFraction));
    const next: OfflineGenome[] = evaluated.slice(0, eliteCount).map((item) => ({
      ...item.genome,
      generation,
      source: "elitism" as const,
      parentIds: [item.genome.id],
      fitness: undefined,
      rawFitness: undefined,
    }));

    const mutationStats = emptyMutationStats();
    while (next.length < this.config.populationSize) {
      const parentA = this.tournamentSelect(evaluated).genome;
      const parentB = this.tournamentSelect(evaluated).genome;
      const crossed = this.rng.chance(this.config.crossoverRate)
        ? uniformCrossover(parentA, parentB, generation, this.rng)
        : { ...parentA, generation, source: "crossover" as const, parentIds: [parentA.id] };

      const mutation = gaussianMutate(crossed, generation, this.rng, this.config.mutationRate, this.config.mutationStdDev);
      mutationStats.mutatedGenes += mutation.mutatedGenes;
      mutationStats.totalGenes += OFFLINE_GENE_KEYS.length;
      mutationStats.averageAbsoluteDelta += mutation.averageAbsoluteDelta * mutation.mutatedGenes;
      mutationStats.maxAbsoluteDelta = Math.max(mutationStats.maxAbsoluteDelta, mutation.maxAbsoluteDelta);
      next.push(mutation.genome);
    }

    mutationStats.averageAbsoluteDelta =
      mutationStats.mutatedGenes === 0 ? 0 : mutationStats.averageAbsoluteDelta / mutationStats.mutatedGenes;
    this.lastMutationStats = mutationStats;
    return next;
  }

  private validateBestGenome(generation: number): ValidationReport {
    if (!this.bestGenome) throw new Error("Cannot validate before a best genome exists");
    const results = this.baselines.map((baseline, index) => {
      let wins = 0;
      let losses = 0;
      let draws = 0;
      for (let i = 0; i < this.config.validationMatchesPerBaseline; i++) {
        const seed = this.seedFor(generation, index, i, 0x27d4eb2f);
        const fight = this.simulator.fightGenomeVsBaseline({ genome: this.bestGenome!, baseline, seed });
        if (fight.winnerSide === 0) wins++;
        else if (fight.winnerSide === 1) losses++;
        else draws++;
      }
      const winRate = wins / this.config.validationMatchesPerBaseline;
      return {
        baselineId: baseline.id,
        baselineName: baseline.opponent.name,
        fights: this.config.validationMatchesPerBaseline,
        wins,
        losses,
        draws,
        winRate,
        accepted: winRate >= this.config.validationWinRateThreshold,
      };
    });

    const failedBaselineIds = results.filter((result) => !result.accepted).map((result) => result.baselineId);
    return {
      threshold: this.config.validationWinRateThreshold,
      fightsPerBaseline: this.config.validationMatchesPerBaseline,
      accepted: failedBaselineIds.length === 0,
      results,
      failedBaselineIds,
    };
  }

  private increasePressureAgainstFailedBaselines(report: ValidationReport): void {
    for (const id of report.failedBaselineIds) {
      this.baselineFitnessWeights[id] = (this.baselineFitnessWeights[id] ?? 0) + 1;
    }
    if (report.failedBaselineIds.length > 0) {
      this.logger.warn(`[offline-ga] validation failed against ${report.failedBaselineIds.join(", ")}; increasing baseline fitness pressure`);
    }
  }

  private createArtifact(genome: OfflineGenome, validationReport: ValidationReport): BestGenomeArtifact {
    return {
      genome: genome.genes,
      genomeId: genome.id,
      fitness: genome.fitness ?? 0,
      validationReport,
      winRateByBaseline: Object.fromEntries(validationReport.results.map((result) => [result.baselineName, result.winRate])),
      generationDiscovered: genome.generation,
      metadata: {
        version: OFFLINE_GENOME_VERSION,
        seed: this.config.seed,
        exportedAt: new Date().toISOString(),
        sourceGenome: genome,
      },
    };
  }

  private saveCheckpoint(generation: number): void {
    const checkpoint: OfflineEvolutionCheckpoint = {
      version: OFFLINE_GENOME_VERSION,
      generation,
      rngState: this.rng.getState(),
      population: this.population,
      stats: this.stats,
      baselineFitnessWeights: this.baselineFitnessWeights,
      bestGenome: this.bestGenome,
    };
    this.checkpoints.saveGeneration(checkpoint);
  }

  private tournamentSelect(evaluated: EvaluatedGenome[]): EvaluatedGenome {
    let best = evaluated[this.rng.int(0, evaluated.length)]!;
    for (let i = 1; i < this.config.tournamentSize; i++) {
      const candidate = evaluated[this.rng.int(0, evaluated.length)]!;
      if (candidate.fitness > best.fitness) best = candidate;
    }
    return best;
  }

  private pickOpponentGenome(subject: OfflineGenome): OfflineGenome {
    if (this.population.length <= 1) return subject;
    let opponent = subject;
    for (let attempts = 0; attempts < 8 && opponent.id === subject.id; attempts++) {
      opponent = this.population[this.rng.int(0, this.population.length)]!;
    }
    return opponent.id === subject.id ? this.population.find((item) => item.id !== subject.id) ?? subject : opponent;
  }

  private seedFor(generation: number, a: number, b: number, salt: number): number {
    let seed = this.config.seed >>> 0;
    seed = Math.imul(seed ^ generation, 16777619) >>> 0;
    seed = Math.imul(seed ^ a, 16777619) >>> 0;
    seed = Math.imul(seed ^ b, 16777619) >>> 0;
    seed = Math.imul(seed ^ salt, 16777619) >>> 0;
    return seed || 1;
  }

  private currentGeneration(): number {
    return this.stats.length === 0 ? 0 : this.stats[this.stats.length - 1]!.generation + 1;
  }
}

export function defaultOfflineEvolutionConfig(): OfflineEvolutionConfig {
  return {
    populationSize: 100,
    generations: 100,
    maxGenerations: 300,
    matchesPerGenome: 8,
    mutationRate: 0.12,
    mutationStdDev: 0.08,
    crossoverRate: 0.75,
    eliteFraction: 0.2,
    tournamentSize: 4,
    seed: 1337,
    fitnessWeights: defaultFitnessWeights(),
    validationWinRateThreshold: 0.8,
    validationMatchesPerBaseline: 20,
    checkpointDir: path.resolve(process.cwd(), "data", "offline-ga-checkpoints"),
    outputPath: path.resolve(process.cwd(), "best_genome.json"),
    parallelism: 4,
    baselinePressureWeight: 0.25,
  };
}

function emptyMutationStats(): MutationStats {
  return {
    mutatedGenes: 0,
    totalGenes: 0,
    averageAbsoluteDelta: 0,
    maxAbsoluteDelta: 0,
  };
}
