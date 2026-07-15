// ============================================================================
// Boss Behavior Library — 9 prebuilt boss behavior templates.
// Selected by the AI Director. Applied to the EnemyAI as capability overrides.
// ============================================================================

import type { OpponentDef } from "../types";

export type BossStyleId =
  | "aggressive" | "counter" | "defensive" | "patient"
  | "rushdown" | "mind_game" | "punisher" | "adaptive" | "zoner";

export interface BossStyleProfile {
  id: BossStyleId;
  label: string;
  description: string;
  // AI capability overrides (applied on top of the opponent's base stats)
  aggressionMul: number;
  blockChanceMul: number;
  reactionMul: number;
  comboMul: number;
  whiffPunishMul: number;
  antiAirMul: number;
  pressureMul: number;
  mixupMul: number;
  adaptiveMul: number;
  rageMul: number;
  perfectionMul: number;
  // Dialogue tone for pre-fight taunts
  dialogueTone: "taunting" | "cold" | "rage" | "calm" | "despair" | "none";
}

export const BOSS_STYLES: Record<BossStyleId, BossStyleProfile> = {
  aggressive: {
    id: "aggressive", label: "Aggressive",
    description: "Relentless pressure, always attacking, rarely blocks.",
    aggressionMul: 1.3, blockChanceMul: 0.5, reactionMul: 0.8, comboMul: 1.2,
    whiffPunishMul: 0.8, antiAirMul: 0.7, pressureMul: 1.4, mixupMul: 0.8,
    adaptiveMul: 0.6, rageMul: 1.3, perfectionMul: 0.5,
    dialogueTone: "rage",
  },
  counter: {
    id: "counter", label: "Counter-Fighter",
    description: "Waits for you to attack, then punishes the whiff.",
    aggressionMul: 0.6, blockChanceMul: 1.3, reactionMul: 1.5, comboMul: 1.0,
    whiffPunishMul: 1.8, antiAirMul: 1.5, pressureMul: 0.5, mixupMul: 0.7,
    adaptiveMul: 1.2, rageMul: 0.8, perfectionMul: 1.5,
    dialogueTone: "cold",
  },
  defensive: {
    id: "defensive", label: "Defensive",
    description: "Turtle strategy, blocks everything, punishes mistakes.",
    aggressionMul: 0.4, blockChanceMul: 1.6, reactionMul: 1.3, comboMul: 0.8,
    whiffPunishMul: 1.4, antiAirMul: 1.2, pressureMul: 0.3, mixupMul: 0.5,
    adaptiveMul: 1.0, rageMul: 0.6, perfectionMul: 1.8,
    dialogueTone: "calm",
  },
  patient: {
    id: "patient", label: "Patient",
    description: "Zones and waits, only attacks when you overextend.",
    aggressionMul: 0.5, blockChanceMul: 1.2, reactionMul: 1.4, comboMul: 1.0,
    whiffPunishMul: 1.6, antiAirMul: 1.3, pressureMul: 0.4, mixupMul: 0.8,
    adaptiveMul: 1.3, rageMul: 0.7, perfectionMul: 1.4,
    dialogueTone: "calm",
  },
  rushdown: {
    id: "rushdown", label: "Rushdown",
    description: "Closes distance instantly, never stops attacking.",
    aggressionMul: 1.5, blockChanceMul: 0.3, reactionMul: 0.6, comboMul: 1.4,
    whiffPunishMul: 0.6, antiAirMul: 0.5, pressureMul: 1.8, mixupMul: 1.2,
    adaptiveMul: 0.5, rageMul: 1.5, perfectionMul: 0.3,
    dialogueTone: "rage",
  },
  mind_game: {
    id: "mind_game", label: "Mind Game",
    description: "Mixes patterns unpredictably, adapts to your habits.",
    aggressionMul: 1.0, blockChanceMul: 1.1, reactionMul: 1.2, comboMul: 1.3,
    whiffPunishMul: 1.3, antiAirMul: 1.2, pressureMul: 1.2, mixupMul: 1.8,
    adaptiveMul: 2.0, rageMul: 1.0, perfectionMul: 1.2,
    dialogueTone: "taunting",
  },
  punisher: {
    id: "punisher", label: "Punisher",
    description: "Every mistake you make is heavily punished.",
    aggressionMul: 0.8, blockChanceMul: 1.0, reactionMul: 1.6, comboMul: 1.5,
    whiffPunishMul: 2.0, antiAirMul: 1.8, pressureMul: 0.8, mixupMul: 1.0,
    adaptiveMul: 1.2, rageMul: 1.1, perfectionMul: 1.6,
    dialogueTone: "cold",
  },
  adaptive: {
    id: "adaptive", label: "Adaptive",
    description: "Learns your patterns mid-fight and counters them.",
    aggressionMul: 1.0, blockChanceMul: 1.0, reactionMul: 1.1, comboMul: 1.1,
    whiffPunishMul: 1.2, antiAirMul: 1.2, pressureMul: 1.0, mixupMul: 1.3,
    adaptiveMul: 2.5, rageMul: 1.0, perfectionMul: 1.1,
    dialogueTone: "taunting",
  },
  zoner: {
    id: "zoner", label: "Zoner",
    description: "Keeps you at max range, punishes approaches.",
    aggressionMul: 0.7, blockChanceMul: 0.9, reactionMul: 1.3, comboMul: 1.0,
    whiffPunishMul: 1.5, antiAirMul: 1.6, pressureMul: 0.6, mixupMul: 0.9,
    adaptiveMul: 1.0, rageMul: 0.8, perfectionMul: 1.0,
    dialogueTone: "cold",
  },
};

// Apply a boss style to an opponent definition, returning a modified copy.
export function applyBossStyle(
  base: OpponentDef,
  style: BossStyleProfile,
): OpponentDef {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    ...base,
    aggression: clamp(base.aggression * style.aggressionMul),
    blockChance: clamp(base.blockChance * style.blockChanceMul),
    reaction: Math.max(0.08, base.reaction * style.reactionMul),
    combo: Math.max(1, Math.round(base.combo * style.comboMul)),
    whiffPunish: clamp((base.whiffPunish ?? 0) * style.whiffPunishMul),
    antiAir: clamp((base.antiAir ?? 0) * style.antiAirMul),
    pressure: clamp((base.pressure ?? 0) * style.pressureMul),
    mixup: clamp((base.mixup ?? 0) * style.mixupMul),
    adaptive: clamp((base.adaptive ?? 0) * style.adaptiveMul),
    rage: clamp((base.rage ?? 0) * style.rageMul),
    perfection: clamp((base.perfection ?? 0) * style.perfectionMul),
  };
}
