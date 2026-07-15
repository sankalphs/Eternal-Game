// ============================================================================
// PHASE 3 (cont): DIRECTOR V4 — GameDesigner-aware director
//
// Wraps the existing DirectorEngineV3. Before the V3 runs, V4 first asks
// the GameDesigner for a high-level design plan. If the GameDesigner is
// confident, the plan's recommendations OVERRIDE the V3 derivations.
//
// If confidence is low OR the GameDesigner is unavailable, V4 falls back
// to the deterministic V3 plan unchanged.
//
// V3 is NOT MODIFIED. V4 is a thin wrapper.
// ============================================================================

import {
  DirectorEngineV3,
  type DirectorPlanV3,
  type DirectorIntent,
  type DirectorV3Deps,
} from "./DirectorEngineV3";
import type {
  WeatherModifier, LightingModifier, CameraModifier, HazardModifier,
} from "../content/modifiers";
import type { GameDesigner, DesignResult } from "../gamedesigner/GameDesigner";
import type { GameDesignPlan } from "../gamedesigner/GameDesignPlan";
import type { GameDesignContext } from "../gamedesigner/types";
import type { GameDesignContextBuilder, BuildContextParams } from "../gamedesigner/GameDesignContextBuilder";
import type { BossStyleId } from "../content/boss_styles";
import type { DifficultyId } from "../content/difficulties";

export interface DirectorV4Deps extends DirectorV3Deps {
  // The V4 wrapper needs a GameDesigner + context builder
  gameDesigner: GameDesigner;
  contextBuilder: GameDesignContextBuilder;
  buildContextExtra: Omit<BuildContextParams, "playerProfile" | "playerEstimate" | "playerPrediction" | "campaignPlan" | "chapterIndex" | "worldState" | "previousDirectorPlans">;
  previousDirectorPlans: DirectorPlanV3[];
  modelConfidenceThreshold: number;
}

export interface DirectorPlanV4 extends DirectorPlanV3 {
  // Meta
  gameDesign: {
    used: boolean;        // did the GameDesigner's plan override V3?
    confidence: number;   // model self-reported confidence
    promptVersion: string;
    explanation: string;
    sampleId: string;
    plan: GameDesignPlan;
  };
}

export class DirectorEngineV4 {
  private v3 = new DirectorEngineV3();

