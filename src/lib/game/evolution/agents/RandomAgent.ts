// ============================================================================
// RANDOM ARCHETYPE
//
// Presses random buttons. Useful as a chaos baseline.
// ============================================================================

import type { GameEngine } from "../../engine";
import type { IPlayerAgent } from "../types";
import { clearInput, directionToEnemy } from "./utils";

export class RandomAgent implements IPlayerAgent {
  readonly id = "random";
  private changeTimer = 0;
  private state = {
    left: false,
    right: false,
    up: false,
    down: false,
    punch: false,
    kick: false,
    roundhouse: false,
    roll: false,
    block: false,
    super: false,
    throw: false,
  };

  update(dt: number, engine: GameEngine) {
    this.changeTimer -= dt;

    if (this.changeTimer <= 0) {
      this.state = clearInput();
      const r = Math.random();
      if (r < 0.25) {
        const dir = directionToEnemy(engine);
        this.state.right = dir === 1;
        this.state.left = dir === -1;
      } else if (r < 0.4) {
        const dir = directionToEnemy(engine);
        this.state.left = dir === 1;
        this.state.right = dir === -1;
      } else if (r < 0.55) {
        this.state.block = true;
      } else if (r < 0.7) {
        this.state.punch = true;
      } else if (r < 0.82) {
        this.state.kick = true;
      } else if (r < 0.9) {
        this.state.roundhouse = true;
      } else if (r < 0.96) {
        this.state.roll = true;
      } else {
        this.state.super = true;
      }
      this.changeTimer = 0.12 + Math.random() * 0.2;
    }

    return { ...this.state };
  }
}
