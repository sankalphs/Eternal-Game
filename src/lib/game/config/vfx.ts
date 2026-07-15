// ============================================================================
// VFX configuration — screen shake, hitstop, flash, zoom, chromatic aberration.
// engine.ts imports from here instead of hardcoding magic numbers.
// ============================================================================

export const VFX = {
  // Per-hit VFX (by category)
  hit: {
    blocked: { hitstop: 0.05, shake: 5, flash: 0.05 },
    light: { hitstop: 0.09, shake: 12, flash: 0.1 },
    heavy: { hitstop: 0.16, shake: 20, flash: 0.22, zoom: 0.5, chromAb: 0.8, slowmo: 0.5 },
  },

  // KO cinematic VFX
  ko: {
    hitstop: 0.6,
    shake: 40,
    flash: 0.7,
    zoom: 1.2,
    slowmo: 2.0,
    chromAb: 1.2,
    shockwave1Radius: 240,
    shockwave2Radius: 360,
    streakCount: 48,
  },

  // VFX decay rates (per second)
  decay: {
    flash: 2.2,
    shake: 60,
    zoom: 1.8,
    chromAb: 2.5,
  },

  // Combo
  comboTimer: 1.6,

  // Colors
  colors: {
    blockFlash: "#93c5fd",
    blockDamageText: "#93c5fd",
    heavyDamageText: "#fde047",
    lightDamageText: "#fca5a5",
    koWinFlash: "#fde047",
    koLoseFlash: "#f87171",
    koWinShockwave1: "#fde047",
    koWinShockwave2: "#fef3c7",
    koLoseShockwave1: "#f87171",
    koLoseShockwave2: "#fecaca",
    ringColor: "#fde68a",
  },

  // Boss intro
  bossIntro: {
    zoom: 0.3,
    flash: 0.5,
    phaseTimer: 2.4,
  },

  // Round intro
  roundIntro: {
    phaseTimer: 2.2,
  },
} as const;

// Named re-exports for modules that import individual constants
export const HIT_VFX = VFX.hit;
export const HEAVY_HIT_ZOOM = VFX.hit.heavy.zoom;
export const HEAVY_HIT_CHROM_AB = VFX.hit.heavy.chromAb;
export const HEAVY_HIT_SLOWMO = VFX.hit.heavy.slowmo;
export const KO_VFX = VFX.ko;
export const DECAY = VFX.decay;
export const COMBO_TIMER = VFX.comboTimer;
export const VFX_COLORS = VFX.colors;
