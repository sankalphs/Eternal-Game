// ============================================================================
// WHIFF PUNISHER ARCHETYPE
//
// Stays just outside range and dashes in only after the genome whiffs.
// Tests the genome's attack safety and recovery awareness.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, directionToEnemy, distance, enemyAttacking, moveToward, pulseAttack } from "./utils";

export class WhiffPunisherAgent implements IPlayerAgent {
  readonly id = "whiff_punisher";
  private whiffWindow = 0;
  private retreatTimer = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.whiffWindow -= dt;
    this.retreatTimer -= dt;

    const dist = distance(engine);
    const enemyAtk = enemyAttacking(engine);
    const dir = directionToEnemy(engine);

    if (enemyAtk) {
      this.whiffWindow = 0.28;
      // stay just outside while opponent attacks
      if (dist < 130) {
        input.left = dir === 1;
        input.right = dir === -1;
      }
      return input;
    }

    if (this.whiffWindow > 0 && dist < 120) {
      moveToward(input, engine);
      pulseAttack(input, Math.random() < 0.6 ? "roundhouse" : "kick");
      this.whiffWindow = 0;
      this.retreatTimer = 0.4;
      return input;
    }

    if (this.retreatTimer > 0) {
      input.left = dir === 1;
      input.right = dir === -1;
      return input;
    }

    if (dist > 120) {
      moveToward(input, engine);
    }

    return input;
  }
}
