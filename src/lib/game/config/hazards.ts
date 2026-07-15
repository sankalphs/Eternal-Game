// ============================================================================
// Hazard configuration — environmental hazards per arena.
// engine.ts imports from here instead of hardcoding.
// ============================================================================

export interface HazardConfig {
  edgeThreshold?: number;  // px from stage edge for volcano burn
  chipDamage?: number;     // HP/s lost when in hazard zone
  emberRate?: number;      // particles per second
  slipFactor?: number;     // snow: velocity damping factor
  dustRate?: number;       // snow: dust particles per second
  debrisRate?: number;     // temple: debris spawns per second
  debrisDamage?: number;   // temple: damage on hit
  debrisHitstun?: number;  // temple: hitstun on hit
  debrisDelayMs?: number;  // temple: ms before debris lands
}

export const HAZARDS: Record<string, HazardConfig> = {
  volcano: {
    edgeThreshold: 36,
    chipDamage: 6,
    emberRate: 8,
  },
  snow: {
    slipFactor: 0.4,
    dustRate: 4,
  },
  temple: {
    debrisRate: 0.55,
    debrisDamage: 4,
    debrisHitstun: 0.18,
    debrisDelayMs: 800,
  },
  // All other arenas have no hazards
  sunset: {},
  desert: {},
  bamboo: {},
  moon: {},
} as const;
