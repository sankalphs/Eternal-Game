// ============================================================================
// PSYCHOLOGY ENGINE — converts raw telemetry into behavioral archetypes.
//
// Instead of a single label, assigns confidence scores (0..1) to each
// archetype. The Director uses the top-scoring archetypes to plan the fight.
//
// This module NEVER runs during combat. It runs after each match when the
// PlayerProfile is finalized.
// ============================================================================

import type { PlayerProfile } from "../profiler/PlayerProfiler";

export type ArchetypeId =
  | "explorer" | "aggressor" | "defender" | "counter_player"
  | "risk_taker" | "perfectionist" | "combo_artist" | "speedrunner"
  | "patient_fighter" | "mind_gamer" | "button_masher" | "adaptive_player"
  | "comeback_specialist" | "panicker" | "finisher";

export interface ArchetypeScore {
  id: ArchetypeId;
  label: string;
  score: number; // 0..1 confidence
  description: string;
}

export interface PsychologyProfile {
  archetypes: ArchetypeScore[];   // sorted by score descending
  dominant: ArchetypeScore;        // highest scoring
  secondary: ArchetypeScore | null; // second highest if score > 0.3
  // Psychological traits derived from the archetypes
  traits: {
    aggression: number;      // 0..1
    patience: number;        // 0..1
    adaptability: number;    // 0..1
    riskTolerance: number;   // 0..1
    composure: number;       // 0..1 (low = panics under pressure)
    intelligence: number;    // 0..1 (mixup/habit usage)
  };
}

// ============================================================================
// Scoring functions — each archetype evaluates the profile independently.
// ============================================================================

function scoreExplorer(p: PlayerProfile): number {
  // High jump frequency + varied attacks + mid-far spacing
  const jumpScore = Math.min(1, p.jumpFrequency / 12);
  const variety = Object.keys(p.favouriteAttacks).length;
  const varietyScore = Math.min(1, variety / 4);
  const spacingScore = p.preferredSpacing === "far" ? 0.7 : p.preferredSpacing === "mid" ? 0.4 : 0.1;
  return clamp(jumpScore * 0.4 + varietyScore * 0.3 + spacingScore * 0.3);
}

function scoreAggressor(p: PlayerProfile): number {
  // High aggression + low defense + close spacing
  const aggrScore = Math.min(1, p.aggression / 0.8);
  const defPenalty = 1 - Math.min(1, p.defense / 0.5);
  const closeScore = p.preferredSpacing === "close" ? 0.7 : 0.3;
  return clamp(aggrScore * 0.5 + defPenalty * 0.3 + closeScore * 0.2);
}

function scoreDefender(p: PlayerProfile): number {
  // High defense + low aggression + low risk
  const defScore = Math.min(1, p.defense / 0.6);
  const aggrPenalty = 1 - Math.min(1, p.aggression / 0.5);
  const riskPenalty = 1 - p.riskLevel;
  return clamp(defScore * 0.5 + aggrPenalty * 0.25 + riskPenalty * 0.25);
}

function scoreCounterPlayer(p: PlayerProfile): number {
  // Fast reaction + low aggression + decent defense
  const reactScore = Math.max(0, 1 - p.reactionSpeed / 600);
  const aggrMod = 1 - Math.min(1, p.aggression / 0.6);
  const defScore = Math.min(1, p.defense / 0.4);
  return clamp(reactScore * 0.4 + aggrMod * 0.3 + defScore * 0.3);
}

function scoreRiskTaker(p: PlayerProfile): number {
  // High risk level + high corner pressure (fighting out of corners)
  const riskScore = Math.min(1, p.riskLevel / 0.5);
  const cornerScore = Math.min(1, p.cornerPressure / 0.4);
  const aggrScore = Math.min(1, p.aggression / 0.7);
  return clamp(riskScore * 0.5 + cornerScore * 0.3 + aggrScore * 0.2);
}

function scorePerfectionist(p: PlayerProfile): number {
  // Low risk + low damage taken + high block strings
  const safeScore = 1 - p.riskLevel;
  const dmgRatio = p.totalDamageTaken / Math.max(1, p.totalDamageDealt + p.totalDamageTaken);
  const efficientScore = 1 - Math.min(1, dmgRatio);
  const blockScore = Math.min(1, p.blockStringCount / 10);
  return clamp(safeScore * 0.4 + efficientScore * 0.35 + blockScore * 0.25);
}

