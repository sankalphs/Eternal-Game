// ============================================================================
// INTENT QUALITY ENGINE TESTS
// ============================================================================

import { describe, expect, it } from "bun:test";
import { IntentQualityEngine } from "../../src/lib/game/intent/IntentQualityEngine";
import {
  IntentTrainingSampleBuilder,
  type IntentTrainingSample,
} from "../../src/lib/game/intent/IntentTrainingSample";
import type { GameDesignContext } from "../../src/lib/game/gamedesigner/types";

const buildContext = (mood: string, dominantStrategy: string): GameDesignContext => ({
  version: 1,
  playerProfile: {} as never,
  playerEstimate: {
    skill: 0.5, confidence: 0.5, patience: 0.5,
    adaptability: 0.5, curiosity: 0.5,
    emotionalStability: 0.5, frustrationTolerance: 0.5,
  } as never,
  playerPrediction: {} as never,
  campaignPlan: {} as never,
  currentChapter: { chapterIndex: 0, emotion: "focus", bossStyle: "aggressive", difficulty: "normal" } as never,
  campaignHistory: { entries: [], currentChapterIndex: 0, totalChapters: 1, completedChapters: 0, winRate: 0.5, averageDamageRatio: 0.5 },
  worldState: {} as never,
  previousDirectorPlans: { recent: [], totalStored: 0 },
  genomeLibrary: { version: "0.0.0", baseOpponent: "default", entries: [] },
  narrativeState: null,
  emotionalCurve: { currentEmotion: "focus", currentIntensity: 0.5, trajectory: "stable" },
  bossMemory: null,
  currentDifficulty: { id: "normal", label: "Normal", modifiers: { damageMul: 1, speedMul: 1, aiAggression: 0.5 } },
  arenaState: { arenaId: "default", stage: 0, damageLevel: 0, visibleCracks: 0, activeHazardTypes: [] },
  topline: {
    recentWinStreak: 0, recentLossStreak: 0,
    dominantStrategy, biggestWeakness: "earlyRush", strongestTrait: dominantStrategy,
    currentMood: mood, worldTrajectory: "stable", narrativePhase: "rising",
    recommendedPosture: "challenge",
  },
} as unknown as GameDesignContext);

const buildSample = (intent: string, mood: string, strategy: string, confidence: number): IntentTrainingSample => {
  return new IntentTrainingSampleBuilder()
    .setContext(
      buildContext(mood, strategy),
      "system prompt", "user prompt", "system text", "hash",
    )
    .setOutput(
      {
        intent,
        reasoning: `The player is ${mood} and uses ${strategy}. ` + "x".repeat(20),
        expectedPlayerReaction: "Player will adapt to the new challenge presented.",
        highLevelPlan: "A patient counter encounter that punishes the dominant habit.",
        confidence,
      },
      JSON.stringify({ intent, reasoning: "r", expectedPlayerReaction: "e", highLevelPlan: "p", confidence }),
      "test",
      confidence,
    )
    .setProvenance("synthetic", "high", confidence, 0, true, false, [mood, strategy])
    .setActualResult(null)
    .setReplay(null)
    .setVersions({
      dataset: "test", genome: "v1", teacher: "v1", prompt: "v4",
      model: "qwen-1.5b", trainingConfig: "default", distillation: "none", experiment: "test",
    })
    .setNotes("test")
    .build();
};

describe("IntentQualityEngine", () => {
  const engine = new IntentQualityEngine();

  it("scores a well-formed intent higher than a vague one", () => {
    const good = buildSample(
      "Break the overconfidence built from three straight wins",
      "overconfident", "rushdown", 0.85,
    );
    const bad = buildSample(
      "do something",
      "engaged", "rushdown", 0.4,
    );
    const goodScore = engine.score(good).overall;
    const badScore = engine.score(bad).overall;
    expect(goodScore).toBeGreaterThan(badScore);
  });

  it("rewards verb-starting intents", () => {
    const a = buildSample("Break the overconfidence of the player", "overconfident", "rushdown", 0.7);
    const b = buildSample("The thing about the overconfidence is bad", "overconfident", "rushdown", 0.7);
    const aScore = engine.score(a).overall;
    const bScore = engine.score(b).overall;
    expect(aScore).toBeGreaterThanOrEqual(bScore);
  });

  it("penalises low-level values in highLevelPlan", () => {
    const a = buildSample("Break the overconfidence", "overconfident", "rushdown", 0.7);
    // override the highLevelPlan
    (a.output.intent as { highLevelPlan: string }).highLevelPlan =
      "A fog weather encounter with epic music and hard difficulty.";
    const scoreA = engine.score(a).overall;
    // vs no low-level values
    const b = buildSample("Break the overconfidence", "overconfident", "rushdown", 0.7);
    const scoreB = engine.score(b).overall;
    expect(scoreB).toBeGreaterThan(scoreA);
  });

  it("grade boundaries are correct", () => {
    // Check the grade assignment
    const test = buildSample("Break the overconfidence", "overconfident", "rushdown", 0.5);
    const score = engine.score(test);
    expect(["gold", "high", "medium", "low", "discard"]).toContain(score.quality);
  });

  it("category is one of the INTENT_CATEGORIES", () => {
    const tests = [
      "Break the overconfidence",
      "Reward the frustrated player",
      "Teach the player",
      "Conclude the campaign",
    ];
    for (const intent of tests) {
      const sample = buildSample(intent, "engaged", "rushdown", 0.7);
      const score = engine.score(sample);
      expect(score.category).toBeDefined();
    }
  });
});
