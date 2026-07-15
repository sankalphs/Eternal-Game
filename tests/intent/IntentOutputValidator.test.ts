// ============================================================================
// INTENT VALIDATOR TESTS
// ============================================================================

import { describe, expect, it } from "bun:test";
import { validateIntentOutput } from "../../src/lib/game/intent/IntentOutputValidator";

describe("validateIntentOutput", () => {
  it("accepts a valid intent output", () => {
    const result = validateIntentOutput({
      intent: "Break the overconfidence",
      reasoning: "Three straight wins, the player is overconfident. Punish.",
      expectedPlayerReaction: "Player starts spacing and reading the boss",
      highLevelPlan: "A counter encounter that punishes dash-in approaches.",
      confidence: 0.85,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.output.confidence).toBe(0.85);
  });

  it("rejects non-object input", () => {
    const result = validateIntentOutput("not an object");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.output.confidence).toBe(0);
  });

  it("rejects missing required fields", () => {
    const result = validateIntentOutput({ intent: "test" });
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects non-string intent", () => {
    const result = validateIntentOutput({
      intent: 42,
      reasoning: "test reasoning that's long enough",
      expectedPlayerReaction: "some reaction",
      highLevelPlan: "some plan that's long enough",
      confidence: 0.5,
    });
    expect(result.errors).toContain("field \"intent\" must be a string");
  });

  it("clamps confidence > 1 to 1", () => {
    const result = validateIntentOutput({
      intent: "test",
      reasoning: "test reasoning that's long enough",
      expectedPlayerReaction: "some reaction",
      highLevelPlan: "some plan that's long enough",
      confidence: 1.5,
    });
    expect(result.output.confidence).toBe(1);
  });

  it("clamps confidence < 0 to 0", () => {
    const result = validateIntentOutput({
      intent: "test",
      reasoning: "test reasoning that's long enough",
      expectedPlayerReaction: "some reaction",
      highLevelPlan: "some plan that's long enough",
      confidence: -0.5,
    });
    expect(result.output.confidence).toBe(0);
  });

  it("warns on unknown fields but still passes", () => {
    const result = validateIntentOutput({
      intent: "test",
      reasoning: "test reasoning that's long enough",
      expectedPlayerReaction: "some reaction",
      highLevelPlan: "some plan that's long enough",
      confidence: 0.5,
      extra: "should be ignored",
      weather: "should also be ignored",
    });
    expect(result.warnings.some(w => w.includes("extra"))).toBe(true);
    expect(result.warnings.some(w => w.includes("weather"))).toBe(true);
  });
});
