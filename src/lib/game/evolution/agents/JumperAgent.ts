// ============================================================================
// JUMPER ARCHETYPE
//
// Jumps frequently and attacks from the air.
// Tests the genome's anti-air, spacing, and ground-control responses.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, directionToEnemy, distance, enemyAttacking, moveToward, pulseAttack } from "./utils";

export class JumperAgent implements IPlayerAgent {
  readonly id = "jumper";
  private jumpCooldown = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.jumpCooldown -= dt;

    const dist = distance(engine);
    const onGround = engine.player.onGround;

    if (enemyAttacking(engine) && dist < 130 && onGround) {
      // jump over low attacks
      if (this.jumpCooldown <= 0) {
        input.up = true;
        this.jumpCooldown = 0.7;
      }
      return input;
    }

    if (onGround && dist > 120 && this.jumpCooldown <= 0) {
      input.up = true;
      if (Math.random() < 0.6) {
        const dir = directionToEnemy(engine);
        input.right = dir === 1;
        input.left = dir === -1;
      }
      this.jumpCooldown = 0.9;
      return input;
    }

    if (!onGround && dist < 100) {
      pulseAttack(input, Math.random() < 0.5 ? "kick" : "punch");
    }

    if (onGround && dist > 80) {
      moveToward(input, engine);
    }

    return input;
  }
}
