// ============================================================================

import type { OpponentDef } from "../types";
// DIRECTOR RUNTIME STATE
//
// Lightweight runtime representation of the Director's plan. The Director
// computes a full DirectorPlanV3 offline, but for the engine and renderer
// we only need the parameters they can act on. This file defines that
// minimal shape and a single helper that derives it from the same intent
// tables used by the DirectorPanel UI — keeping everything deterministic
// and in sync.
//
// The combat engine and renderer read DirectorState from the engine and
// never call into DirectorEngineV3 directly, so this remains a thin
// data-only contract.
// ============================================================================

// Chapter -> intent mapping. Mirrors DirectorPanel.CHAPTERS exactly so the
// runtime plan matches the panel's narrative reasoning 1:1.
const CHAPTER_INTENTS: { intent: string; intensity: number }[] = [
  { intent: "defiance", intensity: 0.25 },
  { intent: "revelation", intensity: 0.35 },
  { intent: "grief", intensity: 0.45 },
  { intent: "revenge", intensity: 0.55 },
  { intent: "defiance", intensity: 0.65 },
  { intent: "revelation", intensity: 0.75 },
  { intent: "triumph", intensity: 0.9 },
];

// Per-intent runtime tuning. Keys are intent ids; values are the
// parameters the engine and renderer will actually use.
const INTENT_TABLE: Record<
  string,
  {
    // Weather particle spawning
    weatherType: "none" | "rain" | "snow" | "ash" | "fog" | "ember" | "dust" | "fireflies" | "petals" | "shadow";
    weatherRate: number;        // particles/sec
    weatherColor: string;
    weatherSize: number;
    weatherSpeed: number;       // base fall speed (px/s)
    weatherDrift: number;       // horizontal drift (-1..1)
    // Lighting overlay
    lightTint: string;          // multiplicative tint
    lightIntensity: number;     // 0..1
    // Camera profile
    cameraShake: number;        // 0..1 ambient shake
    cameraZoomBoost: number;    // 0..0.25 base zoom-in
    // Hazards
    slipFactor: number;         // 0=normal, 1=no friction
    chipDamage: number;         // hp/s passive
    darkness: number;           // 0..1 darkness overlay
  }
> = {
  revenge: {
    weatherType: "ember", weatherRate: 18, weatherColor: "#fb923c", weatherSize: 2.4, weatherSpeed: 80, weatherDrift: 0.3,
    lightTint: "#f97316", lightIntensity: 0.85,
    cameraShake: 0.6, cameraZoomBoost: 0.05,
    slipFactor: 0, chipDamage: 0, darkness: 0,
  },
  redemption: {
    weatherType: "rain", weatherRate: 40, weatherColor: "rgba(148,163,184,0.55)", weatherSize: 1.6, weatherSpeed: 380, weatherDrift: -0.25,
    lightTint: "#94a3b8", lightIntensity: 0.7,
    cameraShake: 0.1, cameraZoomBoost: 0.0,
    slipFactor: 0.15, chipDamage: 0, darkness: 0,
  },
  revelation: {
    weatherType: "dust", weatherRate: 12, weatherColor: "rgba(253,224,71,0.45)", weatherSize: 1.2, weatherSpeed: 25, weatherDrift: 0.15,
    lightTint: "#fde047", lightIntensity: 1.0,
    cameraShake: 0.0, cameraZoomBoost: 0.12,
    slipFactor: 0, chipDamage: 0, darkness: 0,
  },
  defiance: {
    weatherType: "shadow", weatherRate: 6, weatherColor: "rgba(15,23,42,0.7)", weatherSize: 30, weatherSpeed: 8, weatherDrift: 0.1,
    lightTint: "#0f172a", lightIntensity: 0.35,
    cameraShake: 0.3, cameraZoomBoost: 0.2,
    slipFactor: 0, chipDamage: 1.5, darkness: 0.25,
  },
  grief: {
    weatherType: "ash", weatherRate: 22, weatherColor: "rgba(168,162,158,0.6)", weatherSize: 2.2, weatherSpeed: 60, weatherDrift: -0.15,
    lightTint: "#a8a29e", lightIntensity: 0.55,
    cameraShake: 0.0, cameraZoomBoost: 0.08,
    slipFactor: 0.1, chipDamage: 0, darkness: 0.1,
  },
  triumph: {
    weatherType: "petals", weatherRate: 8, weatherColor: "#fca5a5", weatherSize: 4, weatherSpeed: 35, weatherDrift: 0.2,
    lightTint: "#fb7185", lightIntensity: 0.95,
    cameraShake: 0.0, cameraZoomBoost: 0.15,
    slipFactor: 0, chipDamage: 0, darkness: 0,
  },
};

