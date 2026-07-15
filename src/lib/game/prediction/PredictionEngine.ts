// ============================================================================
// PREDICTION ENGINE — predicts what the player will DO next, not just what
// they did. Uses the PlayerEstimate + PlayerProfile to estimate probabilities.
//
// The Director uses predictions to set up the fight BEFORE the player acts.
// ============================================================================

import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { PlayerEstimate } from "./PlayerAnalyzer";

export interface PlayerPrediction {
  // Behavioural predictions (0..1 probability)
  kickSpam: number;            // P(player will spam kicks)
  punchSpam: number;           // P(player will spam punches)
  earlyRush: number;           // P(player will rush in at round start)
  panicRoll: number;           // P(player will roll when pressured)
  superSave: number;           // P(player will hold super for the kill)
  superEarly: number;          // P(player will waste super early)
  blockTurtle: number;         // P(player will turtle behind blocks)
  jumpAvoid: number;           // P(player will jump to avoid ground pressure)
  whiffPunish: number;         // P(player will bait and punish whiffs)
  hazardAvoid: number;         // P(player will actively avoid hazards)
  rageQuitRisk: number;        // P(player will give up / play worse after losing)
  adaptationRate: number;      // P(player will change strategy mid-match)

  // Spacing predictions
  prefersCloseRange: number;   // P(player will stay close)
  prefersFarRange: number;     // P(player will zone)

  // Temporal predictions
  becomesImpatient: number;    // P(player gets impatient in long fights >30s)
  becomesAggressiveAfterLoss: number; // P(player gets aggressive after losing a round)
  becomesDefensiveAfterWin: number;   // P(player turtles after winning a round)

  // Predicted next action distribution (0..1 each, not normalized — these are
  // independent probabilities the Director uses to pre-position the boss)
  likelyNextAction: {
    attack: number;
    block: number;
    roll: number;
    jump: number;
    approach: number;
    retreat: number;
    idle: number;
  };
}

export class PredictionEngine {
  predict(estimate: PlayerEstimate, profile: PlayerProfile): PlayerPrediction {
    const e = estimate;
    const p = profile;

    // --- Behavioural predictions ---

    // Kick spam: high aggression + kick is the favourite + low patience
    const kickCount = p.favouriteAttacks["kick"] ?? 0;
    const totalAttacks = Object.values(p.favouriteAttacks).reduce((a, b) => a + b, 0);
    const kickRatio = totalAttacks > 0 ? kickCount / totalAttacks : 0.33;
    const kickSpam = clamp(kickRatio * 0.5 + e.confidence * 0.3 + (1 - e.patience) * 0.2);

    // Punch spam: similar logic for punches
    const punchCount = p.favouriteAttacks["punch"] ?? 0;
    const punchRatio = totalAttacks > 0 ? punchCount / totalAttacks : 0.33;
    const punchSpam = clamp(punchRatio * 0.5 + e.confidence * 0.2 + (1 - e.patience) * 0.3);

    // Early rush: high aggression + close spacing preference + fast tempo
    const earlyRush = clamp(e.confidence * 0.4 + (e.preferredDistance === "close" ? 0.3 : 0.1) + (e.preferredTempo === "fast" ? 0.2 : 0) + e.riskTolerance * 0.1);

    // Panic roll: low emotional stability + high corner pressure history
    const panicRoll = clamp((1 - e.emotionalStability) * 0.4 + p.cornerPressure * 0.3 + p.rollFrequency / 15 * 0.3);

    // Super save: high patience + high skill + uses super at low HP
    const superSave = clamp(e.patience * 0.3 + e.skill * 0.3 + (p.superTiming > 0 && p.superTiming < 0.4 ? 0.4 : 0.1));

    // Super early: low patience + high aggression + uses super at high HP
    const superEarly = clamp((1 - e.patience) * 0.4 + e.confidence * 0.3 + (p.superTiming > 0.5 ? 0.3 : 0));

    // Block turtle: high defense + high patience + low risk
    const blockTurtle = clamp(e.patience * 0.35 + p.defense * 0.35 + (1 - e.riskTolerance) * 0.3);

    // Jump avoid: high jump frequency + high curiosity
    const jumpAvoid = clamp(Math.min(1, p.jumpFrequency / 12) * 0.5 + e.curiosity * 0.3 + (e.preferredDistance === "far" ? 0.2 : 0));

    // Whiff punish: high skill + high patience + fast reactions
    const whiffPunish = clamp(e.skill * 0.4 + e.patience * 0.3 + Math.max(0, 1 - p.reactionSpeed / 500) * 0.3);

    // Hazard avoid: high curiosity + high skill (skilled players notice hazards)
    const hazardAvoid = clamp(e.skill * 0.4 + e.curiosity * 0.3 + e.patience * 0.3);

    // Rage quit risk: low frustration tolerance + low emotional stability + losing streak
    const winRate = p.matchesPlayed > 0 ? p.matchesWon / p.matchesPlayed : 0.5;
    const rageQuitRisk = clamp((1 - e.frustrationTolerance) * 0.4 + (1 - e.emotionalStability) * 0.3 + (1 - winRate) * 0.3);

    // Adaptation rate: high adaptability + high curiosity
    const adaptationRate = clamp(e.adaptability * 0.5 + e.curiosity * 0.3 + e.skill * 0.2);

    // --- Spacing predictions ---
    const prefersCloseRange = clamp(e.preferredDistance === "close" ? 0.8 : e.preferredDistance === "mid" ? 0.4 : 0.15);
    const prefersFarRange = clamp(e.preferredDistance === "far" ? 0.8 : e.preferredDistance === "mid" ? 0.35 : 0.1);

    // --- Temporal predictions ---
    // Becomes impatient: low patience + high aggression (gets bored if nothing happens)
    const becomesImpatient = clamp((1 - e.patience) * 0.5 + e.confidence * 0.2 + (e.preferredTempo === "fast" ? 0.3 : 0.1));

    // Becomes aggressive after loss: low frustration tolerance + high aggression
    const becomesAggressiveAfterLoss = clamp((1 - e.frustrationTolerance) * 0.4 + e.confidence * 0.3 + e.riskTolerance * 0.3);

    // Becomes defensive after win: high patience + high defense
    const becomesDefensiveAfterWin = clamp(e.patience * 0.4 + p.defense * 0.3 + (1 - e.riskTolerance) * 0.3);

    // --- Likely next action (at round start, based on current state) ---
    const likelyNextAction = {
      attack: clamp(e.confidence * 0.3 + (e.preferredDistance === "close" ? 0.2 : 0)),
      block: clamp(e.patience * 0.3 + p.defense * 0.2),
      roll: clamp(panicRoll * 0.5),
      jump: clamp(jumpAvoid * 0.4 + e.curiosity * 0.1),
      approach: clamp(earlyRush * 0.4 + (e.preferredDistance === "close" ? 0.2 : 0.1)),
      retreat: clamp((e.preferredDistance === "far" ? 0.3 : 0.1) + (1 - e.confidence) * 0.1),
      idle: clamp(e.patience * 0.2 + (1 - e.confidence) * 0.1),
    };

    return {
      kickSpam, punchSpam, earlyRush, panicRoll, superSave, superEarly,
      blockTurtle, jumpAvoid, whiffPunish, hazardAvoid, rageQuitRisk, adaptationRate,
      prefersCloseRange, prefersFarRange,
      becomesImpatient, becomesAggressiveAfterLoss, becomesDefensiveAfterWin,
      likelyNextAction,
    };
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
