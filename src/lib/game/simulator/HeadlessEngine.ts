// ============================================================================
// SIMULATOR — HEADLESS ENGINE
//
// PHASE 1 of the research framework. Wraps the existing GameEngine for
// purely deterministic, headless, non-rendering execution. We never
// modify engine.ts — we adapt to it.
//
// What is disabled:
//   - Canvas / WebGL / render loop
//   - Audio engine
//   - Browser API access
//   - React lifecycle
//   - DOM / Web APIs
//
// What stays enabled:
//   - Fighter.update (physics, FSM, attack resolution)
//   - EnemyAI.update (rule-based AI)
//   - GameEngine.update (collision, damage, victory conditions)
//   - Environmental hazards (volcano / snow / temple)
//
// What we optionally drain for speed:
//   - Particles, floating texts, shockwaves (kept allocated but never
//     read by the simulator; they self-prune by lifetime)
//
// The simulator never re-implements combat logic. It reuses the engine
// exactly as it is. The only "headless" adaptation is to skip the
// per-frame VFX that the engine does, by giving it a tiny dt and
// draining VFX arrays after each step. This is fast and safe because
// the engine never reads from those arrays for the next step.
// ============================================================================

import { GameEngine, ROUND_TIME, ROUNDS_TO_WIN } from "../engine";
import { Fighter } from "../fighter";
import { EnemyAI } from "../ai";
import { OPPONENTS } from "../config/opponents";
import type { BackgroundId, OpponentDef } from "../types";
import { Rng, withDeterministicRandom } from "./Rng";
import {
  emptySideStats,
  type FightResult,
  type FightMetadata,
  type DirectorDecision,
  type RoundResult,
  type SideStats,
} from "./MatchResult";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

export interface HeadlessEngineConfig {
  /** Base opponent index (0..7) for default body stats when not given. */
  baseOpponentIndex: number;
  /** Rounds to win. */
  roundsToWin: number;
  /** Round time in seconds. */
  roundTime: number;
  /** Time step in seconds. Engine clamps to 1/30 internally. */
  timeStep: number;
  /** Drain VFX arrays every frame. */
  drainVfx: boolean;
  /** Hard cap on total fight steps (safety). */
  maxStepsPerMatch: number;
  /** Fast round transitions (skip intro pause). */
  fastRoundTransitions: boolean;
  /** Deterministic — override Math.random. */
  deterministic: boolean;
  /** Optional metadata copied into the result. */
  meta?: FightMetadata;
}

export const DEFAULT_HEADLESS_CONFIG: HeadlessEngineConfig = {
  baseOpponentIndex: 0,
  roundsToWin: ROUNDS_TO_WIN,
  roundTime: ROUND_TIME,
  timeStep: 1 / 60,
  drainVfx: true,
  maxStepsPerMatch: 60 * 90, // 90 seconds @ 60Hz
  fastRoundTransitions: true,
  deterministic: true,
};

// ----------------------------------------------------------------------------
// Side controllers — input that the headless engine feeds into the engine
// ----------------------------------------------------------------------------

/** A side controller produces input for one of the two fighters. */
export interface SideController {
  /** Stable id used in FightResult. */
  readonly id: string;
  /** Optional reset hook. */
  reset?(): void;
  /**
   * Step the controller. Returns the InputState to feed into the
   * engine this frame. dt is in seconds.
   */
  step(dt: number, engine: GameEngine): import("../types").InputState;
}

/** Wraps a rule-based EnemyAI as a side controller for either fighter slot. */
export class EnemySideController implements SideController {
  readonly id: string;
  private ai: EnemyAI;
  private side: 0 | 1;

  constructor(opponent: OpponentDef, side: 0 | 1 = 1) {
    this.side = side;
    this.id = `${side === 0 ? "player" : "enemy"}:${opponent.name}`;
    this.ai = new EnemyAI(opponent);
  }

  reset(): void {
    this.ai.reset();
  }

  step(dt: number, engine: GameEngine): import("../types").InputState {
    if (this.side === 0) {
      return this.ai.update(dt, engine.player, engine.enemy);
    }
    return this.ai.update(dt, engine.enemy, engine.player);
  }
}

/** A side that produces no input (used for student/teacher baselines). */
export class IdleSideController implements SideController {
  readonly id: string;
  constructor(id: string) { this.id = id; }
  step(): import("../types").InputState {
    return {
      left: false, right: false, up: false, down: false,
      punch: false, kick: false, roundhouse: false,
      roll: false, block: false, super: false, throw: false,
    };
  }
}

// ----------------------------------------------------------------------------
// HeadlessEngine
// ----------------------------------------------------------------------------

