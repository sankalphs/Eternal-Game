// ============================================================================
// PROJECT ETERNAL — DIRECTOR V5 (Intent-Aware)
//
// V5 replaces the legacy "recommendedWeather/recommendedCamera/etc"
// overrides with INTENT-ONLY overrides. The fine-tuned Game Designer
// produces an IntentOutput; the IntentTranslator deterministically
// converts it into concrete DirectorPlanV3 overrides. The Director
// applies those overrides on top of the V3 baseline.
//
// V5 depends on:
//   - DirectorEngineV3       (the deterministic baseline — UNTOUCHED)
//   - IntentGameDesigner     (the new LLM entry point)
//   - IntentContextBuilder   (the new context builder)
//   - IntentTranslator       (the deterministic intent → Director plan)
//
// V3 is NOT MODIFIED. V5 is a thin wrapper. The combat engine, physics,
// renderer, and FSM are never touched.
// ============================================================================

import {
  DirectorEngineV3,
  type DirectorPlanV3,
  type DirectorV3Deps,
} from "./DirectorEngineV3";
import type {
  WeatherModifier, LightingModifier, CameraModifier, HazardModifier,
} from "../content/modifiers";
import type { BossStyleId } from "../content/boss_styles";
import type { DifficultyId } from "../content/difficulties";
import type { GameDesignContext } from "../gamedesigner/types";
import type { IntentGameDesigner, IntentDesignResult } from "../gamedesigner/IntentGameDesigner";
import type { IntentContextBuilder, IntentContextBundle } from "../intent/IntentContextBuilder";
import type { IntentTranslator } from "../intent/IntentTranslator";

export interface DirectorV5Deps extends DirectorV3Deps {
  gameDesigner: IntentGameDesigner;
  contextBuilder: IntentContextBuilder;
  translator: IntentTranslator;
  // The buildContextExtra fields are reused from V4 deps for the
  // context builder (genomeLibrary, narrativeState, currentDifficultyId,
  // arenaId, arenaDamage, activeHazardTypes, campaignResults)
  buildContextExtra: {
    genomeLibrary?: import("../gamedesigner/types").GenomeLibrarySnapshot | null;
    currentDifficultyId: DifficultyId;
    arenaId: string;
    arenaDamage: Record<string, number>;
    activeHazardTypes: string[];
    campaignResults: import("../gamedesigner/types").CampaignHistoryEntry[];
  };
  previousDirectorPlans: DirectorPlanV3[];
  modelConfidenceThreshold: number;
  // Player profile for the context builder (V5 needs it explicitly)
  playerProfile: import("../profiler/PlayerProfiler").PlayerProfile;
  // Boss memory for the context builder
  bossMemory?: import("../world/WorldState").BossMemory | null;
}

export interface DirectorPlanV5 extends DirectorPlanV3 {
  gameDesign: {
    used: boolean;
    confidence: number;
    promptVersion: string;
    explanation: string;
    sampleId: string;
    intent: import("../intent/IntentSchema").IntentOutput;
    intentCategory: import("../intent/IntentSchema").IntentCategory;
    translationRationale: string[];
  };
}

export class DirectorEngineV5 {
  private v3 = new DirectorEngineV3();

  async planFight(deps: DirectorV5Deps): Promise<DirectorPlanV5> {
    // 1. Run the deterministic V3 plan first (always — it's the safe baseline)
    const baseline: DirectorPlanV3 = this.v3.planFight(deps);

    // 2. Build the IntentContextBundle
    const ctxBundle: IntentContextBundle = deps.contextBuilder.build({
      playerProfile: deps.playerProfile,
      playerEstimate: deps.estimate,
      playerPrediction: deps.prediction,
      campaignPlan: deps.campaignPlan,
      chapterIndex: deps.chapterIndex,
      worldState: deps.worldState,
      previousDirectorPlans: deps.previousDirectorPlans,
      genomeLibrary: deps.buildContextExtra.genomeLibrary ?? null,
      narrativeState: deps.storyEvent,
      bossMemory: deps.bossMemory ?? null,
      currentDifficultyId: deps.buildContextExtra.currentDifficultyId,
      arenaId: deps.buildContextExtra.arenaId,
      arenaDamage: deps.buildContextExtra.arenaDamage,
      activeHazardTypes: deps.buildContextExtra.activeHazardTypes,
      campaignResults: deps.buildContextExtra.campaignResults,
    });

    // 3. Ask the IntentGameDesigner for the high-level intent
    const design: IntentDesignResult = await deps.gameDesigner.designIntent(
      ctxBundle.context as GameDesignContext,
    );

    // 4. Apply confidence / validation gate
    const used = design.confidence >= (deps.modelConfidenceThreshold ?? 0.5)
      && design.validated
      && !design.fellback;

    if (!used) {
      return {
        ...baseline,
        gameDesign: {
          used: false,
          confidence: design.confidence,
          promptVersion: design.promptVersion,
          explanation: design.explanation,
          sampleId: design.sampleId,
          intent: design.intent,
          intentCategory: "unknown",
          translationRationale: ["Model output rejected by confidence/validation gate"],
        },
      };
    }

    // 5. Translate intent → Director plan overrides
    const translation = deps.translator.translate({
      intent: design.intent,
      playerSkill: deps.estimate.skill,
      playerConfidence: deps.estimate.confidence,
      playerFrustration: 1 - deps.estimate.emotionalStability,
      worldCorruption: deps.worldState.corruptionLevel,
      worldHope: deps.worldState.hopeLevel,
      chapterEmotion: deps.campaignPlan.chapters[deps.chapterIndex]?.emotion,
      recentBossStyles: deps.previousDirectorPlans
        .slice(-5)
        .map(p => p.bossStyle),
      recentDifficulties: deps.previousDirectorPlans
        .slice(-5)
        .map(p => p.difficulty),
      availableGenomes: deps.buildContextExtra.genomeLibrary?.entries
        .map(e => e.style as BossStyleId)
        .filter(Boolean),
    });

    // 6. Apply overrides on top of baseline
    const finalPlan: DirectorPlanV3 = this.applyOverrides(baseline, translation);

    return {
      ...finalPlan,
      gameDesign: {
        used: true,
        confidence: design.confidence,
        promptVersion: design.promptVersion,
        explanation: design.explanation,
        sampleId: design.sampleId,
        intent: design.intent,
        intentCategory: translation.intentCategory,
        translationRationale: translation.rationale,
      },
    };
  }

