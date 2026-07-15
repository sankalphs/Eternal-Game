// ============================================================================
// PHASE 3: PROMPT BUILDER
//
// Separates prompting completely from gameplay. Receives structured context,
// outputs prompt sets. Templates are configurable — never hardcoded in
// gameplay systems.
// ============================================================================

import type { AIContext, PromptSet } from "./types";

// Allowed values — the model must choose from these. The Schema Validator
// (Phase 6) enforces this on the output side.
const ALLOWED = {
  weather: ["clear", "fog", "rain", "thunder", "snow", "ash", "fireflies", "blood_moon", "cherry_blossoms", "solar_eclipse", "dust_storm"],
  lighting: ["bright", "normal", "dim", "dark", "blood", "foggy", "eclipse"],
  camera: ["wide", "close", "cinematic", "handheld", "dynamic_zoom", "boss_focus", "dutch_angle", "slow_zoom"],
  music: ["peaceful", "epic", "dark", "hopeless", "victory", "ancient", "percussion", "choir", "silence"],
  crowd: ["cheering", "silent", "praying", "running", "burning_city", "monks", "ruined_kingdom"],
  bossStyle: ["aggressive", "counter", "defensive", "patient", "rushdown", "mind_game", "punisher", "adaptive", "zoner"],
  dialogueStyle: ["taunting", "cold", "rage", "calm", "despair", "none"],
  difficulty: ["easy", "normal", "hard", "brutal", "nightmare", "adaptive"],
};

// Configurable prompt templates. Can be swapped without code changes.
export interface PromptTemplate {
  system: string;
  developer: string;
  outputSchema: string;
  fewShot: { input: string; output: string }[];
}

export const DEFAULT_TEMPLATE: PromptTemplate = {
  system: `You are the AI Director of "Eternal", a cinematic fighting game. Your job is to plan the next fight to create the most emotionally impactful experience for this specific player.

You receive structured context about the player's behaviour, psychology, predictions, world state, and campaign position. You output a JSON object describing the fight configuration.

Rules:
- Choose ONLY from the allowed values listed in the schema.
- Every choice should serve the emotional objective.
- Counter the player's predicted behaviour through boss style and hazards.
- The world state should influence the atmosphere (corruption → ash/darkness).
- Never output values outside the allowed sets.`,
  developer: `Output ONLY a valid JSON object. No markdown, no explanation, no wrapping. The object must have exactly these fields:
{
  "weather": string,
  "lighting": string,
  "camera": string,
  "music": string,
  "crowd": string,
  "hazards": string[],
  "bossStyle": string,
  "bossEmotion": string,
  "dialogueStyle": string,
  "difficulty": string,
  "arenaStage": number (0-5),
  "narrative": string (one sentence),
  "intent": string (one sentence describing the Director's goal)
}

ALLOWED VALUES:
- weather: ${ALLOWED.weather.join(", ")}
- lighting: ${ALLOWED.lighting.join(", ")}
- camera: ${ALLOWED.camera.join(", ")}
- music: ${ALLOWED.music.join(", ")}
- crowd: ${ALLOWED.crowd.join(", ")}
- hazards (array of): ${ALLOWED.weather.join(", ")}, "volcano", "temple_debris", "ice_floor", "poison_mist", "earthquake", "fire_rain", "darkness", "wind_gusts", "none"
- bossStyle: ${ALLOWED.bossStyle.join(", ")}
- dialogueStyle: ${ALLOWED.dialogueStyle.join(", ")}
- difficulty: ${ALLOWED.difficulty.join(", ")}`,
  outputSchema: JSON.stringify({
    type: "object",
    properties: {
      weather: { type: "string", enum: ALLOWED.weather },
      lighting: { type: "string", enum: ALLOWED.lighting },
      camera: { type: "string", enum: ALLOWED.camera },
      music: { type: "string", enum: ALLOWED.music },
      crowd: { type: "string", enum: ALLOWED.crowd },
      hazards: { type: "array", items: { type: "string" } },
      bossStyle: { type: "string", enum: ALLOWED.bossStyle },
      bossEmotion: { type: "string" },
      dialogueStyle: { type: "string", enum: ALLOWED.dialogueStyle },
      difficulty: { type: "string", enum: ALLOWED.difficulty },
      arenaStage: { type: "number", minimum: 0, maximum: 5 },
      narrative: { type: "string" },
      intent: { type: "string" },
    },
    required: ["weather", "bossStyle", "difficulty", "intent"],
  }),
  fewShot: [
    {
      input: `{"features":{"aggression":0.8,"patience":0.2},"prediction":{"kickSpam":0.7},"campaign":{"currentEmotion":"fear"},"worldState":{"corruption":0.3}}`,
      output: `{"weather":"fog","lighting":"dim","camera":"close","music":"dark","crowd":"silent","hazards":["temple_debris"],"bossStyle":"counter","bossEmotion":"cold and calculating","dialogueStyle":"cold","difficulty":"hard","arenaStage":1,"narrative":"The fog hides what you cannot see.","intent":"Make the player uncomfortable by countering their aggression."}`,
    },
    {
      input: `{"features":{"aggression":0.2,"patience":0.8},"prediction":{"blockTurtle":0.7},"campaign":{"currentEmotion":"rage"},"worldState":{"corruption":0.6}}`,
      output: `{"weather":"ash","lighting":"dark","camera":"handheld","music":"percussion","crowd":"burning_city","hazards":["fire_rain","volcano"],"bossStyle":"rushdown","bossEmotion":"enraged","dialogueStyle":"rage","difficulty":"brutal","arenaStage":3,"narrative":"The world burns. There is no defense left.","intent":"Break the player's turtle strategy with relentless pressure."}`,
    },
  ],
};

export class PromptBuilder {
  private template: PromptTemplate;

  constructor(template?: PromptTemplate) {
    this.template = template ?? DEFAULT_TEMPLATE;
  }

  /**
   * Build a complete prompt set from an AIContext.
   */
  build(context: AIContext): PromptSet {
    const contextStr = JSON.stringify(context, null, 0);

    const user = `Context:
${contextStr}

Based on this context, output the fight configuration JSON.`;

    return {
      system: this.template.system,
      developer: this.template.developer,
      user,
      outputSchema: this.template.outputSchema,
      fewShot: this.template.fewShot,
    };
  }

  /**
   * Swap the prompt template at runtime (for A/B testing or model tuning).
   */
  setTemplate(template: PromptTemplate): void {
    this.template = template;
  }

  /**
   * Get the allowed values (for the Schema Validator to import).
   */
  static getAllowedValues() {
    return ALLOWED;
  }
}
