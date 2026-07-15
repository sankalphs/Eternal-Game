// ============================================================================
// FOOTSIES ARCHETYPE
//
// Dances at optimal range, pokes, and whiff-punishes.
// Tests the genome's spacing control and patience.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, directionToEnemy, distance, enemyAttacking, moveAway, moveToward, pulseAttack } from "./utils";

export class FootsiesAgent implements IPlayerAgent {
  readonly id = "footsies";
  private whiffWindow = 0;
  private pokeCooldown = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.whiffWindow -= dt;
    this.pokeCooldown -= dt;

    const dist = distance(engine);
    const enemyAtk = enemyAttacking(engine);
    const ideal = 82;

    if (enemyAtk) {
      this.whiffWindow = 0.25;
      if (dist < 120) input.block = true;
      return input;
    }

    if (this.whiffWindow > 0 && dist < 110) {
      moveToward(input, engine);
      pulseAttack(input, "kick");
      this.whiffWindow = 0;
      return input;
    }

    if (dist > ideal + 10) {
      moveToward(input, engine);
    } else if (dist < ideal - 10) {
      moveAway(input, engine);
    } else if (this.pokeCooldown <= 0) {
      pulseAttack(input, Math.random() < 0.6 ? "punch" : "kick");
      this.pokeCooldown = 0.55 + Math.random() * 0.35;
    }

    return input;
  }
}
