// ============================================================================
// POST-MATCH ANALYSIS — Qwen only after the fight
//
// During combat the game uses the Classic Director (deterministic). After the
// match we optionally call Qwen for a short written analysis and to pick the
// next GA genome style. Player model fields (grade, archetype, traits) stay
// local and deterministic via computeAIDebrief.
// ============================================================================

import type { GameEngine } from "./engine";
import type { AIDebriefSnapshot } from "./directorJournal";
import type { GenomeStyle } from "./evolution/types";

export interface IntentLike {
  intent: string;
  reasoning: string;
  expectedPlayerReaction: string;
  highLevelPlan: string;
  confidence: number;
}

export interface PostMatchQwenResult {
  intent: IntentLike;
  model: string;
  latencyMs: number;
  selectedStyle: GenomeStyle;
  summary: string;
}

const GENE_KEYS = [
  "aggression",
  "blockChance",
  "reaction",
  "combo",
  "whiffPunish",
  "antiAir",
  "pressure",
  "mixup",
  "adaptive",
  "rage",
  "perfection",
  "readDelay",
] as const;

const STYLE_KEYWORDS: { style: GenomeStyle; re: RegExp }[] = [
  { style: "counter", re: /(counter|punish|whiff|reckless|overcommit)/i },
  { style: "zoner", re: /(space|spacing|zone|keep.?away|footsies)/i },
  { style: "pressure", re: /(pressure|corner|attrition|chip|relentless)/i },
  { style: "patient", re: /(patient|wait|slow|tempo|read)/i },
  { style: "rushdown", re: /(rush|aggress|close.?in|blitz|forward)/i },
  { style: "mindGame", re: /(mind.?game|mix.?up|unpredict|decept)/i },
  { style: "adaptive", re: /(adapt|adjust|opportun|flex)/i },
  { style: "aggressive", re: /(aggressive|offense|strike.?first)/i },
  { style: "balanced", re: /(balance|baseline|control)/i },
];

/** Map free-form Qwen intent text → a frozen GenomeStyle. */
export function selectGenomeStyleFromIntent(intent: IntentLike): GenomeStyle {
  const blob = `${intent.intent} ${intent.reasoning} ${intent.highLevelPlan} ${intent.expectedPlayerReaction}`;
  for (const { style, re } of STYLE_KEYWORDS) {
    if (re.test(blob)) return style;
  }
  return "adaptive";
}

/** Local one-paragraph summary when Qwen is unavailable. */
export function buildLocalSummary(
  engine: GameEngine,
  ai: AIDebriefSnapshot,
  result: "win" | "loss",
): string {
  const playerHp = Math.round(
    (engine.player.hp / Math.max(1, engine.player.maxHp)) * 100,
  );
  const enemyHp = Math.round(
    (engine.enemy.hp / Math.max(1, engine.enemy.maxHp)) * 100,
  );
  const outcome =
    result === "win"
      ? "You closed the encounter ahead on momentum"
      : "The sealer held the line against you";
  const topTrait = topPlayerTrait(ai);
  return (
    `${outcome} as a ${ai.archetype} (grade ${ai.adaptationScore}). ` +
    `Combat signature peaked on ${topTrait}; final HP sat at ${playerHp}% vs ${enemyHp}%. ` +
    `${ai.archetypeObservations[0] ?? "Habits shifted mid-round."} ` +
    `Next plan: ${ai.nextStrategy}`
  );
}

function topPlayerTrait(ai: AIDebriefSnapshot): string {
  const entries = Object.entries(ai.traits) as [string, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const [key, val] = entries[0] ?? ["adaptability", 50];
  const labels: Record<string, string> = {
    aggression: "aggression",
    patience: "patience",
    exploration: "exploration",
    riskTaking: "risk-taking",
    adaptability: "adaptability",
  };
  return `${labels[key] ?? key} (${val}%)`;
}

/** Prefer Qwen prose; fall back to local summary. */
export function buildAnalysisSummary(
  engine: GameEngine,
  ai: AIDebriefSnapshot,
  result: "win" | "loss",
  qwen: IntentLike | null,
): string {
  if (qwen) {
    const plan = (qwen.highLevelPlan || "").trim();
    const reason = (qwen.reasoning || "").trim();
    const intent = (qwen.intent || "").trim();
    const parts = [
      intent ? `Intent: ${intent}.` : "",
      reason,
      plan,
    ].filter(Boolean);
    if (parts.join(" ").length > 40) {
      return parts.join(" ").replace(/\s+/g, " ").trim();
    }
  }
  return buildLocalSummary(engine, ai, result);
}

export function buildPostMatchDirectorContext(
  engine: GameEngine,
  result: "win" | "loss",
  ai: AIDebriefSnapshot,
) {
  const combat = engine.ai.getState();
  return {
    phase: "post_match_analysis",
    result,
    opponent: {
      index: engine.opponentIndex,
      name: engine.opponent.name,
      title: engine.opponent.title,
      bodyType: engine.opponent.bodyType,
    },
    chapter: {
      index: engine.opponentIndex,
      total: 7,
      currentIntent: engine.directorState.intent,
    },
    player: {
      wins: engine.playerWins,
      losses: engine.enemyWins,
      maxCombo: engine.maxCombo,
      hpFraction: engine.player.hp / Math.max(1, engine.player.maxHp),
      archetype: ai.archetype,
      traits: ai.traits,
      grade: ai.adaptationScore,
    },
    enemy: {
      mode: combat.mode,
      hpFraction: combat.selfHpFrac,
      usingEvolvedGenome: engine.useChampionGenome,
    },
    task:
      "Analyze the finished match. Return intent + reasoning as a short post-match " +
      "player analysis, and a highLevelPlan that implies which genome style should " +
      "face the player next (counter, pressure, patient, rushdown, zoner, adaptive, " +
      "mindGame, aggressive, or balanced).",
  };
}

/** Normalize champion / library JSON into the engine champion payload shape. */
export function genomePayloadFromRaw(
  raw: Record<string, unknown>,
  style: GenomeStyle,
): {
  id: string | null;
  source: string;
  generation: number;
  version: string | null;
  genes: Record<string, number>;
  style: GenomeStyle;
} {
  const genes: Record<string, number> = {};
  const nested =
    raw.genes && typeof raw.genes === "object"
      ? (raw.genes as Record<string, unknown>)
      : raw;
  for (const k of GENE_KEYS) {
    const v = nested[k];
    if (typeof v === "number") genes[k] = v;
  }
  return {
    id: typeof raw.id === "string" ? raw.id : null,
    source: typeof raw.source === "string" ? raw.source : `style:${style}`,
    generation: typeof raw.generation === "number" ? raw.generation : 0,
    version: typeof raw.version === "string" ? raw.version : null,
    genes,
    style,
  };
}
