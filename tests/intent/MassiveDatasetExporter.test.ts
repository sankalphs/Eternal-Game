// ============================================================================
// DATASET EXPORTER TESTS
// ============================================================================

import { describe, expect, it } from "bun:test";
import { MassiveDatasetExporter, DEFAULT_EXPORT_CONFIG } from "../../src/lib/game/intent/MassiveDatasetExporter";
import {
  IntentTrainingSampleBuilder,
  type IntentTrainingSample,
} from "../../src/lib/game/intent/IntentTrainingSample";

const buildSample = (id: string, quality: number, origin: any, intent: string): IntentTrainingSample => {
  return new IntentTrainingSampleBuilder(id)
    .setContext(
      {
        version: 1,
        playerProfile: {} as never,
        playerEstimate: {} as never,
        playerPrediction: {} as never,
        campaignPlan: {} as never,
        currentChapter: null,
        campaignHistory: { entries: [], currentChapterIndex: 0, totalChapters: 1, completedChapters: 0, winRate: 0.5, averageDamageRatio: 0.5 },
        worldState: {} as never,
        previousDirectorPlans: { recent: [], totalStored: 0 },
        genomeLibrary: { version: "0.0.0", baseOpponent: "default", entries: [] },
        narrativeState: null,
        emotionalCurve: null,
        bossMemory: null,
        currentDifficulty: { id: "normal", label: "Normal", modifiers: { damageMul: 1, speedMul: 1, aiAggression: 0.5 } },
        arenaState: { arenaId: "default", stage: 0, damageLevel: 0, visibleCracks: 0, activeHazardTypes: [] },
        topline: { recentWinStreak: 0, recentLossStreak: 0, dominantStrategy: "rushdown", biggestWeakness: "earlyRush", strongestTrait: "aggression", currentMood: "engaged", worldTrajectory: "stable", narrativePhase: "rising", recommendedPosture: "challenge" },
      } as any,
      "system prompt", "user prompt", "system text", `hash_${id}`,
    )
    .setOutput(
      { intent, reasoning: "test reasoning", expectedPlayerReaction: "reaction", highLevelPlan: "plan", confidence: 0.8 },
      JSON.stringify({ intent, reasoning: "r", expectedPlayerReaction: "e", highLevelPlan: "p", confidence: 0.8 }),
      "challenge",
      0.8,
    )
    .setProvenance(origin, "high", 0.8, quality, true, false, ["test"])
    .setActualResult(null)
    .setReplay(null)
    .setVersions({ dataset: "v1", genome: "v1", teacher: "v1", prompt: "v4", model: "qwen", trainingConfig: "default", distillation: "none", experiment: "test" })
    .setNotes("")
    .build();
};

describe("MassiveDatasetExporter", () => {
  it("exports train/val/test JSONL with the right shape", () => {
    const samples: IntentTrainingSample[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push(buildSample(`s_${i}`, 0.8, "synthetic", `intent_${i}`));
    }
    const exporter = new MassiveDatasetExporter({
      trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1,
      minQuality: 0.5, minConfidence: 0.5,
    });
    const result = exporter.export(samples);
    expect(result.trainJsonl.split("\n").length).toBeGreaterThan(0);
    expect(result.validationJsonl.split("\n").length).toBeGreaterThan(0);
    expect(result.testJsonl.split("\n").length).toBeGreaterThan(0);
    expect(result.stats.train + result.stats.validation + result.stats.test).toBe(result.stats.totalKept);
  });

  it("removes duplicates by context hash", () => {
    const s1 = buildSample("s_1", 0.8, "synthetic", "intent_1");
    // Force s2 to have the same context hash as s1
    const s2 = buildSample("s_2", 0.8, "synthetic", "intent_1_different");
    (s2.input as { contextHash: string }).contextHash = (s1.input as { contextHash: string }).contextHash;
    const exporter = new MassiveDatasetExporter();
    const result = exporter.export([s1, s2]);
    expect(result.stats.duplicatesRemoved).toBe(1);
  });

  it("removes low-quality samples", () => {
    const good = buildSample("s_good", 0.9, "synthetic", "good_intent");
    const bad = buildSample("s_bad", 0.1, "synthetic", "bad_intent");
    const exporter = new MassiveDatasetExporter({ minQuality: 0.5 });
    const result = exporter.export([good, bad]);
    expect(result.stats.totalKept).toBe(1);
  });

  it("removes fallback samples", () => {
    const good = buildSample("s_good", 0.9, "synthetic", "good_intent");
    (good as { fellback: boolean }).fellback = true;
    const exporter = new MassiveDatasetExporter();
    const result = exporter.export([good]);
    expect(result.stats.totalKept).toBe(0);
  });

  it("computes statistics correctly", () => {
    const samples = Array.from({ length: 10 }, (_, i) =>
      buildSample(`s_${i}`, 0.8, i % 2 ? "ga_vs_ga" : "student_vs_ga", `intent_${i}`),
    );
    const exporter = new MassiveDatasetExporter();
    const result = exporter.export(samples);
    expect(result.stats.byOrigin["ga_vs_ga"]).toBeDefined();
    expect(result.stats.byOrigin["student_vs_ga"]).toBeDefined();
    expect(result.stats.avgQuality).toBeCloseTo(0.8, 1);
  });

  it("generates a README", () => {
    const samples = [buildSample("s_1", 0.8, "synthetic", "test_intent")];
    const exporter = new MassiveDatasetExporter();
    const result = exporter.export(samples);
    expect(result.readme).toContain("# Project Eternal");
    expect(result.readme).toContain("train.jsonl");
    expect(result.readme).toContain("validation.jsonl");
    expect(result.readme).toContain("test.jsonl");
  });
});
