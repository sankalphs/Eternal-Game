// ============================================================================
// COUNTER ARCHETYPE
//
// Waits for the genome to whiff or overextend, then punishes.
// Tests the genome's pressure, mixup, and safety on block.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, enemyAttacking, moveToward, pulseAttack } from "./utils";

export class CounterAgent implements IPlayerAgent {
  readonly id = "counter";
  private whiffWindow = 0;
  private backstepTimer = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.whiffWindow -= dt;
    this.backstepTimer -= dt;

    const dist = distance(engine);
    const enemyAtk = enemyAttacking(engine);

    if (enemyAtk) {
      this.whiffWindow = 0.25;
      if (dist < 130) {
        // bait with block/retreat
        input.block = true;
      } else {
        // stay just outside range
        if (engine.enemy.x > engine.player.x) input.left = true;
        else input.right = true;
      }
      return input;
    }

    if (this.whiffWindow > 0 && dist < 110) {
      moveToward(input, engine);
      pulseAttack(input, Math.random() < 0.7 ? "kick" : "roundhouse");
      this.whiffWindow = 0;
      return input;
    }

    if (dist < 90 && this.backstepTimer <= 0) {
      if (engine.enemy.x > engine.player.x) input.left = true;
      else input.right = true;
      this.backstepTimer = 0.35;
      return input;
    }

    if (dist > 110) {
      moveToward(input, engine);
    }

    return input;
  }
}
