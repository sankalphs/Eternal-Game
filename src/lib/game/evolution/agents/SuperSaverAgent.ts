// ============================================================================
// SUPER SAVER ARCHETYPE
//
// Builds rage and only uses super when full or at a critical moment.
// Tests the genome's ability to avoid the super punish and manage rage.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, enemyAttacking, moveToward, pulseAttack } from "./utils";

export class SuperSaverAgent implements IPlayerAgent {
  readonly id = "super_saver";
  private cooldown = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.cooldown -= dt;

    const dist = distance(engine);
    const rageFull = engine.player.rageMeter >= engine.player.RAGE_MAX;

    if (rageFull && dist < 90) {
      pulseAttack(input, "super");
      return input;
    }

    if (enemyAttacking(engine) && dist < 130) {
      input.block = true;
      return input;
    }

    if (dist > 75) {
      moveToward(input, engine);
    } else if (this.cooldown <= 0) {
      pulseAttack(input, Math.random() < 0.6 ? "punch" : "kick");
      this.cooldown = 0.4 + Math.random() * 0.3;
    }

    return input;
  }
}
