// ============================================================================
// PLAYER ANALYZER — estimates what kind of player they ARE, not just what
// they did. Values evolve slowly across multiple matches (exponential moving
// average) so a single match never drastically shifts the profile.
// ============================================================================

import type { PlayerProfile } from "../profiler/PlayerProfiler";

export interface PlayerEstimate {
  // Core skill metrics (0..1)
  skill: number;               // overall mechanical skill
  confidence: number;          // how assertive they are (win streak sensitive)
  patience: number;            // willingness to wait for openings
  adaptability: number;        // strategy variety across matches
  riskTolerance: number;       // willingness to use unsafe attacks
  curiosity: number;           // exploration of different attacks/positions
  emotionalStability: number;  // composure under pressure (low = panics)
  frustrationTolerance: number; // ability to recover from losing

  // Preferences
  preferredDistance: "close" | "mid" | "far";
  preferredTempo: "slow" | "medium" | "fast";
  favouriteStrategies: string[];   // e.g. ["rushdown", "whiff_punish", "turtle"]

  // History-derived
  matchesAnalyzed: number;
  lastUpdated: number;
}

export function createInitialEstimate(): PlayerEstimate {
  return {
    skill: 0.3,
    confidence: 0.5,
    patience: 0.5,
    adaptability: 0.5,
    riskTolerance: 0.5,
    curiosity: 0.5,
    emotionalStability: 0.5,
    frustrationTolerance: 0.5,
    preferredDistance: "mid",
    preferredTempo: "medium",
    favouriteStrategies: [],
    matchesAnalyzed: 0,
    lastUpdated: Date.now(),
  };
}

export class PlayerAnalyzer {
  /**
   * Update the PlayerEstimate using an exponential moving average.
   * alpha controls how quickly the estimate shifts (0.15 = slow, stable).
   * Each call incorporates one match's telemetry into the running estimate.
   */
  update(prev: PlayerEstimate, matchProfile: PlayerProfile, won: boolean): PlayerEstimate {
    const alpha = 0.15; // slow evolution — one match shouldn't flip everything

    // --- Compute instantaneous values from the match profile ---

    // Skill: composite of reaction speed, combo length, damage efficiency, win rate
    const reactScore = Math.max(0, 1 - matchProfile.reactionSpeed / 600);
    const comboScore = Math.min(1, matchProfile.averageComboLength / 4);
    const dmgRatio = matchProfile.totalDamageDealt / Math.max(1, matchProfile.totalDamageDealt + matchProfile.totalDamageTaken);
    const winBonus = won ? 0.1 : 0;
    const instSkill = clamp(reactScore * 0.35 + comboScore * 0.3 + dmgRatio * 0.25 + winBonus);

    // Confidence: aggression + win rate + super usage
    const winRate = matchProfile.matchesPlayed > 0 ? matchProfile.matchesWon / matchProfile.matchesPlayed : 0.5;
    const instConfidence = clamp(matchProfile.aggression * 0.4 + winRate * 0.4 + (matchProfile.superTiming > 0 ? 0.2 : 0));

    // Patience: inverse aggression + defense + low risk
    const instPatience = clamp((1 - matchProfile.aggression) * 0.4 + matchProfile.defense * 0.35 + (1 - matchProfile.riskLevel) * 0.25);

    // Adaptability: attack variety + spacing changes
    const variety = Math.min(1, Object.keys(matchProfile.favouriteAttacks).length / 4);
    const instAdaptability = clamp(variety * 0.6 + (matchProfile.matchesPlayed > 3 ? 0.2 : 0) + (winRate > 0.3 && winRate < 0.7 ? 0.2 : 0));

    // Risk tolerance: directly from risk level + corner pressure (if they survive corners, they tolerate risk)
    const instRisk = clamp(matchProfile.riskLevel * 0.6 + matchProfile.cornerPressure * 0.2 + matchProfile.aggression * 0.2);

    // Curiosity: attack variety + jump frequency + different spacing
    const jumpScore = Math.min(1, matchProfile.jumpFrequency / 10);
    const instCuriosity = clamp(variety * 0.4 + jumpScore * 0.3 + (matchProfile.preferredSpacing !== "close" ? 0.3 : 0));

    // Emotional stability: inverse corner pressure + fast reactions + not taking damage
    const dmgTakenRatio = matchProfile.totalDamageTaken / Math.max(1, matchProfile.totalDamageDealt + matchProfile.totalDamageTaken);
    const instStability = clamp((1 - matchProfile.cornerPressure) * 0.4 + (1 - dmgTakenRatio) * 0.3 + reactScore * 0.3);

    // Frustration tolerance: losing but still playing well (low corner pressure on losses)
    const instFrustration = won
      ? clamp(0.6 + matchProfile.aggression * 0.2)
      : clamp((1 - matchProfile.cornerPressure) * 0.5 + matchProfile.defense * 0.3 + (matchProfile.reactionSpeed < 400 ? 0.2 : 0));

    // --- EMA blend ---
    const ema = (old: number, inst: number) => old * (1 - alpha) + inst * alpha;

    const updated: PlayerEstimate = {
      skill: ema(prev.skill, instSkill),
      confidence: ema(prev.confidence, instConfidence),
      patience: ema(prev.patience, instPatience),
      adaptability: ema(prev.adaptability, instAdaptability),
      riskTolerance: ema(prev.riskTolerance, instRisk),
      curiosity: ema(prev.curiosity, instCuriosity),
      emotionalStability: ema(prev.emotionalStability, instStability),
      frustrationTolerance: ema(prev.frustrationTolerance, instFrustration),
      preferredDistance: matchProfile.preferredSpacing,
      preferredTempo: matchProfile.aggression > 0.6 ? "fast" : matchProfile.aggression < 0.3 ? "slow" : "medium",
      favouriteStrategies: this.deriveStrategies(matchProfile),
      matchesAnalyzed: prev.matchesAnalyzed + 1,
      lastUpdated: Date.now(),
    };

    return updated;
  }

  private deriveStrategies(p: PlayerProfile): string[] {
    const strategies: string[] = [];
    if (p.aggression > 0.6) strategies.push("rushdown");
    if (p.defense > 0.5) strategies.push("turtle");
    if (p.averageComboLength >= 3) strategies.push("combo_chaining");
    if (p.riskLevel < 0.2) strategies.push("safe_punish");
    if (p.rollFrequency > 6) strategies.push("evasion_heavy");
    if (Object.keys(p.favouriteAttacks).length >= 3) strategies.push("mixup");
    if (p.cornerPressure > 0.3 && p.matchesWon > 0) strategies.push("comeback");
    if (p.superTiming > 0 && p.superTiming < 0.3) strategies.push("finisher");
    return strategies.slice(0, 5); // cap at 5
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
