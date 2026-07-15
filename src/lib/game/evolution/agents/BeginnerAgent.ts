// ============================================================================
// BEGINNER ARCHETYPE
//
// Attacks infrequently, blocks late, and walks into range predictably.
// Tests the genome's ability to capitalize on mistakes without being unfair.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, enemyAttacking, moveToward, pulseAttack } from "./utils";

export class BeginnerAgent implements IPlayerAgent {
  readonly id = "beginner";
  private cooldown = 0;
  private reaction = 0.25;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.cooldown -= dt;
    this.reaction -= dt;

    const dist = distance(engine);

    if (enemyAttacking(engine) && dist < 140 && this.reaction <= 0) {
      input.block = true;
    }

    if (dist > 90) {
      moveToward(input, engine);
    } else if (this.cooldown <= 0) {
      if (Math.random() < 0.5) pulseAttack(input, "punch");
      this.cooldown = 0.9 + Math.random() * 0.7;
      this.reaction = 0.2 + Math.random() * 0.2;
    }

    return input;
  }
}