export class HeadlessEngine {
  readonly config: HeadlessEngineConfig;
  readonly engine: GameEngine;
  private readonly rng: Rng;
  private steps = 0;
  private elapsed = 0;
  private startWall = 0;
  private sideA: SideController;
  private sideB: SideController;
  private directorDecisions: DirectorDecision[] = [];

  // Telemetry accumulators
  private sideAStats: SideStats;
  private sideBStats: SideStats;
  private previousSideAHp: number;
  private previousSideBHp: number;
  private currentCombo: [number, number] = [0, 0];
  private distanceSamplesA: number[] = [];
  private attackSequence: string[] = [];
  private lastPlayerAttack = "";
  private playerHitCooldown = 0;
  private totalRounds: RoundResult[] = [];
  private currentRound: RoundResult | null = null;
  private currentRoundStartedAt = 0;
  private playerAttackTime = 0;
  private playerBlockTime = 0;
  private enemyAttackTime = 0;
  private enemyBlockTime = 0;

  constructor(
    sideA: SideController,
    sideB: SideController,
    opponentA: OpponentDef,
    opponentB: OpponentDef,
    seed: number,
    config?: Partial<HeadlessEngineConfig>,
  ) {
    this.config = { ...DEFAULT_HEADLESS_CONFIG, ...(config ?? {}) };
    this.rng = new Rng(seed);
    this.sideA = sideA;
    this.sideB = sideB;

    // Build the engine and immediately replace both fighters with the
    // supplied opponents. We do this without modifying engine.ts by
    // calling its public startMatch/retryMatch and then mutating the
    // enemy-side fields. Since the engine exposes them as public
    // mutable state, this is the same pattern SelfPlayRunner uses.
    this.engine = new GameEngine();
    this.engine.opponentIndex = this.config.baseOpponentIndex;
    this.engine.startMatch();
    this.engine.twoPlayer = true; // both sides scripted; bypasses live Director intro gate
    // Override both fighters with the supplied opponents
    this.replaceFighter(this.engine.player, opponentA, 360, 1);
    this.replaceFighter(this.engine.enemy, opponentB, 600, -1);
    // Build matching AIs and install them
    const aiA = new EnemyAI(opponentA);
    const aiB = new EnemyAI(opponentB);
    // Re-assign the per-side controllers to use the new AI
    if (sideA instanceof EnemySideController) {
      // The constructor already wired its own AI; we can't change the
      // id here, but we can ensure the input is what we want by
      // wrapping the call. For simplicity, when an opponent is passed
      // explicitly, the caller should pass a side controller that
      // matches. We trust the caller here.
    }
    void aiA; void aiB;
    sideA.reset?.();
    sideB.reset?.();
    this.startRound();
    this.sideAStats = emptySideStats(this.engine.player.maxHp);
    this.sideBStats = emptySideStats(this.engine.enemy.maxHp);
    this.previousSideAHp = this.engine.player.hp;
    this.previousSideBHp = this.engine.enemy.hp;
  }

  /** Force a specific background arena. */
  setBackground(bg: BackgroundId): void {
    this.engine.sceneOverride = bg;
  }

  // --------------------------------------------------------------------------
  // Run loop
  // --------------------------------------------------------------------------

  /**
   * Runs the fight to completion and returns the FightResult.
   * The function is synchronous because everything is in-process and
   * deterministic. If config.deterministic is true, Math.random is
   * overridden for the duration of the call.
   */
  run(): FightResult {
    this.startWall = Date.now();
    const runInner = () => this.runInner();
    if (this.config.deterministic) {
      return withDeterministicRandom(this.rng, runInner);
    }
    return runInner();
  }

  private runInner(): FightResult {
    const dt = this.config.timeStep;
    const maxSteps = this.config.maxStepsPerMatch;

    while (this.steps < maxSteps) {
      // 1. Compute inputs for each side
      const inputA = this.sideA.step(dt, this.engine);
      const inputB = this.sideB.step(dt, this.engine);

      // 2. Feed into the engine. GameEngine uses .input for the
      //    player; for two-player mode it also uses .p2Input.
      this.engine.input = inputA;
      this.engine.p2Input = inputB;

      // 3. Step
      this.engine.update(dt);
      this.steps += 1;
      this.elapsed += dt;

      // 4. Drain VFX (saves GC pressure; engine never reads these
      //    arrays for combat)
      if (this.config.drainVfx) this.drainVfxArrays();

      // 5. Update telemetry
      this.updateTelemetry(dt);

      // 6. Round-end handling
      if (this.engine.phase === "round_end") {
        this.captureRound();
        if (this.engine.playerWins >= this.config.roundsToWin ||
            this.engine.enemyWins >= this.config.roundsToWin) {
          break;
        }
        if (this.config.fastRoundTransitions) {
          this.startRound();
          continue;
        }
      }
      if (this.engine.phase === "match_end" ||
          this.engine.phase === "game_over" ||
          this.engine.phase === "champion") {
        break;
      }
    }

    return this.finalize();
  }

