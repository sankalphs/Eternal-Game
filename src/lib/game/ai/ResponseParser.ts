// ============================================================================
// PHASE 5: RESPONSE PARSER
//
// Never trusts model output. Parses AI responses into AIDirectorOutput,
// recovering from malformed JSON, missing fields, extra fields, and
// unknown values whenever possible.
// ============================================================================

import type { AIDirectorOutput } from "./types";
import { PromptBuilder } from "./PromptBuilder";

const ALLOWED = PromptBuilder.getAllowedValues();

export class ResponseParser {
  /**
   * Parse a raw model response string into an AIDirectorOutput.
   * Recovers from common issues: markdown wrapping, partial JSON, etc.
   */
  parse(raw: string): { output: AIDirectorOutput | null; warnings: string[] } {
    const warnings: string[] = [];

    // 1. Strip markdown code fences if present
    let text = raw.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    // 2. Try to parse as JSON
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON from the text (model might have added prose)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          warnings.push("Response is not valid JSON, even after extraction.");
          return { output: null, warnings };
        }
      } else {
        warnings.push("Response contains no JSON object.");
        return { output: null, warnings };
      }
    }

    // 3. Handle missing fields with defaults
    const get = (key: string, fallback: any) => {
      if (parsed[key] === undefined || parsed[key] === null) {
        warnings.push(`Missing field: ${key}, using fallback.`);
        return fallback;
      }
      return parsed[key];
    };

    // 4. Normalize types (model might output wrong types)
    const str = (v: any, fallback: string): string => {
      if (typeof v === "string") return v;
      if (typeof v === "number") return String(v);
      warnings.push(`Expected string, got ${typeof v}, using fallback.`);
      return fallback;
    };

    const arr = (v: any): string[] => {
      if (Array.isArray(v)) return v.map((x) => String(x));
      if (typeof v === "string") return v.split(",").map((s) => s.trim());
      warnings.push("Expected array, using empty array.");
      return [];
    };

    const num = (v: any, fallback: number): number => {
      const n = Number(v);
      if (isNaN(n)) { warnings.push(`Expected number, using fallback.`); return fallback; }
      return n;
    };

    const output: AIDirectorOutput = {
      weather: str(get("weather", "clear"), "clear"),
      lighting: str(get("lighting", "normal"), "normal"),
      camera: str(get("camera", "wide"), "wide"),
      music: str(get("music", "ancient"), "ancient"),
      crowd: str(get("crowd", "silent"), "silent"),
      hazards: arr(get("hazards", [])),
      bossStyle: str(get("bossStyle", "aggressive"), "aggressive"),
      bossEmotion: str(get("bossEmotion", "resolute"), "resolute"),
      dialogueStyle: str(get("dialogueStyle", "cold"), "cold"),
      difficulty: str(get("difficulty", "normal"), "normal"),
      arenaStage: Math.max(0, Math.min(5, Math.round(num(get("arenaStage", 0), 0)))),
      narrative: str(get("narrative", "A standard encounter."), "A standard encounter."),
      intent: str(get("intent", "Provide a challenging fight."), "Provide a challenging fight."),
    };

    // 5. Drop extra fields (silently — we only take what we need)
    // No action needed — we constructed a clean object above.

    return { output, warnings };
  }
}