// Fallback for unknown intents (e.g. two-player, free select outside roster).
const FALLBACK_INTENT = "revelation";

export interface DirectorRuntimeState {
  // The intent driving the current plan
  intent: string;
  // Chapter context (0..6)
  chapterIndex: number;
  // Display labels (rendered into the panel and overlay)
  weatherName: string;
  lightingName: string;
  cameraName: string;
  // Weather
  weather: {
    type: "none" | "rain" | "snow" | "ash" | "fog" | "ember" | "dust" | "fireflies" | "petals" | "shadow";
    rate: number;        // particles/sec
    color: string;
    size: number;
    speed: number;
    drift: number;       // -1..1
  };
  // Lighting overlay applied to the rendered scene
  lighting: {
    tint: string;
    intensity: number;
  };
  // Camera modifier (read by the renderer to bias shake/zoom)
  camera: {
    baseShake: number;
    baseZoomBoost: number;
  };
  // Hazards (read by the engine for damage/friction)
  hazards: {
    slipFactor: number;
    chipDamage: number;
    darkness: number;
  };
  // Runtime provenance and the high-level output from the fine-tuned model.
  ai: {
    status: "idle" | "thinking" | "live" | "fallback";
    model: string;
    intent: string;
    reasoning: string;
    expectedPlayerReaction: string;
    highLevelPlan: string;
    confidence: number;
    latencyMs: number | null;
    requestedAt?: number;
    error?: string;
  };
}

export function buildDirectorState(opponentIndex: number): DirectorRuntimeState {
  const idx = Math.max(0, Math.min(opponentIndex, CHAPTER_INTENTS.length - 1));
  const chapter = CHAPTER_INTENTS[idx];
  const intent = chapter.intent;
  const params = INTENT_TABLE[intent] ?? INTENT_TABLE[FALLBACK_INTENT];

  return {
    intent,
    chapterIndex: idx,
    weatherName: WEATHER_NAME[intent],
    lightingName: LIGHTING_NAME[intent],
    cameraName: CAMERA_NAME[intent],
    weather: {
      type: params.weatherType,
      rate: params.weatherRate,
      color: params.weatherColor,
      size: params.weatherSize,
      speed: params.weatherSpeed,
      drift: params.weatherDrift,
    },
    lighting: {
      tint: params.lightTint,
      intensity: params.lightIntensity,
    },
    camera: {
      baseShake: params.cameraShake,
      baseZoomBoost: params.cameraZoomBoost,
    },
    hazards: {
      slipFactor: params.slipFactor,
      chipDamage: params.chipDamage,
      darkness: params.darkness,
    },
    ai: {
      status: "idle",
      model: "Deterministic Director",
      intent,
      reasoning: "Waiting for the fine-tuned AI Director.",
      expectedPlayerReaction: "The player engages with the encounter.",
      highLevelPlan: "Use the chapter's deterministic encounter plan.",
      confidence: 0,
      latencyMs: null,
    },
  };
}

export interface RuntimeIntentOutput {
  intent: string;
  reasoning: string;
  expectedPlayerReaction: string;
  highLevelPlan: string;
  confidence: number;
}

type CombatTuning = Partial<Record<
  | "aggression" | "blockChance" | "reaction" | "combo" | "whiffPunish"
  | "antiAir" | "pressure" | "mixup" | "readDelay" | "adaptive"
  | "rage" | "perfection" | "speedMul",
  number
>>;

// Multipliers preserve each authored opponent (and GA genome) while making
// its moment-to-moment decisions embody the Director's intent.
const COMBAT_TABLE: Record<string, CombatTuning> = {
  revenge: { aggression: 1.18, blockChance: 1.05, reaction: 0.88, combo: 1.15, whiffPunish: 1.45, pressure: 1.2, mixup: 1.15, rage: 1.2 },
  redemption: { aggression: 0.78, blockChance: 0.9, reaction: 1.18, combo: 0.75, whiffPunish: 0.72, pressure: 0.7, mixup: 0.85, perfection: 0.65 },
  revelation: { aggression: 0.9, blockChance: 1.15, reaction: 0.95, combo: 0.9, antiAir: 1.3, mixup: 1.25, adaptive: 1.45, readDelay: 0.8 },
  defiance: { aggression: 1.15, blockChance: 1.12, reaction: 0.9, combo: 1.2, pressure: 1.4, mixup: 1.2, perfection: 1.2, speedMul: 1.05 },
  grief: { aggression: 0.72, blockChance: 1.25, reaction: 1.08, combo: 0.8, whiffPunish: 1.2, pressure: 0.65, adaptive: 1.15 },
  triumph: { aggression: 1.12, blockChance: 1.15, reaction: 0.86, combo: 1.25, whiffPunish: 1.25, antiAir: 1.25, pressure: 1.25, mixup: 1.25, adaptive: 1.2, perfection: 1.2, speedMul: 1.08 },
};

