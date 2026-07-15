// ============================================================================
// INTENT SCHEMA TESTS
// ============================================================================

import { describe, expect, it } from "bun:test";
import {
  INTENT_CATEGORIES,
  INTENT_OUTPUT_SCHEMA,
  categoriseIntent,
  type IntentOutput,
} from "../../src/lib/game/intent/IntentSchema";

describe("IntentSchema", () => {
  describe("INTENT_OUTPUT_SCHEMA", () => {
    it("has exactly five required fields", () => {
      expect(INTENT_OUTPUT_SCHEMA.required).toEqual([
        "intent",
        "reasoning",
        "expectedPlayerReaction",
        "highLevelPlan",
        "confidence",
      ]);
    });

    it("rejects additional properties", () => {
      expect((INTENT_OUTPUT_SCHEMA as { additionalProperties: boolean }).additionalProperties).toBe(false);
    });

    it("constrains confidence to [0, 1]", () => {
      const c = INTENT_OUTPUT_SCHEMA.properties.confidence as { minimum: number; maximum: number };
      expect(c.minimum).toBe(0);
      expect(c.maximum).toBe(1);
    });
  });

  describe("categoriseIntent", () => {
    const cases: Array<[string, string]> = [
      ["Break the overconfidence built from three straight wins", "punish"],
      ["Reward a frustrated player", "reward"],
      ["Teach the player a new combo string", "teach"],
      ["Cautious player — force them to commit", "challenge"],
      ["Conclude the campaign with a final encounter", "conclude"],
      ["A narrative beat before the climax", "narrative_beat"],
      ["Settle the player down after a tough fight", "settle"],
      ["Reintroduce the counter genome from earlier", "reintroduce"],
      ["Experiment with a new mechanic today", "experiment"],
      ["Turtling player — break the shell", "destabilise"],
      ["Escalate the encounter at the climax", "escalate"],
      ["De-escalate the player is overwhelmed", "de_escalate"],
      ["The player rolled panic — give them a controlled win", "reward"],
      ["Force engagement by using rushdown genome", "teach_defense"],
      ["Force them to commit using zoner genome", "teach_offense"],
      ["???", "unknown"],
    ];

    for (const [intent, expected] of cases) {
      it(`categorises "${intent}" as ${expected}`, () => {
        expect(categoriseIntent(intent)).toBe(expected);
      });
    }
  });

  describe("INTENT_CATEGORIES", () => {
    it("contains all 14 categories plus unknown", () => {
      expect(INTENT_CATEGORIES).toHaveLength(15);
      expect(INTENT_CATEGORIES).toContain("unknown");
    });
  });
});
