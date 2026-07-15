// ============================================================================
// AGGRESSIVE ARCHETYPE
//
// Rushes in and attacks constantly. Tests the genome's defensive reactions,
// blocking, anti-air, and spacing control under pressure.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, enemyAttacking, moveToward, pulseAttack } from "./utils";

export class AggressiveAgent implements IPlayerAgent {
  readonly id = "aggressive";
  private cooldown = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.cooldown -= dt;

    const dist = distance(engine);
    const enemyAtk = enemyAttacking(engine);

    if (enemyAtk && dist < 120 && Math.random() < 0.25) {
      // occasionally gamble on a trade instead of blocking
      pulseAttack(input, Math.random() < 0.5 ? "punch" : "kick");
      return input;
    }

    if (dist > 70) {
      moveToward(input, engine);
      if (this.cooldown <= 0 && Math.random() < 0.6) {
        pulseAttack(input, "kick");
        this.cooldown = 0.25;
      }
    } else {
      if (this.cooldown <= 0) {
        const r = Math.random();
        if (r < 0.5) pulseAttack(input, "punch");
        else if (r < 0.85) pulseAttack(input, "kick");
        else pulseAttack(input, "roundhouse");
        this.cooldown = 0.18 + Math.random() * 0.12;
      }
    }

    return input;
  }
}