function scoreComboArtist(p: PlayerProfile): number {
  // High average combo length + aggression
  const comboScore = Math.min(1, p.averageComboLength / 4);
  const aggrScore = Math.min(1, p.aggression / 0.6);
  return clamp(comboScore * 0.6 + aggrScore * 0.4);
}

function scoreSpeedrunner(p: PlayerProfile): number {
  // Fast win speed + high aggression
  if (p.winSpeed <= 0) return 0;
  const speedScore = Math.max(0, 1 - p.winSpeed / 30);
  const aggrScore = Math.min(1, p.aggression / 0.7);
  return clamp(speedScore * 0.6 + aggrScore * 0.4);
}

function scorePatientFighter(p: PlayerProfile): number {
  // Low aggression + high defense + low risk + mid spacing
  const aggrPenalty = 1 - Math.min(1, p.aggression / 0.4);
  const defScore = Math.min(1, p.defense / 0.5);
  const safeScore = 1 - p.riskLevel;
  return clamp(aggrPenalty * 0.4 + defScore * 0.3 + safeScore * 0.3);
}

function scoreMindGamer(p: PlayerProfile): number {
  // Varied attacks + moderate aggression + moderate defense + adaptation
  const variety = Math.min(1, Object.keys(p.favouriteAttacks).length / 4);
  const balance = 1 - Math.abs(p.aggression - p.defense);
  const comboScore = Math.min(1, p.averageComboLength / 3);
  return clamp(variety * 0.35 + balance * 0.35 + comboScore * 0.3);
}

function scoreButtonMasher(p: PlayerProfile): number {
  // High aggression + low combo length + high risk + low reaction
  const aggrScore = Math.min(1, p.aggression / 0.7);
  const comboPenalty = 1 - Math.min(1, p.averageComboLength / 2);
  const riskScore = Math.min(1, p.riskLevel / 0.4);
  const slowReact = Math.min(1, p.reactionSpeed / 500);
  return clamp(aggrScore * 0.3 + comboPenalty * 0.3 + riskScore * 0.2 + slowReact * 0.2);
}

function scoreAdaptivePlayer(p: PlayerProfile): number {
  // Balanced stats + multiple match types + decent everything
  const balance = 1 - Math.abs(p.aggression - p.defense);
  const variety = Math.min(1, Object.keys(p.favouriteAttacks).length / 3);
  const adapt = Math.min(1, p.matchesPlayed / 5);
  return clamp(balance * 0.4 + variety * 0.3 + adapt * 0.3);
}

function scoreComebackSpecialist(p: PlayerProfile): number {
  // Won matches despite taking lots of damage + high corner pressure (escaped)
  const dmgTaken = p.totalDamageTaken;
  const dmgDealt = p.totalDamageDealt;
  if (dmgDealt <= 0) return 0;
  const closeRatio = dmgTaken / (dmgDealt + dmgTaken);
  const winRate = p.matchesPlayed > 0 ? p.matchesWon / p.matchesPlayed : 0;
  const cornerScore = Math.min(1, p.cornerPressure / 0.3);
  return clamp(closeRatio * 0.4 + winRate * 0.4 + cornerScore * 0.2);
}

function scorePanicker(p: PlayerProfile): number {
  // High corner pressure + high risk + slow reaction + low defense + low win rate
  const cornerScore = Math.min(1, p.cornerPressure / 0.4);
  const riskScore = Math.min(1, p.riskLevel / 0.4);
  const slowReact = Math.min(1, p.reactionSpeed / 600);
  const loseRate = p.matchesPlayed > 0 ? 1 - p.matchesWon / p.matchesPlayed : 0.5;
  return clamp(cornerScore * 0.3 + riskScore * 0.25 + slowReact * 0.2 + loseRate * 0.25);
}