  // --------------------------------------------------------------------------
  //  Apply translator overrides on top of the V3 baseline
  // --------------------------------------------------------------------------

  private applyOverrides(
    baseline: DirectorPlanV3,
    translation: import("../intent/IntentTranslator").IntentTranslation,
  ): DirectorPlanV3 {
    const o = translation.overrides;
    const out: DirectorPlanV3 = { ...baseline };

    if (o.intent) {
      out.intent = { ...baseline.intent, ...o.intent };
    }

    if (o.bossStyle) {
      out.bossStyle = o.bossStyle;
    }
    if (o.bossEmotion) {
      out.bossEmotion = o.bossEmotion;
    }
    if (o.dialogueStyle) {
      out.dialogueStyle = o.dialogueStyle;
    }
    if (o.difficulty) {
      out.difficulty = o.difficulty;
    }
    if (o.hazards) {
      out.hazards = this.translateHazards(o.hazards, baseline.weather);
    }
    if (o.camera) {
      out.camera = this.translateCamera(o.camera, baseline.camera);
    }
    if (o.weather) {
      out.weather = this.translateWeather(o.weather, baseline.weather);
    }
    if (o.lighting) {
      out.lighting = this.translateLighting(o.lighting, baseline.lighting);
    }
    if (o.intensityBias !== undefined) {
      out.cinematicMoments = baseline.cinematicMoments.map(m => ({
        ...m,
        intensity: clamp01(m.intensity + o.intensityBias!),
      }));
    }
    return out;
  }

  private translateWeather(
    weatherId: string,
    baseline: WeatherModifier,
  ): WeatherModifier {
    return { ...baseline, type: weatherId as WeatherModifier["type"] };
  }

  private translateLighting(
    lightingId: string,
    baseline: LightingModifier,
  ): LightingModifier {
    // Lighting ID is a high-level hint; the modifier is procedural,
    // so we just adjust tint/intensity based on the hint.
    const id = String(lightingId);
    if (id === "dark" || id === "blood") {
      return { ...baseline, intensity: Math.max(0.2, baseline.intensity * 0.5) };
    }
    if (id === "bright") {
      return { ...baseline, intensity: Math.min(1, baseline.intensity * 1.3) };
    }
    if (id === "eclipse") {
      return { ...baseline, tint: "#222244", intensity: Math.max(0.3, baseline.intensity * 0.6) };
    }
    if (id === "foggy") {
      return { ...baseline, intensity: Math.max(0.3, baseline.intensity * 0.7) };
    }
    return baseline;
  }

  private translateCamera(
    cameraId: string,
    baseline: CameraModifier,
  ): CameraModifier {
    const map: Record<string, Partial<CameraModifier>> = {
      wide:           { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 },
      close:          { zoom: 1.3, panX: 0, panY: -30, tilt: 0, shake: 0, followWeight: 0.5, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 },
      cinematic:      { zoom: 1.1, panX: 0, panY: -10, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0.08, chromaticAberration: 0 },
      handheld:       { zoom: 1.15, panX: 0, panY: 0, tilt: 0, shake: 1.5, followWeight: 0.8, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 },
      dynamic_zoom:   { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0.3, dynamicZoom: true, letterbox: 0, chromaticAberration: 0 },
      boss_focus:     { zoom: 1.25, panX: 80, panY: -20, tilt: 0, shake: 0.5, followWeight: 0, dynamicZoom: false, letterbox: 0.05, chromaticAberration: 0 },
      dutch_angle:    { zoom: 1.1, panX: 0, panY: 0, tilt: 0.15, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 },
      slow_zoom:      { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: true, letterbox: 0.06, chromaticAberration: 0 },
    };
    return { ...baseline, ...(map[cameraId] ?? {}) };
  }

  private translateHazards(
    hazardIds: string[],
    _weather: WeatherModifier,
  ): HazardModifier[] {
    return hazardIds.map(h => {
      // Map symbolic hazard ids to the procedural HazardModifier.
      // The Director is allowed to use "fog" / "fire_rain" as hints;
      // we translate them to the closest procedural preset.
      const id = String(h);
      if (id === "fog" || id === "low_visibility") {
        return {
          chipDamage: 0,
          spawnRate: 0.5,
          spawnDamage: 0,
          slipFactor: 0,
          windForce: 0,
          screenShake: 0,
          darkness: 0.3,
          visualType: "fog",
          visualColor: "#888888",
        };
      }
      if (id === "fire_rain" || id === "ember_rain") {
        return {
          chipDamage: 1,
          spawnRate: 0.3,
          spawnDamage: 5,
          slipFactor: 0,
          windForce: 0,
          screenShake: 0.1,
          darkness: 0,
          visualType: "ember",
          visualColor: "#ff5500",
        };
      }
      // Default
      return {
        chipDamage: 0,
        spawnRate: 0.1,
        spawnDamage: 0,
        slipFactor: 0,
        windForce: 0,
        screenShake: 0,
        darkness: 0,
        visualType: id,
        visualColor: "#ffffff",
      };
    });
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
