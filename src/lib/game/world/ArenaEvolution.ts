// ============================================================================
// EVOLVING ARENAS — multi-stage arena evolution driven by WorldState.
//
// Each arena has 5 damage stages (0=pristine → 5=ruins). The stage is
// determined by arenaDamage[arenaId] in the WorldState. The render system
// uses this to tint, crack, and weather the arena visually.
// ============================================================================

import type { BackgroundId } from "../types";
import type { WorldState } from "./WorldState";

export type ArenaStage = 0 | 1 | 2 | 3 | 4 | 5;

export interface ArenaEvolutionConfig {
  // Per-stage visual overrides applied on top of the base ArenaConfig
  stages: {
    overlayColor: string;       // tint applied to the whole scene
    overlayOpacity: number;
    crackCount: number;         // number of crack lines in the ground
    debrisCount: number;        // number of debris sprites
    fireCount: number;          // number of fire/smoke sources
    fogIntensity: number;       // 0..1 extra fog
    silhouetteShatter: number;  // 0..1 how broken the background ridge is
  }[];
}

// Universal 5-stage evolution template. Each arena uses the same visual
// progression (pristine → cracked → broken → burning → ash → ruins).
const UNIVERSAL_STAGES: ArenaEvolutionConfig = {
  stages: [
    // Stage 0: Pristine
    { overlayColor: "#000000", overlayOpacity: 0, crackCount: 0, debrisCount: 0, fireCount: 0, fogIntensity: 0, silhouetteShatter: 0 },
    // Stage 1: Cracked
    { overlayColor: "#1a1a1a", overlayOpacity: 0.05, crackCount: 2, debrisCount: 1, fireCount: 0, fogIntensity: 0.05, silhouetteShatter: 0.1 },
    // Stage 2: Broken
    { overlayColor: "#2a1a1a", overlayOpacity: 0.1, crackCount: 5, debrisCount: 3, fireCount: 1, fogIntensity: 0.1, silhouetteShatter: 0.3 },
    // Stage 3: Burning
    { overlayColor: "#3a1a0a", overlayOpacity: 0.15, crackCount: 8, debrisCount: 6, fireCount: 3, fogIntensity: 0.2, silhouetteShatter: 0.5 },
    // Stage 4: Ash
    { overlayColor: "#1a0a0a", overlayOpacity: 0.25, crackCount: 12, debrisCount: 10, fireCount: 2, fogIntensity: 0.35, silhouetteShatter: 0.7 },
    // Stage 5: Ruins
    { overlayColor: "#0a0505", overlayOpacity: 0.35, crackCount: 15, debrisCount: 15, fireCount: 1, fogIntensity: 0.5, silhouetteShatter: 0.9 },
  ],
};

export function getArenaStage(world: WorldState, arenaId: BackgroundId): ArenaStage {
  return Math.min(5, world.arenaDamage[arenaId] ?? 0) as ArenaStage;
}

export function getArenaEvolution(stage: ArenaStage): ArenaEvolutionConfig["stages"][0] {
  return UNIVERSAL_STAGES.stages[stage] ?? UNIVERSAL_STAGES.stages[5];
}

// Get a label for the current stage (for UI display)
export function getArenaStageLabel(stage: ArenaStage): string {
  const labels = ["Pristine", "Cracked", "Broken", "Burning", "Ash", "Ruins"];
  return labels[stage] ?? "Ruins";
}
