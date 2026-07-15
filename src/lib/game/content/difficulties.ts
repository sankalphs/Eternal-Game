// ============================================================================
// Difficulty Library — prebuilt difficulty scaling profiles.
// Selected by the AI Director. Applied as multipliers to opponent stats.
// ============================================================================

export type DifficultyId =
  | "easy" | "normal" | "hard" | "brutal" | "nightmare" | "adaptive";

export interface DifficultyProfile {
  id: DifficultyId;
  label: string;
  // Multipliers applied to opponent base stats
  aggressionMul: number;
  blockChanceMul: number;
  reactionMul: number;    // lower = faster reaction
  damageMul: number;      // opponent damage multiplier
  speedMul: number;       // opponent speed multiplier
  hpMul: number;          // opponent HP multiplier
  // Player handicap
  playerDamageMul: number;
  playerHpMul: number;
  // AI behavior
  aiAdaptive: number;     // 0..1 how much AI adapts to player habits
  aiPerfection: number;   // 0..1 chance of frame-perfect blocks
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyProfile> = {
  easy: {
    id: "easy", label: "Easy",
    aggressionMul: 0.6, blockChanceMul: 0.4, reactionMul: 1.8,
    damageMul: 0.6, speedMul: 0.8, hpMul: 0.8,
    playerDamageMul: 1.3, playerHpMul: 1.2,
    aiAdaptive: 0.1, aiPerfection: 0,
  },
  normal: {
    id: "normal", label: "Normal",
    aggressionMul: 1.0, blockChanceMul: 1.0, reactionMul: 1.0,
    damageMul: 1.0, speedMul: 1.0, hpMul: 1.0,
    playerDamageMul: 1.0, playerHpMul: 1.0,
    aiAdaptive: 0.3, aiPerfection: 0.1,
  },
  hard: {
    id: "hard", label: "Hard",
    aggressionMul: 1.3, blockChanceMul: 1.3, reactionMul: 0.7,
    damageMul: 1.2, speedMul: 1.1, hpMul: 1.1,
    playerDamageMul: 0.9, playerHpMul: 1.0,
    aiAdaptive: 0.6, aiPerfection: 0.25,
  },
  brutal: {
    id: "brutal", label: "Brutal",
    aggressionMul: 1.6, blockChanceMul: 1.5, reactionMul: 0.5,
    damageMul: 1.4, speedMul: 1.2, hpMul: 1.2,
    playerDamageMul: 0.8, playerHpMul: 0.9,
    aiAdaptive: 0.8, aiPerfection: 0.4,
  },
  nightmare: {
    id: "nightmare", label: "Nightmare",
    aggressionMul: 2.0, blockChanceMul: 1.8, reactionMul: 0.3,
    damageMul: 1.6, speedMul: 1.3, hpMul: 1.3,
    playerDamageMul: 0.7, playerHpMul: 0.85,
    aiAdaptive: 1.0, aiPerfection: 0.6,
  },
  adaptive: {
    id: "adaptive", label: "Adaptive",
    // These are base values — the AI Director adjusts them based on PlayerProfile
    aggressionMul: 1.0, blockChanceMul: 1.0, reactionMul: 1.0,
    damageMul: 1.0, speedMul: 1.0, hpMul: 1.0,
    playerDamageMul: 1.0, playerHpMul: 1.0,
    aiAdaptive: 1.0, aiPerfection: 0.3,
  },
};
