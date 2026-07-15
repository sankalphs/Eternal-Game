// ============================================================================
// PROJECT ETERNAL — INTENT OUTPUT VALIDATOR
//
// Validates a parsed IntentOutput against the INTENT_OUTPUT_SCHEMA.
// Returns a cleaned output, list of warnings, and list of errors.
// ============================================================================

import {
  INTENT_OUTPUT_SCHEMA,
  type IntentOutput,
} from "./IntentSchema";

export interface IntentValidationResult {
  output: IntentOutput;
  errors: string[];
  warnings: string[];
}

export interface RawIntentOutput {
  intent?: unknown;
  reasoning?: unknown;
  expectedPlayerReaction?: unknown;
  highLevelPlan?: unknown;
  confidence?: unknown;
}

const SCHEMA_PROPS = INTENT_OUTPUT_SCHEMA.properties;

/**
 * Validate and clean a raw parsed JSON object into an IntentOutput.
 * NEVER throws. Always returns a usable object (with confidence=0 on
 * hard failure so the Director knows to fall back).
 */
export function validateIntentOutput(raw: unknown): IntentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== "object") {
    return {
      output: emptyIntentOutput("validation: not an object"),
      errors: ["raw output is not an object"],
      warnings,
    };
  }
  const r = raw as RawIntentOutput;

  // Reject extra fields
  const allowed = new Set(Object.keys(SCHEMA_PROPS));
  for (const k of Object.keys(r)) {
    if (!allowed.has(k)) warnings.push(`ignored unknown field "${k}"`);
  }

  const intent = cleanString(r.intent, "intent", errors);
  const reasoning = cleanString(r.reasoning, "reasoning", errors);
  const expectedPlayerReaction = cleanString(r.expectedPlayerReaction, "expectedPlayerReaction", errors);
  const highLevelPlan = cleanString(r.highLevelPlan, "highLevelPlan", errors);
  const confidence = cleanConfidence(r.confidence, errors);

  // Length checks
  if (intent && intent.length < (SCHEMA_PROPS.intent as { minLength: number }).minLength) {
    errors.push(`intent too short (${intent.length} chars)`);
  }
  if (intent && intent.length > (SCHEMA_PROPS.intent as { maxLength: number }).maxLength) {
    warnings.push(`intent truncated to maxLength`);
  }

  const output: IntentOutput = {
    intent: intent ?? "Engage the player.",
    reasoning: reasoning ?? "No reasoning provided.",
    expectedPlayerReaction: expectedPlayerReaction ?? "Player engages normally.",
    highLevelPlan: highLevelPlan ?? "A baseline encounter.",
    confidence,
  };

  // Hard fail checks
  const required = INTENT_OUTPUT_SCHEMA.required as readonly (keyof IntentOutput)[];
  for (const f of required) {
    if (!output[f] && f !== "confidence") {
      errors.push(`missing required field "${f}"`);
    }
  }

  return { output, errors, warnings };
}

function cleanString(v: unknown, field: string, errors: string[]): string | null {
  if (v === null || v === undefined) {
    errors.push(`missing field "${field}"`);
    return null;
  }
  if (typeof v !== "string") {
    errors.push(`field "${field}" must be a string`);
    return null;
  }
  const trimmed = v.trim();
  if (trimmed.length === 0) {
    errors.push(`field "${field}" is empty`);
    return null;
  }
  return trimmed;
}

function cleanConfidence(v: unknown, errors: string[]): number {
  if (v === null || v === undefined) {
    errors.push("missing field \"confidence\"");
    return 0;
  }
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  if (typeof n !== "number" || isNaN(n)) {
    errors.push("confidence is not a number");
    return 0;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

function emptyIntentOutput(reason: string): IntentOutput {
  return {
    intent: `Fallback: ${reason}`,
    reasoning: "Validation produced an empty intent output.",
    expectedPlayerReaction: "Unknown.",
    highLevelPlan: "A baseline encounter.",
    confidence: 0,
  };
}
