// ============================================================================
// COMBO ARCHETYPE
//
// Strings light attacks into pressure sequences.
// Tests the genome's block-release counters, interrupts, and escape options.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, enemyAttacking, moveToward, pulseAttack } from "./utils";

export class ComboAgent implements IPlayerAgent {
  readonly id = "combo";
  private chainLeft = 0;
  private chainCooldown = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.chainCooldown -= dt;

    const dist = distance(engine);

    if (this.chainLeft > 0 && dist < 80) {
      pulseAttack(input, this.chainLeft % 2 === 0 ? "punch" : "kick");
      this.chainLeft--;
      this.chainCooldown = 0.14;
      return input;
    }

    if (enemyAttacking(engine) && dist < 130) {
      input.block = true;
      return input;
    }

    if (dist > 75) {
      moveToward(input, engine);
    } else if (this.chainCooldown <= 0) {
      this.chainLeft = 2 + Math.floor(Math.random() * 3);
    }

    return input;
  }
}
