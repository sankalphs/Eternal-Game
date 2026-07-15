// ============================================================================
// PHASE 6: SCHEMA VALIDATOR
//
// Validates every AI output. Only allowed values pass through. Rejects
// unknown values like "pizza", "banana", "dragon". Every DirectorPlan is
// guaranteed safe before reaching the game engine.
// ============================================================================

import type { AIDirectorOutput } from "./types";
import { PromptBuilder } from "./PromptBuilder";

const ALLOWED = PromptBuilder.getAllowedValues();
const ALLOWED_HAZARDS = [
  "volcano", "temple_debris", "ice_floor", "poison_mist", "earthquake",
  "fire_rain", "darkness", "wind_gusts", "none",
  // Weather types can also be hazards
  ...ALLOWED.weather,
];

export interface ValidationResult {
  valid: boolean;
  output: AIDirectorOutput;     // sanitized (invalid values replaced with defaults)
  errors: string[];
  warnings: string[];
}

export class SchemaValidator {
  validate(output: AIDirectorOutput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sanitized = { ...output };

    // Validate each field against allowed values
    this.validateEnum(sanitized, "weather", ALLOWED.weather, "clear", errors);
    this.validateEnum(sanitized, "lighting", ALLOWED.lighting, "normal", errors);
    this.validateEnum(sanitized, "camera", ALLOWED.camera, "wide", errors);
    this.validateEnum(sanitized, "music", ALLOWED.music, "ancient", errors);
    this.validateEnum(sanitized, "crowd", ALLOWED.crowd, "silent", errors);
    this.validateEnum(sanitized, "bossStyle", ALLOWED.bossStyle, "aggressive", errors);
    this.validateEnum(sanitized, "dialogueStyle", ALLOWED.dialogueStyle, "cold", errors);
    this.validateEnum(sanitized, "difficulty", ALLOWED.difficulty, "normal", errors);

    // Validate hazards array
    if (!Array.isArray(sanitized.hazards)) {
      errors.push("hazards must be an array.");
      sanitized.hazards = [];
    } else {
      sanitized.hazards = sanitized.hazards.filter((h) => {
        if (ALLOWED_HAZARDS.includes(h)) return true;
        warnings.push(`Unknown hazard "${h}" rejected.`);
        return false;
      });
    }

    // Validate arenaStage
    if (typeof sanitized.arenaStage !== "number" || sanitized.arenaStage < 0 || sanitized.arenaStage > 5) {
      warnings.push(`arenaStage ${sanitized.arenaStage} out of range, clamped to 0.`);
      sanitized.arenaStage = 0;
    }

    // Validate required strings
    if (!sanitized.intent || sanitized.intent.trim().length === 0) {
      warnings.push("intent is empty, using fallback.");
      sanitized.intent = "Provide a challenging fight.";
    }
    if (!sanitized.narrative || sanitized.narrative.trim().length === 0) {
      sanitized.narrative = "A standard encounter.";
    }
    if (!sanitized.bossEmotion || sanitized.bossEmotion.trim().length === 0) {
      sanitized.bossEmotion = "resolute";
    }

    // The output is "valid" if there are no ERRORS (warnings are acceptable)
    const valid = errors.length === 0;

    return { valid, output: sanitized, errors, warnings };
  }

  private validateEnum(
    obj: AIDirectorOutput,
    field: keyof AIDirectorOutput,
    allowed: string[],
    fallback: string,
    errors: string[],
  ): void {
    const value = obj[field] as string;
    if (!allowed.includes(value)) {
      errors.push(`Invalid ${field}: "${value}". Allowed: ${allowed.join(", ")}. Using fallback "${fallback}".`);
      (obj[field] as string) = fallback;
    }
  }
}
