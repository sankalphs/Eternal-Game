// ============================================================================
// PHASE 5: GAME DESIGN QUALITY SCORING
//
// Every GameDesignSample receives a quality score. The metrics are
// inspired by the existing DatasetQualityEngine (src/lib/game/ai/
// DatasetQualityEngine.ts) but extended for high-level design intent:
//
//   - playerAdaptation
//   - challenge
//   - narrativeConsistency
//   - emotionConsistency
//   - genomeSuitability
//   - difficultyConsistency
//   - campaignContinuity
//   - overall
//
// Low-quality samples are excluded from fine-tuning exports.
// ============================================================================

import type { GameDesignSample } from "./GameDesignDatasetLogger";

export type GameDesignQuality = "high" | "medium" | "low";

export interface GameDesignQualityScore {
  playerAdaptation: number;       // 0..1 — does the plan adapt to the player?
  challenge: number;              // 0..1 — is the plan well-calibrated to skill?
  narrativeConsistency: number;   // 0..1 — does it respect the chapter/narrative?
  emotionConsistency: number;      // 0..1 — is the emotion coherent with the topline?
  genomeSuitability: number;      // 0..1 — does the genome fit the predicted behaviour?
  difficultyConsistency: number;  // 0..1 — does the difficulty match the intent?
  campaignContinuity: number;     // 0..1 — does it continue the campaign?
  overall: number;                // weighted average
  quality: GameDesignQuality;
}

export class GameDesignQualityEngine {
  private weights = {
    playerAdaptation: 0.22,
    challenge: 0.13,
    narrativeConsistency: 0.15,
    emotionConsistency: 0.15,
    genomeSuitability: 0.15,
    difficultyConsistency: 0.10,
    campaignContinuity: 0.10,
  };

  /**
   * Score a single GameDesignSample.
   */
  score(sample: GameDesignSample): GameDesignQualityScore {
    const ctx = sample.context;
    const plan = sample.plan;
    const playerAdaptation = this.scorePlayerAdaptation(ctx, plan);
    const challenge = this.scoreChallenge(ctx, plan);
    const narrativeConsistency = this.scoreNarrativeConsistency(ctx, plan);
    const emotionConsistency = this.scoreEmotionConsistency(ctx, plan);
    const genomeSuitability = this.scoreGenomeSuitability(ctx, plan);
    const difficultyConsistency = this.scoreDifficultyConsistency(ctx, plan);
    const campaignContinuity = this.scoreCampaignContinuity(ctx, plan);

    const overall =
      playerAdaptation * this.weights.playerAdaptation +
      challenge * this.weights.challenge +
      narrativeConsistency * this.weights.narrativeConsistency +
      emotionConsistency * this.weights.emotionConsistency +
      genomeSuitability * this.weights.genomeSuitability +
      difficultyConsistency * this.weights.difficultyConsistency +
      campaignContinuity * this.weights.campaignContinuity;

    const quality: GameDesignQuality =
      overall >= 0.7 ? "high" : overall >= 0.5 ? "medium" : "low";

    return {
      playerAdaptation,
      challenge,
      narrativeConsistency,
      emotionConsistency,
      genomeSuitability,
      difficultyConsistency,
      campaignContinuity,
      overall,
      quality,
    };
  }

  /**
   * Score many samples and return aggregate statistics.
   */
  scoreAll(samples: GameDesignSample[]): {
    scores: { sample: GameDesignSample; score: GameDesignQualityScore }[];
    counts: Record<GameDesignQuality, number>;
    averageOverall: number;
  } {
    const scores = samples.map(s => ({ sample: s, score: this.score(s) }));
    const counts: Record<GameDesignQuality, number> = { high: 0, medium: 0, low: 0 };
    let sum = 0;
    for (const s of scores) {
      counts[s.score.quality]++;
      sum += s.score.overall;
    }
    return {
      scores,
      counts,
      averageOverall: scores.length > 0 ? sum / scores.length : 0,
    };
  }

  // --------------------------------------------------------------------------
  // Scoring helpers
  // --------------------------------------------------------------------------

