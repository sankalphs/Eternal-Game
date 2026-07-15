// ============================================================================
// DEFENSIVE ARCHETYPE
//
// Holds block, retreats under pressure, and only punishes obvious whiffs.
// Tests the genome's ability to open up a turtle and avoid timeouts.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, enemyAttacking, moveAway, moveToward, pulseAttack } from "./utils";

export class DefensiveAgent implements IPlayerAgent {
  readonly id = "defensive";
  private blockTimer = 0;
  private whiffWindow = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.blockTimer -= dt;
    this.whiffWindow -= dt;

    const dist = distance(engine);
    const enemyAtk = enemyAttacking(engine);
    const enemyJustFinished = this.whiffWindow > 0 && !enemyAtk;

    if (enemyAtk && dist < 140) {
      input.block = true;
      this.blockTimer = 0.25;
    } else if (this.blockTimer > 0) {
      input.block = true;
    }

    if (enemyJustFinished && dist < 100) {
      moveToward(input, engine);
      pulseAttack(input, Math.random() < 0.6 ? "kick" : "punch");
      this.whiffWindow = 0;
      return input;
    }

    if (dist < 60 && !enemyAtk) {
      moveAway(input, engine);
      input.block = true;
    }

    if (enemyAtk) {
      this.whiffWindow = 0.22;
    }

    return input;
  }
}
