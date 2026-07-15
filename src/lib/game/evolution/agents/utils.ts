// ============================================================================
// SCRIPTED AGENT UTILITIES
//
// Shared helpers for building deterministic player archetypes.
// Agents produce InputState objects that drive the player fighter.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { InputState } from "../../types";

export const EMPTY_INPUT: InputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  punch: false,
  kick: false,
  roundhouse: false,
  roll: false,
  block: false,
  super: false,
  throw: false,
};

export function clearInput(): InputState {
  return { ...EMPTY_INPUT };
}

/** Returns +1 if player is to the left of the enemy, -1 if to the right. */
export function directionToEnemy(engine: GameEngine): 1 | -1 {
  return engine.enemy.x >= engine.player.x ? 1 : -1;
}

/** Absolute distance between fighters. */
export function distance(engine: GameEngine): number {
  return Math.abs(engine.enemy.x - engine.player.x);
}

/** True if the enemy (genome AI) is currently attacking. */
export function enemyAttacking(engine: GameEngine): boolean {
  return engine.enemy.isAttacking();
}

/** True if the player can act (not in hitstun, knockdown, roll, etc.). */
export function playerCanAct(engine: GameEngine): boolean {
  return engine.player.canAct();
}

/** Releases an attack button on the frame after it was pressed (edge trigger). */
export function pulseAttack(input: InputState, key: "punch" | "kick" | "roundhouse" | "super"): InputState {
  input[key] = true;
  return input;
}

/** Moves toward the enemy. */
export function moveToward(input: InputState, engine: GameEngine): InputState {
  const dir = directionToEnemy(engine);
  input.right = dir === 1;
  input.left = dir === -1;
  return input;
}

/** Moves away from the enemy. */
export function moveAway(input: InputState, engine: GameEngine): InputState {
  const dir = directionToEnemy(engine);
  input.left = dir === 1;
  input.right = dir === -1;
  return input;
}
