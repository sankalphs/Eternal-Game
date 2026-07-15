// ============================================================================
// ROLL-SPAM ARCHETYPE
//
// Spams dodge-rolls to test the genome's tracking, whiff-punish, and patience.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, directionToEnemy, distance, enemyAttacking, moveToward, pulseAttack } from "./utils";

export class RollSpamAgent implements IPlayerAgent {
  readonly id = "roll_spam";
  private rollCooldown = 0;
  private attackCooldown = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.rollCooldown -= dt;
    this.attackCooldown -= dt;

    const dist = distance(engine);
    const dir = directionToEnemy(engine);

    if (enemyAttacking(engine) && dist < 130 && this.rollCooldown <= 0) {
      input.roll = true;
      input.right = dir === -1; // roll through
      input.left = dir === 1;
      this.rollCooldown = 0.8;
      return input;
    }

    if (this.rollCooldown <= 0 && Math.random() < 0.35) {
      input.roll = true;
      input.right = Math.random() < 0.5;
      input.left = !input.right;
      this.rollCooldown = 0.7;
      return input;
    }

    if (dist > 80) {
      moveToward(input, engine);
    } else if (this.attackCooldown <= 0) {
      pulseAttack(input, Math.random() < 0.5 ? "punch" : "kick");
      this.attackCooldown = 0.35;
    }

    return input;
  }
}
