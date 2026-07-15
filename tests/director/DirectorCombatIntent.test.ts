import { describe, expect, test } from "bun:test";
import { applyDirectorCombatIntent } from "../../src/lib/game/director/DirectorRuntime";
import type { OpponentDef } from "../../src/lib/game/types";

const base: OpponentDef = {
  name: "Test", title: "Test", rim: "#fff", hp: 100, damageMul: 1,
  speedMul: 1, aggression: 0.6, blockChance: 0.5, reaction: 0.2,
  combo: 3, bg: "sunset", whiffPunish: 0.5, antiAir: 0.5,
  pressure: 0.5, mixup: 0.5, readDelay: 0.2, adaptive: 0.5,
  rage: 0.5, perfection: 0.5,
};

describe("Director combat intent", () => {
  test("revenge produces a faster, more punitive opponent", () => {
    const tuned = applyDirectorCombatIntent(base, "revenge", 1);
    expect(tuned.aggression).toBeGreaterThan(base.aggression);
    expect(tuned.whiffPunish).toBeGreaterThan(base.whiffPunish!);
    expect(tuned.reaction).toBeLessThan(base.reaction);
  });

  test("redemption makes the encounter more forgiving", () => {
    const tuned = applyDirectorCombatIntent(base, "redemption", 1);
    expect(tuned.aggression).toBeLessThan(base.aggression);
    expect(tuned.pressure).toBeLessThan(base.pressure!);
    expect(tuned.reaction).toBeGreaterThan(base.reaction);
  });

  test("zero confidence preserves authored behavior", () => {
    const tuned = applyDirectorCombatIntent(base, "defiance", 0);
    expect(tuned.aggression).toBe(base.aggression);
    expect(tuned.pressure).toBe(base.pressure);
  });
});
