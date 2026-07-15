// ============================================================================
// PROJECT ETERNAL — INTENT TRANSLATOR
//
// The deterministic bridge between the LLM's high-level intent and the
// existing DirectorPlanV3. This is the ONLY place where intent becomes
// weather, lighting, camera, hazards, boss style, difficulty, etc.
//
// The translator is pure and deterministic given (intent, playerContext,
// worldContext, campaignContext, genomeLibrary). It uses the categoriser
// from IntentSchema, the genome library, the campaign chapter, and the
// world state to select concrete DirectorPlanV3 values.
//
// The translator NEVER consults the LLM. It is the source of truth for
// how a high-level intent becomes a gameplay plan.
// ============================================================================

import type {
  DirectorIntent,
  DirectorPlanV3,
} from "../director/DirectorEngineV3";
import type {
  WeatherModifier, LightingModifier, CameraModifier, HazardModifier,
} from "../content/modifiers";
import type { BossStyleId } from "../content/boss_styles";
import type { DifficultyId } from "../content/difficulties";
import type { WeatherId } from "../content/weather";
import type { CameraId } from "../content/cameras";
import type { HazardId } from "../content/hazards";
import type { CrowdId } from "../content/crowds";

import {
  IntentCategory,
  INTENT_CATEGORIES,
  categoriseIntent,
  type IntentOutput,
} from "./IntentSchema";

// --------------------------------------------------------------------------
//  Input context
// --------------------------------------------------------------------------

export interface IntentTranslatorInput {
  intent: IntentOutput;
  // Optional inputs the translator may consult
  playerSkill?: number;          // 0..1
  playerConfidence?: number;     // 0..1
  playerFrustration?: number;    // 0..1
  worldCorruption?: number;      // 0..1
  worldHope?: number;            // 0..1
  chapterEmotion?: string;       // e.g. "fear" | "hope" | "rage" | ...
  recentBossStyles?: BossStyleId[];   // last N chosen (avoid repetition)
  recentDifficulties?: DifficultyId[];
  availableGenomes?: BossStyleId[];   // from the frozen library
  seed?: number;                 // for tie-breaking
}

export interface IntentTranslation {
  intentCategory: IntentCategory;
  // Overrides to apply to the baseline V3 plan
  overrides: {
    intent?: Partial<DirectorIntent>;
    weather?: WeatherId;
    lighting?: string;
    camera?: CameraId;
    crowd?: CrowdId;
    hazards?: HazardId[];
    bossStyle?: BossStyleId;
    difficulty?: DifficultyId;
    bossEmotion?: string;
    dialogueStyle?: "taunting" | "cold" | "rage" | "calm" | "despair" | "none";
    intensityBias?: number;   // 0..1 — added to cinematics intensity
  };
  // Explanation of the translation (for the UI / debug)
  rationale: string[];
}

// --------------------------------------------------------------------------
//  Translator
// --------------------------------------------------------------------------

