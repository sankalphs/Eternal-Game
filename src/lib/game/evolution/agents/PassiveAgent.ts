// ============================================================================
// PASSIVE ARCHETYPE
//
// Avoids engagement, backs away, and only throws rare pokes.
// Tests the genome's ability to close space and force action without timeouts.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, enemyAttacking, moveAway, moveToward, pulseAttack } from "./utils";

export class PassiveAgent implements IPlayerAgent {
  readonly id = "passive";
  private pokeCooldown = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.pokeCooldown -= dt;

    const dist = distance(engine);

    if (enemyAttacking(engine) && dist < 140) {
      moveAway(input, engine);
      input.block = true;
      return input;
    }

    if (dist < 100) {
      moveAway(input, engine);
      if (this.pokeCooldown <= 0 && dist < 75 && Math.random() < 0.2) {
        pulseAttack(input, "punch");
        this.pokeCooldown = 1.0;
      }
    } else if (dist > 160) {
      moveToward(input, engine);
    }

    return input;
  }
}
