// ============================================================================
// AI configuration — tuning constants for the rule-based EnemyAI.
// ai.ts imports from here instead of hardcoding.
// ============================================================================

export const AI_CONFIG = {
  // Range bands (px) — when to react, punish, anti-air, attack
  ranges: {
    react: 170,       // react to player attacks within this distance
    punish: 130,      // dash in to punish a whiff
    antiAir: 150,     // anti-air a jumping player
    closeApproach: 100, // start approaching when within this
    roundhouse: 106,  // max range for roundhouse opener
    punch: 66,        // max range for punch
  },

  // Optimal spacing — the AI tries to hold this distance
  spacing: {
    optimalFar: 92,   // mixup AIs zone wider
    optimalNear: 60,  // non-mixup AIs stay closer
    mixupThreshold: 0.45, // mixup > this → use optimalFar
    approachThreshold: 8, // dist > optimal + this → approach
    retreatThreshold: 14, // dist < optimal - this → back off
  },

  // Decision timing
  timing: {
    decisionBase: 0.45,
    decisionPressureScale: 0.25,
    decisionRandom: 0.35,
    antiAirReactScale: 0.6, // multiply reaction time for anti-air
  },

  // Windows
  windows: {
    whiffPunish: 0.22,     // seconds to punish a missed attack
    blockTimerBase: 0.35,
    blockTimerRandom: 0.25,
    retreatTimerBase: 0.18,
    retreatTimerRandom: 0.28,
    recoverTimerBase: 0.3,
  },

  // Jump behavior
  jump: {
    jumpInBase: 0.25,
    jumpInPressureScale: 0.3,
    jumpCooldownBase: 1.2,
    jumpCooldownRandom: 1.0,
    jumpThreshold: 230, // dist > this → consider jump-in
  },

  // Pressure strings
  pressure: {
    gapBase: 0.55,
    gapRandom: 0.5,
    interruptThreshold: 0.15, // blockTimer < this → counter
    interruptChance: 0.4,
  },

  // Habit thresholds (adaptive system)
  habits: {
    blockThreshold: 0.4,    // player blocks > 40% of openings
    jumpThreshold: 0.3,     // player jumps > 30% of openings
    minSamples: 4,          // need this many openings before adapting
    blockAdaptScale: 0.6,
    jumpAdaptScale: 0.5,
  },

  // Rage mode (low HP scaling)
  rage: {
    hpThreshold: 0.3,      // below 30% HP → rage
    aggressionBoost: 0.25, // += rage * this
    speedBoost: 0.12,      // += rage * this
    maxAggression: 0.98,
  },
} as const;
