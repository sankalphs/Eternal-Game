// ============================================================================
// DIRECTOR V2 — the AI director that plans each fight from the full
// psychology + world + narrative pipeline.
//
// Pipeline: PlayerProfile → PsychologyEngine → WorldState → NarrativeEngine → DirectorPlan
//
// The Director NEVER runs during combat. It only runs:
//   - Before a boss fight (to plan the encounter)
//   - After a boss fight (to update world state + mythology)
//   - After the campaign (to generate the ending)
// ============================================================================

import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { PsychologyProfile } from "../psychology/PsychologyEngine";
import type { WorldState } from "../world/WorldState";
import type { StoryEvent } from "../narrative/NarrativeEngine";
import type { BossStyleId } from "../content/boss_styles";
import type { DifficultyId } from "../content/difficulties";
import type { WeatherModifier, LightingModifier, CameraModifier, HazardModifier } from "../content/modifiers";
import type { MythEntry } from "../world/WorldState";

export interface DirectorPlanV2 {
  // Narrative
  storyEvent: StoryEvent;
  worldStateDelta: Partial<WorldState>;  // changes to apply after the fight

  // Environmental modifiers (procedural, not presets)
  weather: WeatherModifier;
  lighting: LightingModifier;
  camera: CameraModifier;
  hazards: HazardModifier[];

  // Boss configuration
  bossStyle: BossStyleId;
  bossEmotion: string;
  dialogueStyle: "taunting" | "cold" | "rage" | "calm" | "despair" | "none";
  difficulty: DifficultyId;

  // Cinematic
  cinematicMoments: CinematicMoment[];

  // Arena evolution stage
  arenaStage: number;
}

export interface CinematicMoment {
  trigger: "round_start" | "low_hp" | "super_used" | "ko" | "first_hit";
  action: "slow_zoom" | "letterbox" | "flash" | "shake" | "freeze_frame" | "dutch_tilt";
  duration: number;  // seconds
  intensity: number; // 0..1
}

export interface DirectorV2Deps {
  psychology: PsychologyProfile;
  world: WorldState;
  narrative: StoryEvent;
  opponentIndex: number;
  opponentName: string;
}

export class DirectorEngineV2 {
  /**
   * Plan a fight using the full pipeline. Called BEFORE combat, never during.
   */
  planFight(deps: DirectorV2Deps): DirectorPlanV2 {
    const { psychology, world, narrative, opponentIndex } = deps;

    // 1. Weather — derived from world corruption + player psychology
    const weather = this.selectWeather(psychology, world, opponentIndex);

    // 2. Lighting — derived from world darkness + time of day
    const lighting = this.selectLighting(world, opponentIndex);

    // 3. Camera — derived from boss style + opponent index
    const camera = this.selectCamera(psychology, opponentIndex);

    // 4. Hazards — derived from world state + player weaknesses
    const hazards = this.selectHazards(psychology, world, opponentIndex);

    // 5. Boss style — counters the player's dominant archetype
    const bossStyle = this.selectBossStyle(psychology);

    // 6. Difficulty — scales with player skill
    const difficulty = this.selectDifficulty(psychology, world, opponentIndex);

    // 7. Dialogue style — matches the boss emotion
    const dialogueStyle = this.selectDialogueStyle(narrative.bossEmotion);

    // 8. Cinematic moments — dramatic beats for the fight
    const cinematicMoments = this.selectCinematicMoments(opponentIndex, psychology);

    // 9. Arena stage — from world state
    const arenaStage = Math.min(5, world.arenaDamage[deps.opponentName] ?? 0);

    // 10. World state delta — what changes after this fight
    const worldStateDelta = this.computeWorldDelta(world, opponentIndex);

    return {
      storyEvent: narrative,
      worldStateDelta,
      weather,
      lighting,
      camera,
      hazards,
      bossStyle,
      bossEmotion: narrative.bossEmotion,
      dialogueStyle,
      difficulty,
      cinematicMoments,
      arenaStage,
    };
  }

  // ---- Weather selection (procedural, not preset) ----
  private selectWeather(
    psych: PsychologyProfile,
    world: WorldState,
    opponentIndex: number,
  ): WeatherModifier {
    const corruption = world.corruptionLevel;
    const fear = world.worldFear;

    // Base weather type from world state
    if (corruption > 0.6) {
      return { type: "ash", density: 0.5 + corruption * 0.3, height: 1, movement: 0.5, wind: 0.05, color: "rgba(120,80,60,0.4)", pulse: 0, size: 3, speed: 30 };
    }
    if (fear > 0.5) {
      return { type: "fog", density: 0.3 + fear * 0.3, height: 0.6, movement: 0.3, wind: 0.1, color: "rgba(100,100,120,0.35)", pulse: 0, size: 100, speed: 8 };
    }
    if (opponentIndex >= 5) {
      return { type: "ember", density: 0.3, height: 0.8, movement: 0.3, wind: 0.05, color: "#dc2626", pulse: 0.5, size: 3, speed: 20 };
    }
    // Default: clear with slight atmospheric particles
    return { type: "none", density: 0, height: 0, movement: 0, wind: 0, color: "#fff", pulse: 0, size: 0, speed: 0 };
  }

