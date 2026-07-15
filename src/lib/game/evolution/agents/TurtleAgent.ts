// ============================================================================
// TURTLE ARCHETYPE
//
// Holds block forever and only punishes extreme whiffs.
// Tests the genome's ability to open up a pure turtle without timing out.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, enemyAttacking, moveAway, moveToward, pulseAttack } from "./utils";

export class TurtleAgent implements IPlayerAgent {
  readonly id = "turtle";
  private whiffWindow = 0;
  private blockTimer = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.whiffWindow -= dt;
    this.blockTimer -= dt;

    const dist = distance(engine);
    const enemyAtk = enemyAttacking(engine);

    if (enemyAtk) {
      this.whiffWindow = 0.28;
      if (dist < 150) {
        input.block = true;
        this.blockTimer = 0.35;
      }
    } else if (this.blockTimer > 0) {
      input.block = true;
    }

    if (this.whiffWindow > 0 && !enemyAtk && dist < 90) {
      moveToward(input, engine);
      pulseAttack(input, Math.random() < 0.7 ? "kick" : "roundhouse");
      this.whiffWindow = 0;
      return input;
    }

    if (dist < 70) {
      moveAway(input, engine);
      input.block = true;
    }

    return input;
  }
}
