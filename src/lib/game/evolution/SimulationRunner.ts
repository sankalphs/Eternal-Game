// ============================================================================
// SIMULATION RUNNER
//
// Instantiates the existing GameEngine, replaces the EnemyAI parameters with
// a genome-derived OpponentDef, and runs a match against a scripted player
// agent. The Fighting FSM, physics, renderer, and animation are untouched.
// ============================================================================

import { Fighter } from "../fighter";
import { EnemyAI } from "../ai";
import { GameEngine, ROUND_TIME, ROUNDS_TO_WIN } from "../engine";
import type { OpponentDef } from "../types";
import type { IGenome, IMatchMetrics, IPlayerAgent, IRoundMetrics, ISimulationConfig } from "./types";
import { genomeToOpponentDef } from "./GenomeSerializer";

class SeededRandom {
  private s = 0;

  constructor(seed: number) {
    this.s = seed >>> 0;
    if (this.s === 0) this.s = 1;
  }

  next(): number {
    // xorshift32 — fast, decent quality, deterministic
    this.s ^= this.s << 13;
    this.s ^= this.s >>> 17;
    this.s ^= this.s << 5;
    return (this.s >>> 0) / 4294967296;
  }
}

/** Replaces Math.random within the callback and restores it afterwards. */
function withDeterministicRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  const rng = new SeededRandom(seed);
  // @ts-expect-error intentional global override for deterministic simulation
  Math.random = () => rng.next();
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

export class SimulationRunner {
  constructor(private config: ISimulationConfig) {}

  /**
   * Evaluates one genome against one scripted player agent.
   * Returns detailed match metrics.
   */
  runMatch(genome: IGenome, agent: IPlayerAgent, matchSeed: number): IMatchMetrics {
    if (this.config.deterministic) {
      return withDeterministicRandom(matchSeed, () => this.runMatchInternal(genome, agent));
    }
    return this.runMatchInternal(genome, agent);
  }

  private runMatchInternal(genome: IGenome, agent: IPlayerAgent): IMatchMetrics {
    const engine = this.buildEngine(genome);
    const metrics = this.createEmptyMetrics(agent.id);

    const distanceSamples: number[] = [];
    const attackSequence: string[] = [];
    const comboCounts: Record<number, number> = {};
    const attackKindCounts: Record<string, number> = {};

    let previousPlayerHp = engine.player.hp;
    let previousEnemyHp = engine.enemy.hp;
    let playerHitCooldown = 0;
    let enemyHitCooldown = 0;
    let elapsed = 0;
    let step = 0;
    let currentCombo = 0;
    let lastAttackKind: string | null = null;
    let consecutiveSameMove = 0;

    const maxSteps = Math.ceil(this.config.maxDurationSeconds / this.config.timeStep);

    while (step < maxSteps) {
      const dt = this.config.timeStep;

      // Drive the player side with the scripted agent.
      engine.input = agent.update(dt, engine);

      engine.update(dt);
      elapsed += dt;
      step++;

      // ---- collect per-frame metrics ----
      const dist = Math.abs(engine.player.x - engine.enemy.x);
      distanceSamples.push(dist);

      if (engine.player.isBlocking()) metrics.playerBlockTime += dt;
      if (engine.enemy.isBlocking()) metrics.genomeBlockTime += dt;
      if (engine.player.isAttacking()) metrics.playerAttackTime += dt;

      const enemyAttack = engine.enemy.isAttacking();
      if (enemyAttack) {
        metrics.genomeAttackTime += dt;
        const kind = engine.enemy.currentAttack ?? "none";
        attackKindCounts[kind] = (attackKindCounts[kind] ?? 0) + dt;

        // Track attack sequence for unpredictability / repeated-move analysis.
        if (kind !== "none" && kind !== lastAttackKind) {
          attackSequence.push(kind);
          lastAttackKind = kind;
          consecutiveSameMove = 0;
        } else if (kind !== "none") {
          consecutiveSameMove++;
        }

        // Approximate combo counting: consecutive enemy attack frames.
        currentCombo++;
      } else {
        if (currentCombo > 0) {
          const comboLength = Math.max(1, Math.round(currentCombo * dt * 8)); // rough hits
          comboCounts[comboLength] = (comboCounts[comboLength] ?? 0) + 1;
          metrics.genomeMaxCombo = Math.max(metrics.genomeMaxCombo, comboLength);
          currentCombo = 0;
        }
      }

      // ---- hit detection via HP drops (with cooldown) ----
      playerHitCooldown -= dt;
      enemyHitCooldown -= dt;

      if (engine.player.hp < previousPlayerHp && playerHitCooldown <= 0) {
        metrics.genomeHits++;
        metrics.genomeDamageDealt += previousPlayerHp - engine.player.hp;
        playerHitCooldown = 0.18;
      }
      if (engine.enemy.hp < previousEnemyHp && enemyHitCooldown <= 0) {
        metrics.playerHits++;
        metrics.playerDamageDealt += previousEnemyHp - engine.enemy.hp;
        enemyHitCooldown = 0.18;
      }
      previousPlayerHp = engine.player.hp;
      previousEnemyHp = engine.enemy.hp;

      // ---- fast round transitions ----
      if (this.config.fastRoundTransitions && engine.phase === "round_end") {
        metrics.rounds.push(this.captureRound(engine, elapsed));

        if (engine.playerWins >= this.config.roundsToWin || engine.enemyWins >= this.config.roundsToWin) {
          break;
        }
        engine.startRound();
        continue;
      }

      // ---- terminal conditions ----
      if (
        engine.phase === "match_end" ||
        engine.phase === "game_over" ||
        engine.phase === "champion"
      ) {
        break;
      }

      if (elapsed >= ROUND_TIME * this.config.roundsToWin + 5) {
        metrics.timeout = true;
        break;
      }
    }

    // ---- finalize metrics ----
    metrics.durationSeconds = elapsed;

    if (engine.phase === "match_end" || engine.phase === "champion") {
      metrics.genomeWon = engine.enemyWins >= engine.playerWins;
    } else if (engine.phase === "game_over") {
      metrics.genomeWon = false;
    } else {
      // Simulation stopped due to timeout/step limit: project the current round.
      const currentRoundEnemyWon = engine.enemy.hp >= engine.player.hp;
      const enemyTotal = engine.enemyWins + (currentRoundEnemyWon ? 1 : 0);
      const playerTotal = engine.playerWins + (currentRoundEnemyWon ? 0 : 1);
      metrics.genomeWon = enemyTotal >= playerTotal;
    }

    metrics.genomeRoundsWon = engine.enemyWins;
    metrics.playerRoundsWon = engine.playerWins;
    metrics.genomeMaxHp = engine.enemy.maxHp;
    metrics.playerMaxHp = engine.player.maxHp;
    metrics.genomeHpFrac = engine.enemy.hp / engine.enemy.maxHp;
    metrics.playerHpFrac = engine.player.hp / engine.player.maxHp;
    metrics.distanceSamples = distanceSamples;
    metrics.distanceStdDev = standardDeviation(distanceSamples);
    metrics.genomeAttackKindsUsed = Object.keys(attackKindCounts).filter((k) => k !== "none").length;
    metrics.genomeAttackSequence = attackSequence;
    metrics.genomeAttackKindCounts = attackKindCounts;
    metrics.genomeComboCounts = comboCounts;
    metrics.timeout = metrics.timeout || elapsed >= this.config.maxDurationSeconds - 0.1;
    metrics.playerMaxCombo = engine.maxCombo;

    return metrics;
  }