  // ---- Lighting selection ----
  private selectLighting(world: WorldState, opponentIndex: number): LightingModifier {
    const darkness = world.darknessLevel;
    const tint = darkness > 0.5 ? "#303040" : darkness > 0.3 ? "#504060" : "#ffffff";
    const intensity = Math.max(0.2, 1 - darkness * 0.7);
    const flicker = world.corruptionLevel > 0.4 ? 0.3 : 0;
    return {
      tint,
      intensity,
      flicker,
      flickerColor: "#f97316",
      ambientOcclusion: 0.2 + darkness * 0.3,
      godRays: opponentIndex <= 2 ? 0.3 : 0,
    };
  }

  // ---- Camera selection ----
  private selectCamera(psych: PsychologyProfile, opponentIndex: number): CameraModifier {
    const zoom = opponentIndex >= 4 ? 1.25 : opponentIndex >= 2 ? 1.1 : 1.0;
    const letterbox = opponentIndex >= 4 ? 0.06 : 0;
    const followWeight = psych.traits.aggression > 0.6 ? 0.5 : 0;
    return {
      zoom, panX: 0, panY: opponentIndex >= 4 ? -20 : 0, tilt: 0,
      shake: 0, followWeight, dynamicZoom: opponentIndex >= 3,
      letterbox, chromaticAberration: 0,
    };
  }

  // ---- Hazard selection ----
  private selectHazards(
    psych: PsychologyProfile,
    world: WorldState,
    opponentIndex: number,
  ): HazardModifier[] {
    const hazards: HazardModifier[] = [];
    if (opponentIndex >= 2 && psych.traits.aggression > 0.6) {
      hazards.push({ chipDamage: 0, spawnRate: 0.55, spawnDamage: 4, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0, visualType: "debris", visualColor: "#7c6f5b" });
    }
    if (opponentIndex >= 4 && psych.traits.riskTolerance > 0.4) {
      hazards.push({ chipDamage: 6, spawnRate: 0, spawnDamage: 0, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0, visualType: "embers", visualColor: "#fb923c" });
    }
    if (world.corruptionLevel > 0.5 && opponentIndex >= 3) {
      hazards.push({ chipDamage: 2, spawnRate: 0, spawnDamage: 0, slipFactor: 0, windForce: 0, screenShake: 0, darkness: 0.15, visualType: "mist", visualColor: "rgba(80,200,80,0.15)" });
    }
    return hazards;
  }

  // ---- Boss style selection — counters the player ----
  private selectBossStyle(psych: PsychologyProfile): BossStyleId {
    if (psych.dominant.id === "aggressor" || psych.dominant.id === "risk_taker") {
      return psych.traits.riskTolerance > 0.5 ? "punisher" : "counter";
    }
    if (psych.dominant.id === "defender" || psych.dominant.id === "patient_fighter") {
      return "rushdown";
    }
    if (psych.dominant.id === "combo_artist") return "counter";
    if (psych.dominant.id === "speedrunner") return "zoner";
    if (psych.dominant.id === "panicker") return "aggressive";
    if (psych.dominant.id === "mind_gamer" || psych.dominant.id === "adaptive_player") return "mind_game";
    return "aggressive";
  }

  // ---- Difficulty selection ----
  private selectDifficulty(
    psych: PsychologyProfile,
    world: WorldState,
    opponentIndex: number,
  ): DifficultyId {
    const winRate = psych.archetypes.length > 0 ? 0.5 : 0.5; // simplified
    if (opponentIndex >= 6) return "brutal";
    if (opponentIndex >= 4) return "hard";
    if (opponentIndex >= 2) return "normal";
    return "normal";
  }

  // ---- Dialogue style ----
  private selectDialogueStyle(bossEmotion: string): DirectorPlanV2["dialogueStyle"] {
    if (bossEmotion.includes("rage")) return "rage";
    if (bossEmotion.includes("terrified")) return "despair";
    if (bossEmotion.includes("hopeful")) return "calm";
    if (bossEmotion.includes("confused")) return "taunting";
    return "cold";
  }

  // ---- Cinematic moments ----
  private selectCinematicMoments(opponentIndex: number, psych: PsychologyProfile): CinematicMoment[] {
    const moments: CinematicMoment[] = [
      { trigger: "round_start", action: "slow_zoom", duration: 2, intensity: 0.5 },
      { trigger: "first_hit", action: "shake", duration: 0.3, intensity: 0.6 },
    ];
    if (opponentIndex >= 4) {
      moments.push({ trigger: "low_hp", action: "letterbox", duration: 1, intensity: 0.8 });
      moments.push({ trigger: "ko", action: "freeze_frame", duration: 0.5, intensity: 1 });
    }
    if (psych.traits.aggression > 0.7) {
      moments.push({ trigger: "super_used", action: "flash", duration: 0.4, intensity: 0.9 });
    }
    return moments;
  }

  // ---- World state delta ----
  private computeWorldDelta(world: WorldState, opponentIndex: number): Partial<WorldState> {
    return {
      darknessLevel: Math.min(1, world.darknessLevel + 0.08),
      worldFear: Math.min(1, world.worldFear + 0.1),
    };
  }
}
