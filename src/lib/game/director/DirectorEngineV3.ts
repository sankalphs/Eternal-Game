// ============================================================================
// DIRECTOR V3 — campaign-first director that consumes the full pipeline.
//
// Pipeline: Player → Telemetry → PlayerAnalyzer → PredictionEngine →
//           CampaignPlanner → NarrativeEngine → DirectorV3 → GameEngine
//
// The Director begins every plan with INTENT. Everything else derives from it.
// The Director NEVER runs during combat. It plans the EXPERIENCE, not the fight.
// ============================================================================

import type { PlayerEstimate } from "../prediction/PlayerAnalyzer";
import type { PlayerPrediction } from "../prediction/PredictionEngine";
import type { CampaignPlan, CampaignChapter, CuriosityExperiment } from "../campaign/CampaignPlanner";
import type { DerivedWorldState } from "../eventsourcing/WorldHistory";
import type { WeatherModifier, LightingModifier, CameraModifier, HazardModifier } from "../content/modifiers";
import type { BossStyleId } from "../content/boss_styles";
import type { DifficultyId } from "../content/difficulties";
import type { StoryEvent } from "../narrative/NarrativeEngine";

// The Director's intent — the emotional/narrative purpose of this fight
export interface DirectorIntent {
  objective: string;            // what the Director wants to achieve
  emotion: string;              // the target emotion for this fight
  narrativePurpose: string;     // why this fight exists in the story
  playerExperienceGoal: string; // what the player should feel
}

export interface DirectorPlanV3 {
  // The intent — everything else derives from this
  intent: DirectorIntent;

  // Narrative context
  storyEvent: StoryEvent | null;

  // The campaign chapter this plan belongs to
  chapter: CampaignChapter | null;

  // Environmental modifiers (derived from intent + emotion)
  weather: WeatherModifier;
  lighting: LightingModifier;
  camera: CameraModifier;
  hazards: HazardModifier[];

  // Boss configuration (derived from intent + prediction)
  bossStyle: BossStyleId;
  bossEmotion: string;
  dialogueStyle: "taunting" | "cold" | "rage" | "calm" | "despair" | "none";

  // Difficulty (derived from intent + player skill)
  difficulty: DifficultyId;

  // Cinematic moments (derived from emotion intensity)
  cinematicMoments: { trigger: string; action: string; duration: number; intensity: number }[];

  // Curiosity experiment (if any)
  experiment: CuriosityExperiment | null;

  // World events to record after this fight
  pendingWorldEvents: string[];
}

export interface DirectorV3Deps {
  estimate: PlayerEstimate;
  prediction: PlayerPrediction;
  worldState: DerivedWorldState;
  campaignPlan: CampaignPlan;
  chapterIndex: number;
  storyEvent: StoryEvent | null;
}

