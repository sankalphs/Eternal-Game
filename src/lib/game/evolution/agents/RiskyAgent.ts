// ============================================================================
// RISKY ARCHETYPE
//
// Never blocks, always trades, throws roundhouses and supers.
// Tests the genome's ability to punish greed and survive burst damage.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, distance, moveToward, pulseAttack } from "./utils";

export class RiskyAgent implements IPlayerAgent {
  readonly id = "risky";
  private cooldown = 0;

  update(dt: number, engine: GameEngine) {
    const input = clearInput();
    this.cooldown -= dt;

    const dist = distance(engine);

    if (dist > 90) {
      moveToward(input, engine);
    }

    if (this.cooldown <= 0) {
      const r = Math.random();
      if (engine.player.rageMeter >= engine.player.RAGE_MAX && r < 0.3) {
        pulseAttack(input, "super");
      } else if (r < 0.5) {
        pulseAttack(input, "roundhouse");
      } else if (r < 0.85) {
        pulseAttack(input, "kick");
      } else {
        pulseAttack(input, "punch");
      }
      this.cooldown = 0.35 + Math.random() * 0.25;
    }

    return input;
  }
}