function scoreFinisher(p: PlayerProfile): number {
  // Uses super at low HP (timing) + high combo length + decent win rate
  const superTimingScore = p.superTiming > 0 ? 1 - p.superTiming : 0.3;
  const comboScore = Math.min(1, p.averageComboLength / 3);
  const winRate = p.matchesPlayed > 0 ? p.matchesWon / p.matchesPlayed : 0;
  return clamp(superTimingScore * 0.4 + comboScore * 0.3 + winRate * 0.3);
}

// ============================================================================
// Archetype registry
// ============================================================================

const ARCHETYPES: { id: ArchetypeId; label: string; description: string; score: (p: PlayerProfile) => number }[] = [
  { id: "explorer", label: "Explorer", description: "Varied attacks, mobile, unpredictable spacing.", score: scoreExplorer },
  { id: "aggressor", label: "Aggressor", description: "Relentless offense, closes distance, low defense.", score: scoreAggressor },
  { id: "defender", label: "Defender", description: "Turtle strategy, high block rate, punishes mistakes.", score: scoreDefender },
  { id: "counter_player", label: "Counter Player", description: "Waits and reacts, punishes whiffs with precision.", score: scoreCounterPlayer },
  { id: "risk_taker", label: "Risk Taker", description: "Unsafe attacks, fights out of corners, high variance.", score: scoreRiskTaker },
  { id: "perfectionist", label: "Perfectionist", description: "Minimal damage taken, long block strings, efficient.", score: scorePerfectionist },
  { id: "combo_artist", label: "Combo Artist", description: "Extended strings, chains attacks fluidly.", score: scoreComboArtist },
  { id: "speedrunner", label: "Speedrunner", description: "Wins fast, aggressive tempo, no wasted motion.", score: scoreSpeedrunner },
  { id: "patient_fighter", label: "Patient Fighter", description: "Waits for openings, safe play, methodical.", score: scorePatientFighter },
  { id: "mind_gamer", label: "Mind Gamer", description: "Varied patterns, balanced offense/defense, reads habits.", score: scoreMindGamer },
  { id: "button_masher", label: "Button Masher", description: "High aggression, low combo, risky, slow reactions.", score: scoreButtonMasher },
  { id: "adaptive_player", label: "Adaptive Player", description: "Balanced, experienced, shifts strategy mid-match.", score: scoreAdaptivePlayer },
  { id: "comeback_specialist", label: "Comeback Specialist", description: "Wins from behind, escapes corners, clutch.", score: scoreComebackSpecialist },
  { id: "panicker", label: "Panicker", description: "Cornered often, risky under pressure, slow reactions.", score: scorePanicker },
  { id: "finisher", label: "Finisher", description: "Saves super for the kill, strong combos, high win rate.", score: scoreFinisher },
];

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ============================================================================
// Psychology Engine — the public API
// ============================================================================

export class PsychologyEngine {
  /**
   * Analyze a PlayerProfile and produce a PsychologyProfile with archetype
   * confidence scores. NEVER called during combat — only after matches.
   */
  analyze(profile: PlayerProfile): PsychologyProfile {
    // Score every archetype
    const archetypes: ArchetypeScore[] = ARCHETYPES.map((a) => ({
      id: a.id,
      label: a.label,
      score: a.score(profile),
      description: a.description,
    }));

    // Sort by score descending
    archetypes.sort((a, b) => b.score - a.score);

    const dominant = archetypes[0];
    const secondary = archetypes[1] && archetypes[1].score > 0.3 ? archetypes[1] : null;

    // Derive psychological traits from the archetype distribution
    const traits = {
      aggression: profile.aggression,
      patience: 1 - profile.aggression,
      adaptability: Math.min(1, (archetypes.find(a => a.id === "adaptive_player")?.score ?? 0) +
                                 (archetypes.find(a => a.id === "mind_gamer")?.score ?? 0)),
      riskTolerance: profile.riskLevel,
      composure: 1 - (archetypes.find(a => a.id === "panicker")?.score ?? 0),
      intelligence: Math.min(1, (archetypes.find(a => a.id === "mind_gamer")?.score ?? 0) +
                                 (archetypes.find(a => a.id === "counter_player")?.score ?? 0) +
                                 (archetypes.find(a => a.id === "adaptive_player")?.score ?? 0)),
    };

    return { archetypes, dominant, secondary, traits };
  }
}