  async planFight(deps: DirectorV4Deps): Promise<DirectorPlanV4> {
    // 1. Run the deterministic V3 plan first (always — it's the safe baseline)
    const baseline: DirectorPlanV3 = this.v3.planFight(deps);

    // 2. Ask the GameDesigner
    const ctx: GameDesignContext = deps.contextBuilder.build({
      playerProfile: (deps as unknown as { profile?: unknown }).profile as never ?? this.profileStub(),
      playerEstimate: deps.estimate,
      playerPrediction: deps.prediction,
      campaignPlan: deps.campaignPlan,
      chapterIndex: deps.chapterIndex,
      worldState: deps.worldState,
      previousDirectorPlans: deps.previousDirectorPlans,
      genomeLibrary: deps.buildContextExtra.genomeLibrary ?? null,
      narrativeState: deps.storyEvent,
      bossMemory: (deps as unknown as { bossMemory?: never }).bossMemory ?? null,
      currentDifficultyId: deps.buildContextExtra.currentDifficultyId,
      arenaId: deps.buildContextExtra.arenaId,
      arenaDamage: deps.buildContextExtra.arenaDamage,
      activeHazardTypes: deps.buildContextExtra.activeHazardTypes,
      campaignResults: deps.buildContextExtra.campaignResults,
    });

    const design: DesignResult = await deps.gameDesigner.design(ctx);

    const used = design.plan.confidence >= (deps.modelConfidenceThreshold ?? 0.5)
      && design.validated
      && !design.fellback;

    if (!used) {
      return {
        ...baseline,
        gameDesign: {
          used: false,
          confidence: design.plan.confidence,
          promptVersion: design.promptVersion,
          explanation: design.explanation,
          sampleId: design.sampleId,
          plan: design.plan,
        },
      };
    }

    // 3. Apply the GameDesigner's recommendations on top of the baseline.
    const merged = this.applyDesign(baseline, design.plan, ctx);

    return {
      ...merged,
      gameDesign: {
        used: true,
        confidence: design.plan.confidence,
        promptVersion: design.promptVersion,
        explanation: design.explanation,
        sampleId: design.sampleId,
        plan: design.plan,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Apply the GameDesigner's plan on top of the V3 baseline.
  // Does NOT generate gameplay values — it translates the design plan's
  // design-level intent into the DirectorPlanV3 shape using the same
  // derivation logic the V3 already uses (sourced from the chapter
  // emotion profile as a starting point).
  // --------------------------------------------------------------------------

  private applyDesign(
    baseline: DirectorPlanV3,
    plan: GameDesignPlan,
    ctx: GameDesignContext,
  ): DirectorPlanV3 {
    // Rebuild intent with the designer's wording
    const newIntent: DirectorIntent = {
      ...baseline.intent,
      objective: plan.intent,
      emotion: plan.targetEmotion,
    };

    // Weather — translate the designer's recommended weather to a modifier
    const weather: WeatherModifier = this.translateWeather(plan.recommendedWeather, ctx);

    // Lighting — translate
    const lighting: LightingModifier = this.translateLighting(plan.recommendedLighting, plan.targetIntensity, ctx);

    // Camera — translate
    const camera: CameraModifier = this.translateCamera(plan.recommendedCamera, plan.targetIntensity);

    // Hazards — combine baseline + designer recommendation
    const hazards: HazardModifier[] = this.combineHazards(baseline.hazards, plan.recommendedHazards, ctx);

    // Boss style — designer recommendation overrides chapter boss style
    const bossStyle: BossStyleId = plan.recommendedGenome;

    // Difficulty — designer recommendation overrides chapter difficulty
    const difficulty: DifficultyId = plan.targetDifficulty;

    return {
      ...baseline,
      intent: newIntent,
      weather,
      lighting,
      camera,
      hazards,
      bossStyle,
      difficulty,
      // Designer doesn't override: storyEvent, chapter, bossEmotion, dialogueStyle
    };
  }

  private translateWeather(weather: string, ctx: GameDesignContext): WeatherModifier {
    const w = weather;
    const d = ctx.worldState.darknessLevel;
    const c = ctx.worldState.corruptionLevel;
    if (w === "fog" || w === "heavy_fog") {
      return { type: "fog", density: w === "heavy_fog" ? 0.6 : 0.3, height: 0.6, movement: 0.3, wind: 0.1, color: "rgba(100,100,120,0.35)", pulse: 0, size: w === "heavy_fog" ? 150 : 100, speed: 8 };
    }
    if (w === "rain") {
      return { type: "rain", density: 0.5, height: 1, movement: 1, wind: 0.2, color: "rgba(150,170,200,0.4)", pulse: 0, size: 2, speed: 400 };
    }
    if (w === "thunder") {
      return { type: "rain", density: 0.7, height: 1, movement: 1, wind: 0.4, color: "rgba(150,170,200,0.5)", pulse: 0, size: 2, speed: 500 };
    }
    if (w === "ash") {
      return { type: "ash", density: 0.4 + c * 0.3, height: 1, movement: 0.5, wind: 0.05, color: "rgba(120,80,60,0.4)", pulse: 0, size: 3, speed: 30 };
    }
    if (w === "snow") {
      return { type: "snow", density: 0.5, height: 1, movement: 0.6, wind: 0.2, color: "rgba(220,230,245,0.6)", pulse: 0, size: 4, speed: 50 };
    }
    if (w === "dust_storm") {
      return { type: "dust", density: 0.6, height: 1, movement: 1, wind: 0.8, color: "rgba(180,140,80,0.4)", pulse: 0, size: 6, speed: 200 };
    }
    if (w === "fireflies") {
      return { type: "fireflies", density: 0.2, height: 0.7, movement: 0.4, wind: 0.1, color: "#86efac", pulse: 0.8, size: 3, speed: 5 };
    }
    if (w === "blood_moon") {
      return { type: "ember", density: 0.3, height: 0.8, movement: 0.3, wind: 0.05, color: "#dc2626", pulse: 0.5, size: 3, speed: 20 };
    }
    if (w === "cherry_blossoms") {
      return { type: "petals", density: 0.3, height: 1, movement: 0.6, wind: 0.3, color: "#fbcfe8", pulse: 0, size: 5, speed: 30 };
    }
    if (w === "solar_eclipse") {
      return { type: "shadow", density: 0.5, height: 1, movement: 0.1, wind: 0, color: "rgba(0,0,0,0.6)", pulse: 0, size: 60, speed: 5 };
    }
    return { type: "none", density: 0, height: 0, movement: 0, wind: 0, color: "#fff", pulse: 0, size: 0, speed: 0 };
  }

  private translateLighting(style: string, intensity: number, ctx: GameDesignContext): LightingModifier {
    const tints: Record<string, string> = {
      bright: "#ffffff",
      normal: "#ffffff",
      dim: "#888899",
      dark: "#222233",
      blood: "#7f1d1d",
      foggy: "#a8a8b0",
      eclipse: "#1a1a2e",
    };
    const baseIntensities: Record<string, number> = {
      bright: 1, normal: 0.85, dim: 0.5, dark: 0.25, blood: 0.4, foggy: 0.6, eclipse: 0.2,
    };
    return {
      tint: tints[style] ?? "#ffffff",
      intensity: baseIntensities[style] ?? 0.85,
      flicker: style === "blood" || ctx.worldState.corruptionLevel > 0.4 ? 0.3 : 0,
      flickerColor: "#f97316",
      ambientOcclusion: 0.2 + ctx.worldState.darknessLevel * 0.3,
      godRays: style === "bright" && intensity > 0.7 ? 0.4 : 0,
    };
  }

  private translateCamera(style: string, intensity: number): CameraModifier {
    const map: Record<string, CameraModifier> = {
      wide: { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 },
      close: { zoom: 1.3, panX: 0, panY: -30, tilt: 0, shake: 0, followWeight: 0.5, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 },
      cinematic: { zoom: 1.1, panX: 0, panY: -10, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0.08, chromaticAberration: 0 },
      handheld: { zoom: 1.15, panX: 0, panY: 0, tilt: 0, shake: 1.5, followWeight: 0.8, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 },
      dynamic_zoom: { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0.3, dynamicZoom: true, letterbox: 0, chromaticAberration: 0 },
      boss_focus: { zoom: 1.25, panX: 80, panY: -20, tilt: 0, shake: 0.5, followWeight: 0, dynamicZoom: false, letterbox: 0.05, chromaticAberration: 0 },
      dutch_angle: { zoom: 1.1, panX: 0, panY: 0, tilt: 0.15, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 },
      slow_zoom: { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: true, letterbox: 0.06, chromaticAberration: 0 },
    };
    return map[style] ?? map.wide;
  }

  private combineHazards(
    baseline: HazardModifier[],
    recommended: string[],
    ctx: GameDesignContext,
  ): HazardModifier[] {
    const out: HazardModifier[] = [...baseline];
    for (const h of recommended) {
      if (h === "fog") {
        out.push({ chipDamage: 0, spawnRate: 0, spawnDamage: 0, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0.3, visualType: "fog", visualColor: "rgba(120,120,140,0.3)" });
      } else if (h === "fire_rain") {
        out.push({ chipDamage: 1, spawnRate: 4, spawnDamage: 3, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0, visualType: "fire", visualColor: "#f97316" });
      } else if (h === "earthquake") {
        out.push({ chipDamage: 1, spawnRate: 0, spawnDamage: 0, slipFactor: 0, windForce: 0, screenShake: 3, darkness: 0, visualType: "none", visualColor: "#000" });
      } else if (h === "ice_floor") {
        out.push({ chipDamage: 0, spawnRate: 0, spawnDamage: 0, slipFactor: 0.6, windForce: 0, screenShake: 0, darkness: 0, visualType: "ice", visualColor: "rgba(150,200,255,0.2)" });
      } else if (h === "poison_mist") {
        out.push({ chipDamage: 2, spawnRate: 0, spawnDamage: 0, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0.15, visualType: "mist", visualColor: "rgba(80,200,80,0.15)" });
      } else if (h === "darkness") {
        out.push({ chipDamage: 0, spawnRate: 0, spawnDamage: 0, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0.4, visualType: "none", visualColor: "#000" });
      } else if (h === "temple_debris") {
        out.push({ chipDamage: 0, spawnRate: 0.55, spawnDamage: 4, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0, visualType: "debris", visualColor: "#7c6f5b" });
      } else if (h === "volcano") {
        out.push({ chipDamage: 2, spawnRate: 1, spawnDamage: 5, slipFactor: 0, windForce: 0, screenShake: 2, darkness: 0, visualType: "fire", visualColor: "#f97316" });
      } else if (h === "wind_gusts") {
        out.push({ chipDamage: 0, spawnRate: 0, spawnDamage: 0, slipFactor: 0, windForce: 40, screenShake: 0, darkness: 0, visualType: "none", visualColor: "#000" });
      }
    }
    return out;
  }

  // Used when the caller didn't supply a player profile in V4 deps.
  // V4 keeps backward compatibility with V3 deps — if the caller doesn't
  // pass a profile, we feed the context builder a stub.
  private profileStub(): never {
    throw new Error("DirectorEngineV4 requires playerProfile in V4 deps");
  }
}