export class DirectorEngineV3 {
  /**
   * Plan a single fight from the campaign. The campaign plan already defines
   * the emotional arc, boss style, and difficulty — the Director's job is to
   * translate that into concrete modifiers the engine can execute.
   */
  planFight(deps: DirectorV3Deps): DirectorPlanV3 {
    const { estimate, prediction, worldState, campaignPlan, chapterIndex, storyEvent } = deps;
    const chapter = campaignPlan.chapters[chapterIndex] ?? null;

    if (!chapter) {
      return this.fallbackPlan(deps);
    }

    // 1. Form the INTENT from the chapter's emotional beat
    const intent: DirectorIntent = {
      objective: this.deriveObjective(chapter.emotion, prediction),
      emotion: chapter.emotion,
      narrativePurpose: chapter.narrativePurpose,
      playerExperienceGoal: chapter.targetExperience,
    };

    // 2. Derive weather from intent (not independently selected)
    const weather = this.deriveWeather(intent, worldState, chapter.emotionProfile);

    // 3. Derive lighting from intent
    const lighting = this.deriveLighting(intent, worldState, chapter.emotionProfile);

    // 4. Derive camera from intent
    const camera = this.deriveCamera(intent, chapter.emotionProfile, chapter.emotionalBeat.intensity);

    // 5. Derive hazards from intent + prediction (counter the player)
    const hazards = this.deriveHazards(intent, prediction, worldState, chapterIndex);

    // 6. Boss style — from chapter (already set by CampaignPlanner)
    const bossStyle = chapter.bossStyle;
    const bossEmotion = storyEvent?.bossEmotion ?? chapter.emotionProfile.dialogue;
    const dialogueStyle = chapter.emotionProfile.dialogue as DirectorPlanV3["dialogueStyle"];

    // 7. Difficulty — from chapter
    const difficulty = chapter.difficulty;

    // 8. Cinematic moments — from emotion intensity
    const cinematicMoments = this.deriveCinematicMoments(chapter.emotionalBeat.intensity, chapterIndex);

    // 9. Apply curiosity experiment if present
    const experiment = chapter.experiment;
    if (experiment) {
      return this.applyExperiment({
        intent, storyEvent, chapter, weather, lighting, camera, hazards,
        bossStyle, bossEmotion, dialogueStyle, difficulty, cinematicMoments,
        experiment, pendingWorldEvents: this.deriveWorldEvents(chapter),
      }, experiment);
    }

    return {
      intent, storyEvent, chapter,
      weather, lighting, camera, hazards,
      bossStyle, bossEmotion, dialogueStyle, difficulty,
      cinematicMoments, experiment: null,
      pendingWorldEvents: this.deriveWorldEvents(chapter),
    };
  }

  // ---- Intent derivation ----

  private deriveObjective(emotion: string, prediction: PlayerPrediction): string {
    switch (emotion) {
      case "wonder": return "Introduce the world gently. Let the player explore.";
      case "confidence": return "Let the player win easily. Build their ego.";
      case "suspicion": return "Make the player uncomfortable. Something is wrong.";
      case "fear": return "Threaten the player. Make them doubt their skills.";
      case "hopelessness": return "Push the player to their limit. Test their resolve.";
      case "determination": return "Give the player a reason to fight on.";
      case "rage": return "Unleash chaos. The world burns.";
      case "victory": return "Catharsis. Let the player triumph.";
      case "curiosity": return "Make the player ask questions.";
      case "chaos": return "Disorient the player. Break their assumptions.";
      case "isolation": return "Make the player feel alone.";
      case "despair": return "Show the player what they have done.";
      case "serene": return "Give the player peace.";
      case "awe": return "Show the player the magnitude of their journey.";
      case "triumph": return "Let the player savor victory.";
      default: return "Engage the player.";
    }
  }

  // ---- Weather derivation (from intent, not independently) ----