  private captureRound(engine: GameEngine, elapsedSeconds: number): IRoundMetrics {
    return {
      roundIndex: engine.roundNo - 1,
      genomeWon: engine.enemy.hp <= 0 ? false : engine.player.hp <= 0 ? true : engine.enemy.hp >= engine.player.hp,
      genomeHpFrac: engine.enemy.hp / engine.enemy.maxHp,
      playerHpFrac: engine.player.hp / engine.player.maxHp,
      durationSeconds: elapsedSeconds,
      timeout: engine.player.hp > 0 && engine.enemy.hp > 0,
    };
  }

  /** Builds a GameEngine with the genome AI applied to the enemy side. */
  private buildEngine(genome: IGenome): GameEngine {
    const def = genomeToOpponentDef(genome, this.config.baseOpponent);
    const engine = new GameEngine();

    // Apply the genome-derived opponent definition without touching engine.ts.
    engine.ai = new EnemyAI(def);
    engine.enemy = this.makeEnemyFromDef(def);
    engine.twoPlayer = false;
    engine.sceneOverride = this.config.background ?? def.bg;
    engine.playerWins = 0;
    engine.enemyWins = 0;
    engine.roundNo = 1;
    engine.startRound();

    return engine;
  }

  private makeEnemyFromDef(def: OpponentDef): Fighter {
    return new Fighter({
      x: 600,
      isPlayer: false,
      facing: -1,
      maxHp: def.hp,
      rim: def.rim,
      name: def.name,
      damageMul: def.damageMul,
      speedMul: def.speedMul,
      blade: def.blade,
      bodyType: def.bodyType,
    });
  }

  private createEmptyMetrics(archetypeId: string): IMatchMetrics {
    return {
      archetypeId,
      genomeWon: false,
      genomeRoundsWon: 0,
      playerRoundsWon: 0,
      rounds: [],
      genomeHpFrac: 0,
      playerHpFrac: 0,
      genomeMaxHp: 0,
      playerMaxHp: 0,
      durationSeconds: 0,
      timeout: false,
      genomeHits: 0,
      playerHits: 0,
      genomeMaxCombo: 0,
      playerMaxCombo: 0,
      genomeBlockTime: 0,
      playerBlockTime: 0,
      genomeAttackTime: 0,
      playerAttackTime: 0,
      distanceSamples: [],
      distanceStdDev: 0,
      genomeAttackKindsUsed: 0,
      genomeAttackSequence: [],
      genomeAttackKindCounts: {},
      genomeComboCounts: {},
      genomeDamageDealt: 0,
      playerDamageDealt: 0,
    };
  }

  setConfig(config: ISimulationConfig): void {
    this.config = config;
  }

  getConfig(): ISimulationConfig {
    return { ...this.config };
  }

  static defaultConfig(baseOpponent: OpponentDef): ISimulationConfig {
    return {
      timeStep: 1 / 60,
      maxDurationSeconds: 180,
      roundsToWin: ROUNDS_TO_WIN,
      fastRoundTransitions: true,
      deterministic: true,
      seedBase: 42,
      background: "sunset",
      baseOpponent,
    };
  }
}

function standardDeviation(samples: number[]): number {
  if (samples.length < 2) return 0;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((acc, v) => acc + (v - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance);
}