/** Apply a Director theme to an opponent definition, blended by confidence. */
export function applyDirectorCombatIntent(base: OpponentDef, intent: string, confidence = 1): OpponentDef {
  const tuning = COMBAT_TABLE[intent];
  if (!tuning) return { ...base };
  const blend = Math.max(0, Math.min(1, confidence));
  const result: OpponentDef = { ...base };
  const bounded01 = new Set(["aggression", "blockChance", "whiffPunish", "antiAir", "pressure", "mixup", "adaptive", "rage", "perfection"]);

  for (const [key, multiplier] of Object.entries(tuning)) {
    const original = (base as unknown as Record<string, unknown>)[key];
    if (typeof original !== "number" || typeof multiplier !== "number") continue;
    let value = original * (1 + (multiplier - 1) * blend);
    if (bounded01.has(key)) value = Math.max(0, Math.min(1, value));
    if (key === "reaction" || key === "readDelay") value = Math.max(0.02, value);
    if (key === "combo") value = Math.max(1, Math.round(value));
    (result as unknown as Record<string, number>)[key] = value;
  }
  return result;
}

/** Translate free-form model intent into one of the renderer's safe themes. */
export function applyAIIntent(
  current: DirectorRuntimeState,
  output: RuntimeIntentOutput,
  meta: { model: string; latencyMs: number },
): DirectorRuntimeState {
  const text = `${output.intent} ${output.reasoning} ${output.highLevelPlan}`.toLowerCase();
  const theme = inferRuntimeTheme(text, current.intent);
  const themed = buildDirectorState(current.chapterIndex);
  // Rebuild using the selected theme while retaining chapter identity.
  const params = INTENT_TABLE[theme] ?? INTENT_TABLE[FALLBACK_INTENT];
  return {
    ...themed,
    intent: theme,
    chapterIndex: current.chapterIndex,
    weatherName: WEATHER_NAME[theme],
    lightingName: LIGHTING_NAME[theme],
    cameraName: CAMERA_NAME[theme],
    weather: { type: params.weatherType, rate: params.weatherRate, color: params.weatherColor, size: params.weatherSize, speed: params.weatherSpeed, drift: params.weatherDrift },
    lighting: { tint: params.lightTint, intensity: params.lightIntensity },
    camera: { baseShake: params.cameraShake, baseZoomBoost: params.cameraZoomBoost },
    hazards: { slipFactor: params.slipFactor, chipDamage: params.chipDamage, darkness: params.darkness },
    ai: { status: "live", model: meta.model, ...output, confidence: Math.max(0, Math.min(1, output.confidence)), latencyMs: meta.latencyMs },
  };
}

function inferRuntimeTheme(text: string, fallback: string): string {
  if (/(reward|recover|hope|confidence|second chance|calm|breathe)/.test(text)) return "redemption";
  if (/(grief|loss|mourn|hesitat|sorrow|emotional)/.test(text)) return "grief";
  if (/(triumph|conclude|final|victory|cathar|coronation)/.test(text)) return "triumph";
  if (/(reveal|teach|learn|truth|observe|adapt)/.test(text)) return "revelation";
  if (/(revenge|punish|counter|reckless|overconfiden|aggress)/.test(text)) return "revenge";
  if (/(challenge|pressure|destabili|defy|break|test)/.test(text)) return "defiance";
  return INTENT_TABLE[fallback] ? fallback : FALLBACK_INTENT;
}

const WEATHER_NAME: Record<string, string> = {
  revenge: "RUST SKY",
  redemption: "GREY DAWN",
  revelation: "GOLDEN HOUR",
  defiance: "BLACK STORM",
  grief: "ASHEN RAIN",
  triumph: "CRIMSON SUN",
};

const LIGHTING_NAME: Record<string, string> = {
  revenge: "HARD RIM",
  redemption: "DIFFUSED",
  revelation: "GOD-RAYS",
  defiance: "UNDERLIGHT",
  grief: "COLD FLAT",
  triumph: "HALO",
};

const CAMERA_NAME: Record<string, string> = {
  revenge: "HANDHELD",
  redemption: "STEADICAM",
  revelation: "WIDE PULL",
  defiance: "CLOSE-UP",
  grief: "LONG LENS",
  triumph: "LOW HERO",
};