  private deriveWeather(
    intent: DirectorIntent,
    world: DerivedWorldState,
    profile: { weather: string },
  ): WeatherModifier {
    const w = profile.weather;
    // Map the emotion profile's weather to a procedural modifier
    if (w === "fog" || w === "heavy_fog") {
      return { type: "fog", density: world.darknessLevel > 0.5 ? 0.5 : 0.3, height: 0.6, movement: 0.3, wind: 0.1, color: "rgba(100,100,120,0.35)", pulse: 0, size: 100, speed: 8 };
    }
    if (w === "rain") {
      return { type: "rain", density: 0.5, height: 1, movement: 1, wind: 0.2, color: "rgba(150,170,200,0.4)", pulse: 0, size: 2, speed: 400 };
    }
    if (w === "thunder") {
      return { type: "rain", density: 0.7, height: 1, movement: 1, wind: 0.4, color: "rgba(150,170,200,0.5)", pulse: 0, size: 2, speed: 500 };
    }
    if (w === "ash") {
      return { type: "ash", density: 0.4 + world.corruptionLevel * 0.3, height: 1, movement: 0.5, wind: 0.05, color: "rgba(120,80,60,0.4)", pulse: 0, size: 3, speed: 30 };
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
    if (w === "dust_storm") {
      return { type: "dust", density: 0.6, height: 1, movement: 1, wind: 0.8, color: "rgba(180,140,80,0.4)", pulse: 0, size: 6, speed: 200 };
    }
    if (w === "solar_eclipse") {
      return { type: "shadow", density: 0.5, height: 1, movement: 0.1, wind: 0, color: "rgba(0,0,0,0.6)", pulse: 0, size: 60, speed: 5 };
    }
    if (w === "fire_rain") {
      return { type: "ember", density: 0.6, height: 1, movement: 0.8, wind: 0.1, color: "#f97316", pulse: 0.3, size: 3, speed: 200 };
    }
    // Clear / default
    return { type: "none", density: 0, height: 0, movement: 0, wind: 0, color: "#fff", pulse: 0, size: 0, speed: 0 };
  }

  // ---- Lighting derivation ----

  private deriveLighting(
    intent: DirectorIntent,
    world: DerivedWorldState,
    profile: { lighting: string; lightingIntensity: number },
  ): LightingModifier {
    return {
      tint: profile.lighting,
      intensity: profile.lightingIntensity * (1 - world.darknessLevel * 0.3),
      flicker: world.corruptionLevel > 0.4 ? 0.3 : 0,
      flickerColor: "#f97316",
      ambientOcclusion: 0.2 + world.darknessLevel * 0.3,
      godRays: intent.emotion === "wonder" || intent.emotion === "curiosity" ? 0.3 : 0,
    };
  }

  // ---- Camera derivation ----

  private deriveCamera(
    intent: DirectorIntent,
    profile: { camera: string },
    intensity: number,
  ): CameraModifier {
    const cam = profile.camera;
    if (cam === "close") return { zoom: 1.3, panX: 0, panY: -30, tilt: 0, shake: 0, followWeight: 0.5, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 };
    if (cam === "cinematic") return { zoom: 1.1, panX: 0, panY: -10, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0.08, chromaticAberration: 0 };
    if (cam === "handheld") return { zoom: 1.15, panX: 0, panY: 0, tilt: 0, shake: 1.5, followWeight: 0.8, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 };
    if (cam === "dynamic_zoom") return { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0.3, dynamicZoom: true, letterbox: 0, chromaticAberration: 0 };
    if (cam === "boss_focus") return { zoom: 1.25, panX: 80, panY: -20, tilt: 0, shake: 0.5, followWeight: 0, dynamicZoom: false, letterbox: 0.05, chromaticAberration: 0 };
    if (cam === "dutch_angle") return { zoom: 1.1, panX: 0, panY: 0, tilt: 0.15, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 };
    if (cam === "slow_zoom") return { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: true, letterbox: 0.06, chromaticAberration: 0 };
    return { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 };
  }

  // ---- Hazard derivation (counters the player's predictions) ----

  private deriveHazards(
    intent: DirectorIntent,
    prediction: PlayerPrediction,
    world: DerivedWorldState,
    chapterIndex: number,
  ): HazardModifier[] {
    const hazards: HazardModifier[] = [];

    // If the player avoids hazards, add more to pressure them
    if (chapterIndex >= 2 && prediction.hazardAvoid > 0.5) {
      hazards.push({ chipDamage: 0, spawnRate: 0.55, spawnDamage: 4, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0, visualType: "debris", visualColor: "#7c6f5b" });
    }
    // If the player turtles, add chip damage to force movement
    if (prediction.blockTurtle > 0.6) {
      hazards.push({ chipDamage: 2, spawnRate: 0, spawnDamage: 0, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0.15, visualType: "mist", visualColor: "rgba(80,200,80,0.15)" });
    }
    // If the world is corrupt, add environmental decay
    if (world.corruptionLevel > 0.5 && chapterIndex >= 3) {
      hazards.push({ chipDamage: 1, spawnRate: 4, spawnDamage: 3, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0, visualType: "fire", visualColor: "#f97316" });
    }
    // High-intensity emotions get earthquake
    if (intent.emotion === "rage" || intent.emotion === "chaos") {
      hazards.push({ chipDamage: 1, spawnRate: 0, spawnDamage: 0, slipFactor: 0, windForce: 0, screenShake: 3, darkness: 0, visualType: "none", visualColor: "#000" });
    }

    return hazards;
  }

  // ---- Cinematic moments ----

  private deriveCinematicMoments(intensity: number, chapterIndex: number): DirectorPlanV3["cinematicMoments"] {
    const moments: DirectorPlanV3["cinematicMoments"] = [
      { trigger: "round_start", action: "slow_zoom", duration: 2, intensity: intensity * 0.5 },
      { trigger: "first_hit", action: "shake", duration: 0.3, intensity: intensity * 0.6 },
    ];
    if (intensity > 0.7) {
      moments.push({ trigger: "low_hp", action: "letterbox", duration: 1, intensity });
      moments.push({ trigger: "ko", action: "freeze_frame", duration: 0.5, intensity: 1 });
    }
    if (chapterIndex >= 5) {
      moments.push({ trigger: "super_used", action: "flash", duration: 0.4, intensity: 0.9 });
    }
    return moments;
  }

  // ---- Curiosity experiment application ----

  private applyExperiment(plan: DirectorPlanV3, exp: CuriosityExperiment): DirectorPlanV3 {
    const modified = { ...plan };
    switch (exp.modification) {
      case "no_music":
        // The score is fixed and independent of Director intent.
        modified.intent = { ...modified.intent, objective: "Silence. Only combat sounds." };
        break;
      case "low_visibility":
        modified.weather = { ...modified.weather, density: 0.8, type: "fog", color: "rgba(50,50,50,0.6)", size: 150 };
        modified.lighting = { ...modified.lighting, intensity: 0.2, ambientOcclusion: 0.6 };
        break;
      case "boss_passive":
        modified.bossStyle = "patient";
        modified.intent = { ...modified.intent, objective: "The boss waits. You must initiate." };
        break;
      case "silent_arena":
        modified.weather = { ...modified.weather, density: 0, type: "none" };
        modified.lighting = { ...modified.lighting, intensity: 0.5 };
        modified.intent = { ...modified.intent, objective: "No audio cues. No atmosphere. Just you." };
        break;
      case "habit_breaker":
        // Flip the hazards to something the player hasn't seen
        modified.hazards = [{ chipDamage: 0, spawnRate: 0.3, spawnDamage: 6, slipFactor: 0.6, windForce: 40, screenShake: 2, darkness: 0.2, visualType: "ice", visualColor: "rgba(150,200,255,0.2)" }];
        modified.intent = { ...modified.intent, objective: "Everything is different. Your habits will fail you." };
        break;
    }
    return modified;
  }

  // ---- World events to record after this fight ----

  private deriveWorldEvents(chapter: CampaignChapter): string[] {
    const events: string[] = [];
    if (chapter.worldChangeEvent) events.push(chapter.worldChangeEvent);
    if (chapter.emotion === "rage") events.push("VillageBurned");
    if (chapter.emotion === "hopelessness") events.push("BloodMoonAppeared");
    return events;
  }

  // ---- Fallback (if no campaign plan exists) ----

  private fallbackPlan(deps: DirectorV3Deps): DirectorPlanV3 {
    return {
      intent: {
        objective: "Fight the opponent.",
        emotion: "confidence",
        narrativePurpose: "A standard encounter.",
        playerExperienceGoal: "Enjoy the combat.",
      },
      storyEvent: deps.storyEvent,
      chapter: null,
      weather: { type: "none", density: 0, height: 0, movement: 0, wind: 0, color: "#fff", pulse: 0, size: 0, speed: 0 },
      lighting: { tint: "#ffffff", intensity: 1, flicker: 0, flickerColor: "#000", ambientOcclusion: 0.2, godRays: 0 },
      camera: { zoom: 1, panX: 0, panY: 0, tilt: 0, shake: 0, followWeight: 0, dynamicZoom: false, letterbox: 0, chromaticAberration: 0 },
      hazards: [],
      bossStyle: "aggressive",
      bossEmotion: "resolute",
      dialogueStyle: "cold",
      difficulty: "normal",
      cinematicMoments: [],
      experiment: null,
      pendingWorldEvents: [],
    };
  }
}
