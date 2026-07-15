// ============================================================================
// SPEEDRUNNER ARCHETYPE
//
// Tries to end the round as fast as possible with heavy aggression.
// Tests the genome's ability to survive rushdown and punish greed.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, enemyAttacking, moveToward, pulseAttack } from "./utils";

export class SpeedrunnerAgent implements IPlayerAgent {
  readonly id = "speedrunner";
  private cooldown = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.cooldown -= dt;

    const dist = distance(engine);

    if (enemyAttacking(engine) && dist < 120 && Math.random() < 0.3) {
      // rarely trade
      pulseAttack(input, "kick");
      return input;
    }

    if (dist > 70) {
      moveToward(input, engine);
    }

    if (this.cooldown <= 0) {
      const r = Math.random();
      if (r < 0.4) pulseAttack(input, "punch");
      else if (r < 0.75) pulseAttack(input, "kick");
      else pulseAttack(input, "roundhouse");
      this.cooldown = 0.15 + Math.random() * 0.12;
    }

    return input;
  }
}
