// ============================================================================
// ADAPTER FACTORY SMOKE TEST
//
// Verifies that the AdapterFactory picks the right adapter based on
// environment variables, and that the resulting adapter can produce
// a valid IntentOutput for a sample GameDesignContext.
// ============================================================================

import fs from "fs";
import path from "path";
import { selectAdapter, createAIModelAdapter } from "../src/lib/game/ai/models/AdapterFactory";
import { IntentContextBuilder, categoriseIntent } from "../src/lib/game/intent";
import { IntentGameDesigner } from "../src/lib/game/gamedesigner/IntentGameDesigner";
import { PromptLibrary } from "../src/lib/game/gamedesigner/PromptLibrary";
import { GameDesignDatasetLogger } from "../src/lib/game/gamedesigner/GameDesignDatasetLogger";
import { ExplanationEngine } from "../src/lib/game/gamedesigner/ExplanationEngine";
import { validateIntentOutput } from "../src/lib/game/intent/IntentOutputValidator";
import type { GameDesignContext } from "../src/lib/game/gamedesigner/types";
import { DeterministicIntentMockAdapter } from "../src/lib/game/gamedesigner/IntentMockAdapter";

async function main() {
  const out: Record<string, unknown> = {};

  // 1. Check the adapter selection logic
  console.log("[Smoke] Test 1: AdapterFactory selects the right adapter");

  // Save & clear env vars to test default (mock)
  const savedEnv = { ...process.env };
  delete process.env.ETERNAL_MODEL_ENDPOINT;
  delete process.env.ETERNAL_MODEL_PATH;
  delete process.env.ETERNAL_REMOTE_API_URL;
  delete process.env.ETERNAL_USE_OLLAMA;

  const mockSel = selectAdapter();
  out.mock_kind = mockSel.kind;
  out.mock_id = mockSel.model.metadata().id;
  console.log(`  mock kind=${mockSel.kind} id=${mockSel.model.metadata().id}`);

  // Test fine-tuned selection (without actually loading)
  process.env.ETERNAL_MODEL_ENDPOINT = "https://test.modal.run";
  const ftSel = selectAdapter();
  out.endpoint_kind = ftSel.kind;
  out.endpoint_id = ftSel.model.metadata().id;
  console.log(`  endpoint kind=${ftSel.kind} id=${ftSel.model.metadata().id}`);

  // Test local model selection
  delete process.env.ETERNAL_MODEL_ENDPOINT;
  process.env.ETERNAL_MODEL_PATH = "/tmp/fake-model";
  const localSel = selectAdapter();
  out.local_kind = localSel.kind;
  out.local_id = localSel.model.metadata().id;
  console.log(`  local kind=${localSel.kind} id=${localSel.model.metadata().id}`);

  // Restore env
  process.env = savedEnv;

  // 2. Run the full pipeline with the mock adapter
  console.log("[Smoke] Test 2: IntentGameDesigner end-to-end (intent mock)");

  const designer = new IntentGameDesigner({
    model: new DeterministicIntentMockAdapter(),
    promptLibrary: new PromptLibrary("v4"),
    dataset: new GameDesignDatasetLogger(),
    explanations: new ExplanationEngine(),
  });
  await designer.setPromptVersion("v4");

  const ctx: GameDesignContext = {
    version: 1,
    playerProfile: {} as never,
    playerEstimate: {
      skill: 0.5, confidence: 0.7, patience: 0.4,
      adaptability: 0.5, curiosity: 0.5,
      emotionalStability: 0.6, frustrationTolerance: 0.5,
    } as never,
    playerPrediction: {
      kickSpam: 0.2, earlyRush: 0.6, panicRoll: 0.3,
      superSave: 0.1, blockTurtle: 0.1, whiff: 0.1,
    } as never,
    campaignPlan: { totalChapters: 8, chapters: [] } as never,
    currentChapter: { chapterIndex: 4, emotion: "tension", bossStyle: "aggressive", difficulty: "hard" } as never,
    campaignHistory: { entries: [], currentChapterIndex: 4, totalChapters: 8, completedChapters: 4, winRate: 0.6, averageDamageRatio: 0.55 },
    worldState: { corruptionLevel: 0.45, hopeLevel: 0.4, worldFear: 0.6, bloodMoonActive: false, eventCount: 2, sealsBroken: 0, arenaDamage: {}, weatherHistory: [] } as never,
    previousDirectorPlans: { recent: [], totalStored: 0 },
    genomeLibrary: { version: "0.0.0", baseOpponent: "default", entries: [] },
    narrativeState: null,
    emotionalCurve: { currentEmotion: "confidence", currentIntensity: 0.7, trajectory: "rising" },
    bossMemory: null,
    currentDifficulty: { id: "hard", label: "Hard", modifiers: { damageMul: 1.2, speedMul: 1.1, aiAggression: 0.7 } },
    arenaState: { arenaId: "default", stage: 0, damageLevel: 0, visibleCracks: 0, activeHazardTypes: [] },
    topline: {
      recentWinStreak: 3,
      recentLossStreak: 0,
      dominantStrategy: "rushdown",
      biggestWeakness: "panicRoll",
      strongestTrait: "aggression",
      currentMood: "overconfident",
      worldTrajectory: "darkening",
      narrativePhase: "rising",
      recommendedPosture: "punish",
    },
  } as unknown as GameDesignContext;

  const t0 = Date.now();
  const result = await designer.designIntent(ctx);
  const latency = Date.now() - t0;

  out.designer = {
    sampleId: result.sampleId,
    intent: result.intent,
    latencyMs: latency,
    validated: result.validated,
    fellback: result.fellback,
  };
  console.log(`  intent="${result.intent.intent}"`);
  console.log(`  reasoning="${result.intent.reasoning.slice(0, 80)}..."`);
  console.log(`  confidence=${result.intent.confidence.toFixed(2)} latency=${latency}ms`);

  // 3. Validate the output
  console.log("[Smoke] Test 3: validateIntentOutput");
  const validation = validateIntentOutput(result.intent);
  out.validation = {
    errors: validation.errors,
    warnings: validation.warnings,
    passed: validation.errors.length === 0,
  };
  console.log(`  passed=${validation.errors.length === 0}`);
  if (validation.errors.length > 0) {
    console.log(`  errors: ${validation.errors.join(", ")}`);
  }

  // 4. Test all 11 sample origins can be generated
  console.log("[Smoke] Test 4: categoriseIntent works for all expected categories");
  const tests: [string, string][] = [
    ["Break the overconfidence built from three straight wins", "punish"],
    ["Reward a frustrated player with a winnable fight", "reward"],
    ["Teach the player a new combo string", "teach"],
    ["Force engagement by using rushdown genome", "teach_defense"],
    ["Conclude the campaign with a final encounter", "conclude"],
    ["A narrative beat before the climax", "narrative_beat"],
    ["Settle the player down after a tough fight", "settle"],
    ["Reintroduce the counter genome from earlier", "reintroduce"],
    ["Experiment with a new mechanic today", "experiment"],
    ["Turtling player — break the shell", "destabilise"],
    ["Escalate the encounter at the climax", "escalate"],
    ["De-escalate the player is overwhelmed", "de_escalate"],
    ["The player rolled panic — give them a controlled win", "reward"],
    ["Force them to commit using zoner genome", "teach_offense"],
  ];
  out.categorisation = tests.map(([intent, expected]) => {
    const got = categoriseIntent(intent);
    return { input: intent, expected, got, match: got === expected };
  });
  const allMatch = out.categorisation.every((t: any) => t.match);
  console.log(`  ${out.categorisation.length} tests, all match: ${allMatch}`);
  if (!allMatch) {
    for (const t of out.categorisation) {
      if (!t.match) console.log(`    MISMATCH: "${t.input}" expected ${t.expected}, got ${t.got}`);
    }
  }

  // Write
  const outPath = path.join(process.cwd(), "eval_results", "adapter_smoke.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log(`[Smoke] Wrote ${outPath}`);

  // Final status
  const ok =
    out.mock_kind === "mock" &&
    out.endpoint_kind === "fine_tuned" &&
    out.local_kind === "fine_tuned" &&
    out.designer.validated === true &&
    out.validation.passed &&
    allMatch;
  console.log(`[Smoke] Result: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[Smoke] Fatal:", err);
  process.exit(1);
});