export class IntentTranslator {
  /**
   * Translate an IntentOutput into concrete overrides for DirectorPlanV3.
   * This is the ONLY place where intent becomes a Director plan.
   */
  translate(input: IntentTranslatorInput): IntentTranslation {
    const intent = input.intent;
    const category = categoriseIntent(intent.intent);
    const rationale: string[] = [`categorised as "${category}"`];

    const overrides: IntentTranslation["overrides"] = {};

    // 1. Categorical rules -----------------------------------------------------
    switch (category) {
      case "punish": {
        // Counter the dominant habit. Raise pressure, pick a counter genome.
        overrides.bossStyle = this.pickStyle(["counter", "punisher", "adaptive"], input);
        overrides.difficulty = this.bumpDifficulty(input, +1);
        overrides.camera = "boss_focus";
        overrides.intensityBias = 0.2;
        rationale.push("punish → counter genome, harder, intense");
        break;
      }
      case "challenge": {
        overrides.bossStyle = this.pickStyle(["aggressive", "rushdown", "aggressive"], input);
        overrides.difficulty = this.bumpDifficulty(input, +1);
        overrides.intensityBias = 0.15;
        rationale.push("challenge → aggressive genome, harder");
        break;
      }
      case "reward": {
        overrides.bossStyle = this.pickStyle(["defensive", "patient", "defensive"], input);
        overrides.difficulty = this.bumpDifficulty(input, -1);
        overrides.camera = "wide";
        overrides.intensityBias = -0.1;
        rationale.push("reward → easy genome, lower difficulty");
        break;
      }
      case "teach": {
        overrides.bossStyle = this.pickStyle(["patient", "counter", "zoner"], input);
        overrides.difficulty = input.playerSkill && input.playerSkill > 0.65 ? "hard" : "normal";
        overrides.camera = "close";
        overrides.intensityBias = 0.0;
        rationale.push("teach → patient genome, explanatory camera");
        break;
      }
      case "teach_defense": {
        overrides.bossStyle = this.pickStyle(["rushdown", "aggressive", "aggressive"], input);
        overrides.difficulty = "normal";
        overrides.camera = "dynamic_zoom";
        rationale.push("teach defense → aggressive genome to force blocks");
        break;
      }
      case "teach_offense": {
        overrides.bossStyle = this.pickStyle(["defensive", "defensive", "patient"], input);
        overrides.difficulty = "normal";
        overrides.camera = "wide";
        rationale.push("teach offense → defensive genome to give windows");
        break;
      }
      case "destabilise": {
        overrides.bossStyle = this.pickStyle(["mind_game", "adaptive", "punisher"], input);
        overrides.camera = "handheld";
        overrides.intensityBias = 0.25;
        rationale.push("destabilise → unpredictable genome, handheld");
        break;
      }
      case "escalate": {
        overrides.bossStyle = this.pickStyle(["aggressive", "rushdown", "aggressive", "punisher"], input);
        overrides.difficulty = this.bumpDifficulty(input, +1);
        overrides.camera = "cinematic";
        overrides.intensityBias = 0.3;
        rationale.push("escalate → harder, epic, cinematic");
        break;
      }
      case "de_escalate": {
        overrides.bossStyle = this.pickStyle(["patient", "defensive", "defensive"], input);
        overrides.difficulty = this.bumpDifficulty(input, -1);
        overrides.camera = "wide";
        overrides.intensityBias = -0.2;
        rationale.push("de-escalate → easier, peaceful, wide");
        break;
      }
      case "reintroduce": {
        // Re-use the least-recent style
        overrides.bossStyle = this.pickStyle(this.leastRecentStyles(input), input);
        rationale.push("reintroduce → least-recent style");
        break;
      }
      case "conclude": {
        overrides.bossStyle = "adaptive";
        overrides.camera = "cinematic";
        overrides.intensityBias = 0.2;
        rationale.push("conclude → adaptive, choir, cinematic");
        break;
      }
      case "experiment": {
        overrides.bossStyle = this.pickStyle(this.leastRecentStyles(input), input);
        overrides.intensityBias = 0.1;
        rationale.push("experiment → least-used style");
        break;
      }
      case "settle": {
        overrides.bossStyle = "patient";
        overrides.camera = "slow_zoom";
        overrides.intensityBias = -0.1;
        rationale.push("settle → patient, slow zoom");
        break;
      }
      case "narrative_beat": {
        overrides.camera = "cinematic";
        overrides.intensityBias = 0.05;
        rationale.push(`narrative beat → cinematic camera for "${input.chapterEmotion ?? "neutral"}"`);
        break;
      }
      case "unknown":
      default: {
        // Conservative: do not override
        rationale.push("unknown intent → no override, defer to V3 baseline");
        break;
      }
    }

    // 2. Heuristics from player state ------------------------------------------
    const pSkill = clamp01(input.playerSkill ?? 0.5);
    const pFrust = clamp01(input.playerFrustration ?? 0.5);
    const pConf = clamp01(input.playerConfidence ?? 0.5);

    if (pFrust > 0.7 && !overrides.difficulty) {
      // Don't pile on a frustrated player
      overrides.difficulty = this.bumpDifficulty(input, -1);
      rationale.push("high frustration → soft difficulty");
    }
    if (pConf > 0.8 && pSkill < 0.5 && !overrides.difficulty) {
      // Overconfident underperformer → teach
      overrides.difficulty = "normal";
      overrides.bossStyle = overrides.bossStyle ?? "patient";
      rationale.push("overconfident underperformer → patient genome to teach");
    }

    // 3. World state influence on weather --------------------------------------
    const wCor = clamp01(input.worldCorruption ?? 0);
    const wHop = clamp01(input.worldHope ?? 0);
    if (!overrides.weather) {
      if (wCor > 0.65) overrides.weather = "ash";
      else if (wCor > 0.4) overrides.weather = "blood_moon";
      else if (wHop > 0.65) overrides.weather = "cherry_blossoms";
      else if (wHop > 0.4) overrides.weather = "fireflies";
      else if (category === "conclude" || category === "settle") overrides.weather = "clear";
    }

    // 4. Crowd choice -----------------------------------------------------------
    if (!overrides.crowd) {
      if (category === "narrative_beat") overrides.crowd = "silent";
      else if (category === "conclude") overrides.crowd = "monks";
      else if (category === "punish" || category === "escalate") overrides.crowd = "running";
      else if (category === "reward") overrides.crowd = "cheering";
    }

    // 5. Hazards ---------------------------------------------------------------
    if (!overrides.hazards) {
      const haz = this.deriveHazards(category, pConf, pFrust);
      if (haz.length > 0) overrides.hazards = haz;
    }

    // 6. Boss emotion / dialogue ------------------------------------------------
    if (!overrides.bossEmotion) {
      overrides.bossEmotion = this.pickBossEmotion(category, input.chapterEmotion);
    }
    if (!overrides.dialogueStyle) {
      overrides.dialogueStyle = this.pickDialogueStyle(category, input.chapterEmotion);
    }

    // 7. Intent narrative fields ------------------------------------------------
    if (!overrides.intent) {
      overrides.intent = {
        objective: intent.intent,
        emotion: this.mapCategoryToEmotion(category, input.chapterEmotion),
        narrativePurpose: intent.highLevelPlan.slice(0, 200),
        playerExperienceGoal: intent.expectedPlayerReaction.slice(0, 200),
      };
    }

    return { intentCategory: category, overrides, rationale };
  }