  private scorePlayerAdaptation(ctx: GameDesignSample["context"], plan: GameDesignSample["plan"]): number {
    const topline = ctx.topline;
    if (!topline) return 0.5;
    // Did the chosen genome counter the predicted weakness?
    const weakness = topline.biggestWeakness;
    const counterMap: Record<string, string[]> = {
      kickSpam: ["counter", "aggressive"],
      blockTurtle: ["rushdown", "zoner"],
      panicRoll: ["punisher", "aggressive"],
      earlyRush: ["counter", "rushdown"],
      superSave: ["aggressive", "rushdown"],
      whiffPunish: ["defensive", "patient"],
      jumpAvoid: ["zoner", "defensive"],
    };
    const counters = counterMap[weakness] ?? [];
    const countered = counters.includes(plan.recommendedGenome);
    // Did the difficulty match the posture?
    const posture = topline.recommendedPosture;
    const postureDifficulty: Record<string, string[]> = {
      challenge: ["hard", "brutal"],
      teach: ["normal", "hard"],
      reward: ["easy", "normal"],
      punish: ["hard", "brutal", "nightmare"],
      rest: ["easy", "normal"],
    };
    const expectedDiffs = postureDifficulty[posture] ?? [];
    const diffOk = expectedDiffs.includes(plan.targetDifficulty);

    let score = 0.5;
    if (countered) score += 0.3;
    if (diffOk) score += 0.2;
    return Math.max(0, Math.min(1, score));
  }

  private scoreChallenge(ctx: GameDesignSample["context"], plan: GameDesignSample["plan"]): number {
    const skill = ctx.playerEstimate.skill;
    const diff = plan.targetDifficulty;
    const expected: Record<string, number> = {
      easy: 0.2,
      normal: 0.5,
      hard: 0.7,
      brutal: 0.85,
      nightmare: 0.95,
      adaptive: 0.6,
    };
    const target = expected[diff] ?? 0.5;
    // Score = 1 - |expected - actual| (clamped)
    return Math.max(0, Math.min(1, 1 - Math.abs(skill - target)));
  }

  private scoreNarrativeConsistency(ctx: GameDesignSample["context"], plan: GameDesignSample["plan"]): number {
    if (!ctx.currentChapter) return 0.6; // no chapter to violate
    const chapterEmotion = ctx.currentChapter.emotion;
    // Target emotion should be within ±1 step of chapter emotion
    const order = ["wonder", "confidence", "suspicion", "curiosity", "determination", "fear", "rage", "hopelessness", "despair", "chaos", "isolation", "serene", "awe", "victory", "triumph"];
    const c = order.indexOf(chapterEmotion);
    const t = order.indexOf(plan.targetEmotion);
    if (c < 0 || t < 0) return 0.5;
    const dist = Math.abs(c - t);
    if (dist === 0) return 1.0;
    if (dist <= 2) return 0.8;
    if (dist <= 4) return 0.5;
    return 0.2;
  }

  private scoreEmotionConsistency(ctx: GameDesignSample["context"], plan: GameDesignSample["plan"]): number {
    const curve = ctx.emotionalCurve;
    if (!curve) return 0.5;
    // If we're at the climax, the target should be high intensity.
    if (curve.trajectory === "peaking" && plan.targetIntensity < 0.5) return 0.3;
    if (curve.trajectory === "rising" && plan.targetIntensity < curve.currentIntensity) return 0.5;
    // Intensity should be in 0..1
    if (plan.targetIntensity < 0 || plan.targetIntensity > 1) return 0.0;
    return 0.85;
  }

  private scoreGenomeSuitability(ctx: GameDesignSample["context"], plan: GameDesignSample["plan"]): number {
    const lib = ctx.genomeLibrary;
    if (!lib || lib.entries.length === 0) return 0.5;
    // Is the recommended genome in the library? If yes, +0.5. Else, +0.2.
    const found = lib.entries.find(e => e.style === plan.recommendedGenome);
    if (found) return Math.min(1, 0.6 + found.fitness * 0.4);
    return 0.3;
  }

  private scoreDifficultyConsistency(ctx: GameDesignSample["context"], plan: GameDesignSample["plan"]): number {
    const cur = ctx.currentDifficulty.id;
    const next = plan.targetDifficulty;
    const order: Record<string, number> = {
      easy: 0,
      normal: 1,
      hard: 2,
      brutal: 3,
      nightmare: 4,
      adaptive: 1,
    };
    const c = order[cur] ?? 1;
    const n = order[next] ?? 1;
    // Jumps of more than 2 steps are jarring.
    return Math.max(0, 1 - Math.abs(c - n) / 4);
  }

  private scoreCampaignContinuity(ctx: GameDesignSample["context"], plan: GameDesignSample["plan"]): number {
    const recent = ctx.previousDirectorPlans?.recent ?? [];
    if (recent.length === 0) return 0.7;
    // Penalize direct repetition of the same weather/genome combo.
    const sameCombo = recent.filter(p => p.weather === plan.recommendedWeather && p.bossStyle === plan.recommendedGenome).length;
    if (sameCombo === 0) return 0.9;
    if (sameCombo === 1) return 0.6;
    if (sameCombo === 2) return 0.3;
    return 0.1;
  }
}
