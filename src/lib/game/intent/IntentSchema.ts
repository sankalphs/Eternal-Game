// ============================================================================
// PROJECT ETERNAL — RESEARCH SCHEMA
// INTENT-ONLY OUTPUT
//
// The fine-tuned Game Designer model is NOT responsible for low-level
// gameplay values. The LLM emits ONLY:
//
//   - intent                  (what the next fight is FOR)
//   - reasoning               (WHY the model chose this intent)
//   - expectedPlayerReaction  (what should change in the player)
//   - highLevelPlan           (a 1-3 sentence abstract plan)
//   - confidence              (model self-assessment 0..1)
//
// The deterministic Director (DirectorEngineV3) translates intent into
// weather, lighting, camera, music, hazards, boss style, difficulty,
// dialogue, and cinematics. The combat engine, physics, and rendering
// remain untouched.
//
// This is the new training target. See REFACTOR_NOTES.md for the
// migration from the legacy GameDesignPlan.
// ============================================================================

/**
 * The five fields the model produces. NOTHING ELSE.
 */
export interface IntentOutput {
  /**
   * Short label of what this fight is FOR.
   * Examples:
   *   "Break overconfidence"
   *   "Reward patience after a streak of close wins"
   *   "Punish turtling"
   *   "Test adaptability against a new archetype"
   *   "Deliver a cinematic narrative beat"
   *   "Tighten spacing pressure on a corner-hugger"
   */
  intent: string;

  /**
   * A few sentences explaining WHY the model chose this intent. This is
   * used at inference time for the explanation panel, and at training
   * time as part of the supervision signal.
   */
  reasoning: string;

  /**
   * The model's prediction of what the player will DO in response to
   * the upcoming fight. Used by the Director to calibrate pressure.
   * Examples:
   *   "Player will start spacing and observing"
   *   "Player will commit to panic rolls"
   *   "Player will hold super for a comeback attempt"
   */
  expectedPlayerReaction: string;

  /**
   * A 1-3 sentence abstract plan. NO weather, NO camera, NO music, NO
   * hazards, NO specific boss, NO specific difficulty. Only the
   * abstract shape of the fight.
   * Examples:
   *   "A patient counter encounter that punishes dash-in approaches.
   *    Space the player out, then collapse on whiffs."
   *   "A teaching fight with a moderate pressure genome. The player
   *    should learn to read tells before throwing."
   *   "A short, decisive reward. Give the player a controlled win
   *    that lets them feel mastery."
   */
  highLevelPlan: string;

  /**
   * Model self-assessment. 0..1. Honest calibration matters — the
   * Director uses this to decide whether to follow the model or fall
   * back to the deterministic V3 baseline.
   */
  confidence: number;
}

/**
 * JSON Schema for the IntentOutput. Used by the OutputValidator, the
 * PromptLibrary, and the dataset exporter.
 */
export const INTENT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "reasoning", "expectedPlayerReaction", "highLevelPlan", "confidence"],
  properties: {
    intent: {
      type: "string",
      minLength: 4,
      maxLength: 120,
      description: "Short label of what this fight is FOR.",
    },
    reasoning: {
      type: "string",
      minLength: 8,
      maxLength: 800,
      description: "Why the model chose this intent. 1-5 sentences.",
    },
    expectedPlayerReaction: {
      type: "string",
      minLength: 4,
      maxLength: 200,
      description: "What the player will likely do in response.",
    },
    highLevelPlan: {
      type: "string",
      minLength: 8,
      maxLength: 400,
      description: "Abstract shape of the fight. 1-3 sentences. No low-level values.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Model self-assessment 0..1.",
    },
  },
} as const;

/**
 * Canonical buckets of intent. These are NOT outputs the model must
 * choose from. They are normalisation labels used by the
 * IntentTranslator and the dataset categoriser. The model may emit a
 * free-form intent string; the categoriser maps it to one of these.
 */
export const INTENT_CATEGORIES = [
  "challenge",          // raise pressure
  "teach",              // expose a habit
  "reward",             // controlled win
  "punish",             // counter a habit
  "escalate",           // raise intensity
  "de_escalate",        // lower intensity
  "reintroduce",        // bring back an earlier style
  "conclude",           // narrative closure
  "experiment",         // try a curiosity/experiment
  "teach_defense",      // force the player to block/spacing
  "teach_offense",      // force the player to commit
  "destabilise",        // break player rhythm
  "settle",             // stabilise after a high intensity
  "narrative_beat",     // pure narrative, low challenge
  "unknown",
] as const;

export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

/**
 * Cheap keyword-based intent categoriser. Used for telemetry, dataset
 * analysis, and as a soft prior for the IntentTranslator.
 */
export function categoriseIntent(intent: string): IntentCategory {
  const s = intent.toLowerCase();
  // Order matters: more specific patterns MUST come first.
  // "de-escalate" would otherwise match the "escalat" regex.
  if (/(reintroduc|recall|return\s+to|earlier\s+style)/.test(s)) return "reintroduce";
  if (/(conclu|close\s+the|finale|farewell|end\s+the\s+campaign)/.test(s)) return "conclude";
  if (/(experiment|trial|curiosit|probe\s+a\s+new)/.test(s)) return "experiment";
  if (/(de[\s-]?escalat|low\s+the\s+stakes|cool\s+down|ease\s+off|breath)/.test(s)) return "de_escalate";
  if (/(escalat|rais\s+the\s+intensit|peak\s+the|climax\s+at)/.test(s)) return "escalate";
  if (/(narrat|story[\s-]?driven|cinematic|lore|legend|myth)/.test(s)) return "narrative_beat";
  if (/(settle\s+the|recover\s+from|reset\s+the|stabili)/.test(s)) return "settle";
  if (/(overconfid|rushing|reckless|dominan|take\s+them\s+down)/.test(s)) return "punish";
  if (/(panic|frustrat|tilted|chok|give\s+them\s+a\s+win)/.test(s)) return "reward";
  if (/(turtl|defensive|camping|hugging\s+the\s+block)/.test(s)) return "destabilise";
  if (/(patient|spacing|observe|cautious|respect\s+the)/.test(s)) return "challenge";
  if (/(new\s+mechanic|first\s+time|novel|never\s+seen|unique)/.test(s)) return "teach";
  if (/(teach\s+them|teach\s+the\s+player|teach\s+to|teach\s+a)/.test(s)) return "teach";
  if (/(force\s+(?:engagement|commit)|teach\s+them\s+to\s+(?:block|parry))/.test(s)) return "teach_defense";
  if (/(force\s+them\s+to\s+commit|teach\s+them\s+to\s+attack)/.test(s)) return "teach_offense";
  if (/(adapt\s+to|learn\s+their|break\s+the\s+habit|expose\s+the)/.test(s)) return "teach";
  return "unknown";
}