  // --------------------------------------------------------------------------
  //  Helpers
  // --------------------------------------------------------------------------

  private pickStyle(preferred: BossStyleId[], input: IntentTranslatorInput): BossStyleId {
    const available = input.availableGenomes && input.availableGenomes.length > 0
      ? input.availableGenomes
      : undefined;
    // 1) First try intersection of preferred with available
    if (available) {
      const intersect = preferred.filter(s => available.includes(s));
      if (intersect.length > 0) return intersect[0];
    }
    // 2) Avoid recent styles if possible
    const recent = new Set(input.recentBossStyles ?? []);
    const avoid = preferred.find(s => !recent.has(s));
    if (avoid) return avoid;
    // 3) Fall back to a non-recent style from the full set
    const all: BossStyleId[] = [
      "aggressive", "counter", "defensive", "patient", "rushdown",
      "mind_game", "punisher", "adaptive", "zoner",
    ];
    const nonRecent = all.find(s => !recent.has(s));
    if (nonRecent) return nonRecent;
    // 4) Last resort: any preferred
    return preferred[0] ?? "adaptive";
  }

  private leastRecentStyles(input: IntentTranslatorInput): BossStyleId[] {
    const recent = input.recentBossStyles ?? [];
    if (recent.length === 0) return ["adaptive", "aggressive", "patient", "counter"];
    // All boss styles minus recent
    const all: BossStyleId[] = [
      "aggressive", "counter", "defensive", "patient", "rushdown",
      "mind_game", "punisher", "adaptive", "zoner", "aggressive",
    ];
    const filtered = all.filter(s => !recent.includes(s));
    return filtered.length > 0 ? filtered : all;
  }

  private bumpDifficulty(input: IntentTranslatorInput, dir: number): DifficultyId {
    const order: DifficultyId[] = ["easy", "normal", "hard", "brutal", "nightmare"];
    const recent = input.recentDifficulties ?? [];
    const current = recent[recent.length - 1] ?? "normal";
    let idx = order.indexOf(current);
    if (idx < 0) idx = 1;
    idx = clamp(idx + dir, 0, order.length - 1);
    return order[idx];
  }

  private pickBossEmotion(category: IntentCategory, chapterEmotion?: string): string {
    if (chapterEmotion) return chapterEmotion;
    switch (category) {
      case "punish": return "resolute";
      case "reward": return "calm";
      case "teach":
      case "teach_defense":
      case "teach_offense":
        return "patient";
      case "destabilise":
      case "escalate": return "ruthless";
      case "de_escalate":
      case "settle": return "contemplative";
      case "conclude": return "final";
      case "narrative_beat": return "ancient";
      default: return "resolute";
    }
  }

  private pickDialogueStyle(
    category: IntentCategory,
    chapterEmotion?: string,
  ): "taunting" | "cold" | "rage" | "calm" | "despair" | "none" {
    if (chapterEmotion === "rage") return "rage";
    switch (category) {
      case "punish": return "cold";
      case "reward": return "calm";
      case "destabilise": return "taunting";
      case "escalate": return "rage";
      case "conclude": return "despair";
      case "narrative_beat":
      case "settle": return "none";
      default: return "cold";
    }
  }

  private mapCategoryToEmotion(category: IntentCategory, chapterEmotion?: string): string {
    if (chapterEmotion) return chapterEmotion;
    switch (category) {
      case "punish": return "fear";
      case "challenge": return "tension";
      case "reward": return "relief";
      case "teach":
      case "teach_defense":
      case "teach_offense": return "focus";
      case "destabilise": return "unease";
      case "escalate": return "rage";
      case "de_escalate":
      case "settle": return "calm";
      case "reintroduce": return "memory";
      case "conclude": return "finality";
      case "experiment": return "curiosity";
      case "narrative_beat": return "wonder";
      default: return "focus";
    }
  }

  private deriveHazards(
    category: IntentCategory,
    pConf: number,
    pFrust: number,
  ): HazardId[] {
    const out: HazardId[] = [];
    if (category === "destabilise" || category === "escalate") {
      out.push("darkness");
    }
    if (category === "punish" && pConf > 0.6) {
      out.push("fire_rain");
    }
    if (category === "narrative_beat") {
      out.push("poison_mist");
    }
    return out;
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
