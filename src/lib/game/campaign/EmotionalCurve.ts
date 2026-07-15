// ============================================================================
// EMOTIONAL CURVE — defines the emotional arc of a campaign.
// The Director aligns music, camera, weather, crowd, dialogue, lighting,
// and boss personality to the current emotion. Nothing is chosen independently.
// ============================================================================

export type Emotion =
  | "wonder" | "confidence" | "suspicion" | "fear" | "hopelessness"
  | "determination" | "victory" | "curiosity" | "chaos" | "isolation"
  | "triumph" | "despair" | "awe" | "serene" | "rage";

export interface EmotionalBeat {
  emotion: Emotion;
  chapter: number;        // which fight in the campaign
  description: string;    // what the player should feel
  intensity: number;      // 0..1 how strong this emotion is
}

export interface EmotionalCurve {
  beats: EmotionalBeat[];
  currentBeat: number;    // index into beats[]
}

// Prebuilt emotional arcs — the Campaign Planner selects one based on
// the player's psychology.
export const EMOTIONAL_ARCS: EmotionalCurve[] = [
  // Arc 1: Classic Hero's Fall (for aggressive players)
  {
    currentBeat: 0,
    beats: [
      { emotion: "wonder", chapter: 0, description: "The world is new and strange.", intensity: 0.5 },
      { emotion: "confidence", chapter: 1, description: "You are winning. It feels easy.", intensity: 0.6 },
      { emotion: "suspicion", chapter: 2, description: "Something is wrong. The world shifts.", intensity: 0.5 },
      { emotion: "fear", chapter: 3, description: "The sealers are stronger than expected.", intensity: 0.7 },
      { emotion: "hopelessness", chapter: 4, description: "The world darkens. Can you go on?", intensity: 0.8 },
      { emotion: "determination", chapter: 5, description: "No. You are the Shadow. You will not stop.", intensity: 0.9 },
      { emotion: "rage", chapter: 6, description: "Everything burns.", intensity: 1.0 },
      { emotion: "victory", chapter: 7, description: "The last gate falls. The world is yours.", intensity: 1.0 },
    ],
  },
  // Arc 2: The Merciful Shadow (for patient/defensive players)
  {
    currentBeat: 0,
    beats: [
      { emotion: "curiosity", chapter: 0, description: "Who are these sealers?", intensity: 0.4 },
      { emotion: "wonder", chapter: 1, description: "Their skills are impressive.", intensity: 0.5 },
      { emotion: "chaos", chapter: 2, description: "The world destabilizes around you.", intensity: 0.6 },
      { emotion: "isolation", chapter: 3, description: "You are alone. Even the shadows fear you.", intensity: 0.7 },
      { emotion: "hopelessness", chapter: 4, description: "Is mercy even possible?", intensity: 0.7 },
      { emotion: "determination", chapter: 5, description: "You will find a way.", intensity: 0.8 },
      { emotion: "serene", chapter: 6, description: "The fighting stops meaning something else.", intensity: 0.6 },
      { emotion: "triumph", chapter: 7, description: "The world is saved. By the Shadow.", intensity: 0.9 },
    ],
  },
  // Arc 3: The Descent (for risky/chaotic players)
  {
    currentBeat: 0,
    beats: [
      { emotion: "confidence", chapter: 0, description: "You are unstoppable.", intensity: 0.7 },
      { emotion: "rage", chapter: 1, description: "Break them all.", intensity: 0.8 },
      { emotion: "chaos", chapter: 2, description: "The world breaks with you.", intensity: 0.8 },
      { emotion: "despair", chapter: 3, description: "There is nothing left to break.", intensity: 0.9 },
      { emotion: "fear", chapter: 4, description: "You fear what you have become.", intensity: 0.7 },
      { emotion: "isolation", chapter: 5, description: "Silence. Ash. You.", intensity: 0.8 },
      { emotion: "determination", chapter: 6, description: "One more. The last one.", intensity: 0.9 },
      { emotion: "awe", chapter: 7, description: "The end of all things. And you caused it.", intensity: 1.0 },
    ],
  },
];

// Emotion → sensory mapping. The Director uses this to align ALL systems
// to the current emotion. Nothing is chosen independently.
export interface EmotionProfile {
  music: string;          // music profile ID
  camera: string;         // camera profile ID
  weather: string;        // weather type
  crowd: string;          // crowd profile ID
  lighting: string;       // lighting tint (hex)
  lightingIntensity: number;
  bossPersonality: string; // boss style ID
  dialogue: string;       // dialogue tone
}