  private startRound(): void {
    // Capture per-round init
    this.playerAttackTime = 0;
    this.playerBlockTime = 0;
    this.enemyAttackTime = 0;
    this.enemyBlockTime = 0;
    this.currentRound = {
      roundIndex: this.totalRounds.length,
      winnerSide: null,
      timeout: false,
      hpFrac: [1, 1],
      durationSeconds: 0,
      damage: [0, 0],
      maxCombo: [0, 0],
    };
    this.currentRoundStartedAt = this.elapsed;
    // Engine's startRound resets fighters and clears the per-frame
    // accumulators. We use the engine's own reset path.
    this.engine.startRound();
    // Mark the side controllers as reset
    this.sideA.reset?.();
    this.sideB.reset?.();
  }

  // --------------------------------------------------------------------------
  // Telemetry
  // --------------------------------------------------------------------------

  private updateTelemetry(dt: number): void {
    const e = this.engine;
    const a = this.sideAStats;
    const b = this.sideBStats;

    // HP deltas
    const aHp = e.player.hp;
    const bHp = e.enemy.hp;
    const dA = Math.max(0, this.previousSideAHp - aHp);
    const dB = Math.max(0, this.previousSideBHp - bHp);
    if (dA > 0) {
      a.damageTaken += dA;
      b.damageDealt += dA;
      if (this.currentRound) this.currentRound.damage[1] += dA;
    }
    if (dB > 0) {
      b.damageTaken += dB;
      a.damageDealt += dB;
      if (this.currentRound) this.currentRound.damage[0] += dB;
    }
    this.previousSideAHp = aHp;
    this.previousSideBHp = bHp;

    // Hit detection (HP changed but no current combo)
    if (dB > 0.01) {
      a.hits += 1;
      this.currentCombo[0] += 1;
      if (this.currentCombo[0] > a.maxCombo) a.maxCombo = this.currentCombo[0];
    } else if (this.playerHitCooldown <= 0) {
      this.currentCombo[0] = 0;
    }
    if (dA > 0.01) {
      b.hits += 1;
      this.currentCombo[1] += 1;
      if (this.currentCombo[1] > b.maxCombo) b.maxCombo = this.currentCombo[1];
    } else if (this.playerHitCooldown <= 0) {
      this.currentCombo[1] = 0;
    }
    this.playerHitCooldown = Math.max(0, this.playerHitCooldown - dt);

    // Distance sample
    const dist = Math.abs(e.player.x - e.enemy.x);
    this.distanceSamplesA.push(dist);

    // Attack detection
    const playerAttacking = e.player.isAttacking();
    const enemyAttacking = e.enemy.isAttacking();
    if (playerAttacking) this.playerAttackTime += dt;
    if (enemyAttacking) this.enemyAttackTime += dt;
    if (e.player.state === "block") this.playerBlockTime += dt;
    if (e.enemy.state === "block") this.enemyBlockTime += dt;

    // Attack kind (basic)
    if (playerAttacking && this.lastPlayerAttack !== e.player.state) {
      this.lastPlayerAttack = e.player.state;
      this.attackSequence.push(`A:${e.player.state}`);
      a.attackKinds[e.player.state] = (a.attackKinds[e.player.state] ?? 0) + 1;
    }
    if (enemyAttacking) {
      b.attackKinds[e.enemy.state] = (b.attackKinds[e.enemy.state] ?? 0) + 1;
    }
  }

  private captureRound(): void {
    if (!this.currentRound) return;
    this.currentRound.winnerSide = this.engine.playerWins > this.engine.enemyWins ? 0 : 1;
    this.currentRound.timeout = this.engine.roundTimer <= 0;
    this.currentRound.hpFrac = [
      this.engine.player.hp / this.engine.player.maxHp,
      this.engine.enemy.hp / this.engine.enemy.maxHp,
    ];
    this.currentRound.durationSeconds = this.elapsed - this.currentRoundStartedAt;
    this.currentRound.maxCombo = [this.sideAStats.maxCombo, this.sideBStats.maxCombo];

    // Commit round-level stats
    this.sideAStats.attackTime = this.playerAttackTime;
    this.sideAStats.blockTime = this.playerBlockTime;
    this.sideBStats.attackTime = this.enemyAttackTime;
    this.sideBStats.blockTime = this.enemyBlockTime;
    if (this.currentRound.winnerSide === 0) this.sideAStats.roundsWon += 1;
    else this.sideBStats.roundsWon += 1;

    this.totalRounds.push(this.currentRound);
    this.currentRound = null;
  }

