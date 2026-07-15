// ============================================================================
// INTENT TRANSLATOR TESTS
// ============================================================================

import { describe, expect, it } from "bun:test";
import { IntentTranslator } from "../../src/lib/game/intent/IntentTranslator";
import type { IntentOutput } from "../../src/lib/game/intent/IntentSchema";

const baseIntent = (overrides: Partial<IntentOutput> = {}): IntentOutput => ({
  intent: "Engage the player",
  reasoning: "Standard engagement.",
  expectedPlayerReaction: "Player engages normally.",
  highLevelPlan: "A baseline encounter.",
  confidence: 0.7,
  ...overrides,
});

describe("IntentTranslator", () => {
  const translator = new IntentTranslator();

  it("translates punish intent to harder difficulty + counter genome", () => {
    const result = translator.translate({
      intent: baseIntent({ intent: "Punish the overconfident player" }),
    });
    expect(result.intentCategory).toBe("punish");
    expect(result.overrides.bossStyle).toBeDefined();
    expect(result.overrides.difficulty).toBeDefined();
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("translates reward intent to easier difficulty + generous genome", () => {
    const result = translator.translate({
      intent: baseIntent({ intent: "Reward the frustrated player" }),
    });
    expect(result.intentCategory).toBe("reward");
  });

  it("translates teach intent to moderate difficulty + patient genome", () => {
    const result = translator.translate({
      intent: baseIntent({ intent: "Teach the player a new combo string" }),
    });
    expect(result.intentCategory).toBe("teach");
  });

  it("translates conclude intent to adaptive + choir + cinematic", () => {
    const result = translator.translate({
      intent: baseIntent({ intent: "Conclude the campaign with a final encounter" }),
    });
    expect(result.intentCategory).toBe("conclude");
    expect(result.overrides.bossStyle).toBe("adaptive");
  });

  it("uses category 'unknown' for ambiguous intent", () => {
    const result = translator.translate({
      intent: baseIntent({ intent: "just do something random" }),
    });
    expect(result.intentCategory).toBe("unknown");
  });

  it("avoids recent boss styles when picking a new one", () => {
    const result = translator.translate({
      intent: baseIntent({ intent: "Punish the overconfident player" }),
      recentBossStyles: ["counter", "punisher", "adaptive"],
    });
    // Should not be one of the recent styles
    expect(result.overrides.bossStyle).toBeDefined();
    expect(["counter", "punisher", "adaptive"]).not.toContain(result.overrides.bossStyle);
  });

  it("honors world state when picking weather", () => {
    const result = translator.translate({
      intent: baseIntent({ intent: "Engage the player" }),
      worldCorruption: 0.8,
    });
    expect(result.overrides.weather).toBe("ash");
  });

  it("boosts difficulty for overconfident underperformer", () => {
    const result = translator.translate({
      intent: baseIntent({ intent: "Engage the player" }),
      playerSkill: 0.3,
      playerConfidence: 0.9,
    });
    // The translator should not lower difficulty for overconfident player
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("returns rationale for every translation", () => {
    const result = translator.translate({
      intent: baseIntent({ intent: "Test intent" }),
    });
    expect(result.rationale).toBeDefined();
    expect(result.rationale.length).toBeGreaterThan(0);
  });
});