export const EMOTION_PROFILES: Record<Emotion, EmotionProfile> = {
  wonder: { music: "choir", camera: "wide", weather: "clear", crowd: "cheering", lighting: "#e0f2fe", lightingIntensity: 1, bossPersonality: "patient", dialogue: "calm" },
  confidence: { music: "epic", camera: "wide", weather: "clear", crowd: "cheering", lighting: "#fef3c7", lightingIntensity: 0.9, bossPersonality: "aggressive", dialogue: "taunting" },
  suspicion: { music: "ancient", camera: "cinematic", weather: "fog", crowd: "silent", lighting: "#4a4a5a", lightingIntensity: 0.6, bossPersonality: "counter", dialogue: "cold" },
  fear: { music: "dark", camera: "close", weather: "thunder", crowd: "running", lighting: "#1a1a2e", lightingIntensity: 0.4, bossPersonality: "punisher", dialogue: "rage" },
  hopelessness: { music: "hopeless", camera: "boss_focus", weather: "ash", crowd: "burning_city", lighting: "#2a1a1a", lightingIntensity: 0.3, bossPersonality: "defensive", dialogue: "despair" },
  determination: { music: "percussion", camera: "dynamic_zoom", weather: "clear", crowd: "praying", lighting: "#f59e0b", lightingIntensity: 0.7, bossPersonality: "rushdown", dialogue: "rage" },
  victory: { music: "victory", camera: "wide", weather: "clear", crowd: "cheering", lighting: "#fde047", lightingIntensity: 1, bossPersonality: "aggressive", dialogue: "taunting" },
  curiosity: { music: "choir", camera: "slow_zoom", weather: "fireflies", crowd: "monks", lighting: "#86efac", lightingIntensity: 0.8, bossPersonality: "mind_game", dialogue: "calm" },
  chaos: { music: "percussion", camera: "handheld", weather: "dust_storm", crowd: "running", lighting: "#7c2d12", lightingIntensity: 0.5, bossPersonality: "rushdown", dialogue: "rage" },
  isolation: { music: "silence", camera: "cinematic", weather: "heavy_fog", crowd: "ruined_kingdom", lighting: "#1e293b", lightingIntensity: 0.3, bossPersonality: "zoner", dialogue: "despair" },
  triumph: { music: "victory", camera: "wide", weather: "cherry_blossoms", crowd: "praying", lighting: "#fbcfe8", lightingIntensity: 0.9, bossPersonality: "counter", dialogue: "calm" },
  despair: { music: "hopeless", camera: "dutch_angle", weather: "blood_moon", crowd: "burning_city", lighting: "#450a0a", lightingIntensity: 0.25, bossPersonality: "punisher", dialogue: "despair" },
  awe: { music: "choir", camera: "slow_zoom", weather: "solar_eclipse", crowd: "ruined_kingdom", lighting: "#1a1a2e", lightingIntensity: 0.2, bossPersonality: "adaptive", dialogue: "cold" },
  serene: { music: "peaceful", camera: "cinematic", weather: "cherry_blossoms", crowd: "monks", lighting: "#e0f2fe", lightingIntensity: 0.8, bossPersonality: "patient", dialogue: "calm" },
  rage: { music: "percussion", camera: "handheld", weather: "fire_rain", crowd: "burning_city", lighting: "#7f1d1d", lightingIntensity: 0.4, bossPersonality: "aggressive", dialogue: "rage" },
};

export function getCurrentEmotion(curve: EmotionalCurve): EmotionalBeat {
  return curve.beats[Math.min(curve.currentBeat, curve.beats.length - 1)];
}

export function advanceEmotion(curve: EmotionalCurve): EmotionalCurve {
  return {
    ...curve,
    currentBeat: Math.min(curve.beats.length - 1, curve.currentBeat + 1),
  };
}

export function selectEmotionalArc(
  skill: number,
  aggression: number,
  patience: number,
  riskTolerance: number,
): EmotionalCurve {
  // High aggression + high risk → The Descent (chaotic, dark)
  if (aggression > 0.6 && riskTolerance > 0.5) return EMOTIONAL_ARCS[2];
  // High patience + low aggression → The Merciful Shadow
  if (patience > 0.6 && aggression < 0.4) return EMOTIONAL_ARCS[1];
  // Default → Classic Hero's Fall
  return EMOTIONAL_ARCS[0];
}
