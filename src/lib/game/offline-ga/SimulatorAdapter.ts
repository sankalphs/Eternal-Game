import { OPPONENTS } from "../config/opponents";
import type { OpponentDef } from "../types";
import { SimulationRunner } from "../simulator/SimulationRunner";
import type { FightResult } from "../simulator/MatchResult";
import type { BaselineOpponent, OfflineGenome } from "./types";

export interface FightingSimulator {
  fightGenomeVsGenome(params: { genomeA: OfflineGenome; genomeB: OfflineGenome; seed: number }): FightResult;
  fightGenomeVsBaseline(params: { genome: OfflineGenome; baseline: BaselineOpponent; seed: number }): FightResult;
}

export class HeadlessFightingSimulatorAdapter implements FightingSimulator {
  private runner = new SimulationRunner();

  constructor(private baseOpponent: OpponentDef = OPPONENTS[OPPONENTS.length - 1]!) {}

  fightGenomeVsGenome(params: { genomeA: OfflineGenome; genomeB: OfflineGenome; seed: number }): FightResult {
    return this.runner.runFight({
      sideA: this.toOpponentDef(params.genomeA),
      sideB: this.toOpponentDef(params.genomeB),
      seed: params.seed,
      matchType: "ga_vs_ga",
      config: { deterministic: true, fastRoundTransitions: true, drainVfx: true },
      meta: {
        subjectId: params.genomeA.id,
        genomeIds: [params.genomeA.id, params.genomeB.id],
      },
    });
  }

  fightGenomeVsBaseline(params: { genome: OfflineGenome; baseline: BaselineOpponent; seed: number }): FightResult {
    return this.runner.runFight({
      sideA: this.toOpponentDef(params.genome),
      sideB: params.baseline.opponent,
      seed: params.seed,
      matchType: "student_vs_baseline",
      config: { deterministic: true, fastRoundTransitions: true, drainVfx: true },
      meta: {
        subjectId: params.genome.id,
        genomeId: params.genome.id,
        baseOpponent: params.baseline.opponent.name,
        baselineId: params.baseline.id,
      },
    });
  }

  toOpponentDef(genome: OfflineGenome): OpponentDef {
    const g = genome.genes;
    const defensiveBlend = clamp01(g.defensePriority * 0.55 + g.blockFrequency * 0.35 + (1 - g.riskTolerance) * 0.1);
    const closeRange = 1 - g.distancePreference;
    const pressure = clamp01(g.aggression * 0.45 + g.comboContinuationThreshold * 0.35 + g.riskTolerance * 0.2);
    const mixup = clamp01(g.distancePreference * 0.3 + g.jumpFrequency * 0.25 + g.projectileUsage * 0.2 + g.ultimateUsageThreshold * 0.25);

    return {
      ...this.baseOpponent,
      name: `OfflineGA:${genome.id}`,
      title: "Frozen Evolved Agent",
      aggression: clamp01(g.aggression * 0.65 + g.riskTolerance * 0.25 + closeRange * 0.1),
      blockChance: defensiveBlend,
      reaction: 0.8 - clamp01(g.counterAttackTendency * 0.45 + g.punishWindow * 0.35 + g.defensePriority * 0.2) * 0.75,
      combo: Math.max(1, Math.round(1 + g.comboContinuationThreshold * 5)),
      whiffPunish: clamp01(g.punishWindow * 0.6 + g.counterAttackTendency * 0.4),
      antiAir: clamp01(g.jumpFrequency * 0.55 + g.counterAttackTendency * 0.25 + g.defensePriority * 0.2),
      pressure,
      mixup,
      adaptive: clamp01(g.counterAttackTendency * 0.4 + g.defensePriority * 0.25 + g.distancePreference * 0.2 + g.projectileUsage * 0.15),
      rage: clamp01(g.riskTolerance * 0.65 + g.aggression * 0.35),
      perfection: clamp01(g.defensePriority * 0.45 + g.blockFrequency * 0.35 + (1 - g.ultimateUsageThreshold) * 0.2),
      readDelay: clamp01(1 - g.counterAttackTendency) * 0.3,
    };
  }

  getBaseOpponent(): OpponentDef {
    return this.baseOpponent;
  }
}

export function defaultBaselineOpponents(): BaselineOpponent[] {
  return OPPONENTS.map((opponent, index) => ({
    id: baselineId(opponent.name, index),
    opponent,
  }));
}

function baselineId(name: string, index: number): string {
  return `${index}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