  private drainVfxArrays(): void {
    const e = this.engine as unknown as { particles?: unknown[]; texts?: unknown[]; shockwaves?: unknown[] };
    if (e.particles && e.particles.length > 0) e.particles.length = 0;
    if (e.texts && e.texts.length > 0) e.texts.length = 0;
    if (e.shockwaves && e.shockwaves.length > 0) e.shockwaves.length = 0;
  }

  private finalize(): FightResult {
    const e = this.engine;
    let winnerSide: 0 | 1 | null = null;
    if (e.playerWins > e.enemyWins) winnerSide = 0;
    else if (e.enemyWins > e.playerWins) winnerSide = 1;
    // If we exited due to step cap, project the current round
    if (winnerSide === null && e.playerWins === e.enemyWins) {
      const a = e.player.hp / e.player.maxHp;
      const b = e.enemy.hp / e.enemy.maxHp;
      if (a > b) winnerSide = 0;
      else if (b > a) winnerSide = 1;
    }

    this.sideAStats.hpFrac = e.player.hp / e.player.maxHp;
    this.sideBStats.hpFrac = e.enemy.hp / e.enemy.maxHp;
    this.sideAStats.maxCombo = this.sideAStats.maxCombo;
    this.sideBStats.maxCombo = this.sideBStats.maxCombo;
    // Combo totals
    let totalCombosA = 0;
    for (const k of Object.keys(this.sideAStats.comboHistogram)) totalCombosA += this.sideAStats.comboHistogram[+k]!;
    this.sideAStats.totalCombos = totalCombosA;
    let totalCombosB = 0;
    for (const k of Object.keys(this.sideBStats.comboHistogram)) totalCombosB += this.sideBStats.comboHistogram[+k]!;
    this.sideBStats.totalCombos = totalCombosB;
    // Distance stats
    if (this.distanceSamplesA.length > 0) {
      const mean = this.distanceSamplesA.reduce((a, b) => a + b, 0) / this.distanceSamplesA.length;
      const variance = this.distanceSamplesA.reduce((s, v) => s + (v - mean) ** 2, 0) / this.distanceSamplesA.length;
      this.sideAStats.distanceMean = mean;
      this.sideAStats.distanceStdDev = Math.sqrt(variance);
      this.sideBStats.distanceMean = mean;
      this.sideBStats.distanceStdDev = Math.sqrt(variance);
    }

    const wallMs = Date.now() - this.startWall;
    return {
      id: `fight_${this.rng.getState().toString(36)}_${Date.now().toString(36)}`,
      seed: this.rng.getState(),
      matchType: this.config.meta?.matchType ?? ("ga_vs_archetype" as const),
      sideAId: this.sideA.id,
      sideBId: this.sideB.id,
      winnerSide,
      sideA: this.sideAStats,
      sideB: this.sideBStats,
      rounds: this.totalRounds,
      durationSeconds: this.elapsed,
      timedOut: this.totalRounds.some(r => r.timeout),
      meta: this.config.meta ?? {},
      directorDecisions: this.directorDecisions,
    };
  }

  // --------------------------------------------------------------------------
  // Director hook — record decisions made during the fight
  // --------------------------------------------------------------------------

  /** Record a director decision (called by external orchestrators). */
  recordDirectorDecision(decision: DirectorDecision): void {
    this.directorDecisions.push(decision);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Replace the body stats of an existing fighter. The engine exposes
   * `player` and `enemy` as public mutable fields, and Fighter has a
   * `reset` method — this is the same pattern `applyOpponentDefToEngine`
   * uses in the evolution module.
   */
  private replaceFighter(f: Fighter, opp: OpponentDef, x: number, facing: 1 | -1): void {
    f.x = x;
    f.facing = facing;
    f.maxHp = opp.hp;
    f.hp = opp.hp;
    f.damageMul = opp.damageMul;
    f.speedMul = opp.speedMul;
    f.rim = opp.rim;
    f.name = opp.name;
    f.bodyType = opp.bodyType ?? "lean";
  }
}

// ----------------------------------------------------------------------------
// Convenience: build a default opponent list
// ----------------------------------------------------------------------------

/** Returns the default opponent by index. */
export function defaultOpponent(index: number): OpponentDef {
  return OPPONENTS[index] ?? OPPONENTS[0]!;
}

/** Returns the full default opponent roster. */
export function defaultOpponents(): OpponentDef[] {
  return [...OPPONENTS];
}
