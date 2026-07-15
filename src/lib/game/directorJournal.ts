"use client";

// ============================================================================
// DIRECTOR JOURNAL
//
// A small in-memory store that lives for the lifetime of the page. The
// Director's runtime state is rebuilt by the engine once per match; this
// journal records what the Director *did*, in plain language, so it can
// be surfaced in three places at once:
//
//   - The floating AI Director card (live, fades in/out).
//   - The Director Timeline (read inside the Director panel).
//   - The post-battle AI Debrief (read by the MatchDebriefPanel).
//
// This file is the SINGLE source of truth. Components do not write to
// it directly — they subscribe, and the engine watcher in EternalGame
// publishes into it via the small helpers below.
//
// All numeric/semantic values that drive the journal entries come from
// the existing `engine.directorState`. There is NO new Director logic
// here, no LLM call, no extra computation — just translation of the
// runtime state into narrator language.
// ============================================================================

import { useEffect, useState } from "react";
import type { GameEngine } from "@/lib/game/engine";
import type { DirectorRuntimeState } from "@/lib/game/director/DirectorRuntime";

const MAX_ENTRIES = 20;
const MAX_ENCOUNTER_HISTORY = 5;

// ---------------------------------------------------------------------------
// Public entry shape — used by every overlay component.
// ---------------------------------------------------------------------------
export interface DirectorJournalEntry {
  /** epoch ms when the Director took the action */
  timestamp: number;
  /** human-readable seconds-since-fight-start */
  t: number;
  /** "Restore Tension" / "Reward Curiosity" / etc. (narrator tone) */
  intent: string;
  /** short reason the player can read while the action is happening */
  reason: string;
  /** the theory the Director is currently testing */
  hypothesis: string;
  /** what the Director expects the player to do next */
  prediction: string;
  /** Director's confidence in the prediction, 0..100 */
  confidence: number;
  /** list of cinematic + gameplay knobs the Director applied */
  actions: string[];
  /** filled in later if it becomes known */
  result?: string;
}

// ---------------------------------------------------------------------------
// Module-level store. We avoid Context so the children of the canvas can
// subscribe cheaply and re-render only the parts that care.
// ---------------------------------------------------------------------------
type Listener = () => void;

class DirectorJournalStore {
  private entries: DirectorJournalEntry[] = [];
  private liveIntentCard: DirectorJournalEntry | null = null;
  private liveActionVisualizer: { intent: string; actions: string[] } | null =
    null;
  private listeners = new Set<Listener>();
  /** Sliding window of recent encounter summaries (most-recent last). */
  private recentEncounters: import("./directorJournal").EncounterRecord[] = [];
  /** "Hypothesis Confirmed" / "Unexpected Behaviour" toast. */
  private notification: import("./directorJournal").DirectorNotification | null =
    null;

  // ---- subscriptions --------------------------------------------------
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  // ---- reads ---------------------------------------------------------
  getEntries(): DirectorJournalEntry[] {
    return this.entries;
  }
  getLiveIntent(): DirectorJournalEntry | null {
    return this.liveIntentCard;
  }
  getLiveAction(): { intent: string; actions: string[] } | null {
    return this.liveActionVisualizer;
  }
  getRecentEncounters(): EncounterRecord[] {
    return this.recentEncounters;
  }
  getNotification(): DirectorNotification | null {
    return this.notification;
  }

  // ---- writes --------------------------------------------------------
  push(entry: DirectorJournalEntry) {
    this.entries = [entry, ...this.entries].slice(0, MAX_ENTRIES);
    this.liveIntentCard = entry;
    this.emit();
  }
  clearLiveIntent() {
    if (this.liveIntentCard !== null) {
      this.liveIntentCard = null;
      this.emit();
    }
  }
  showAction(payload: { intent: string; actions: string[] }) {
    this.liveActionVisualizer = payload;
    this.emit();
    // Action visualizer auto-clears after ~1.4s
    setTimeout(() => {
      if (this.liveActionVisualizer === payload) {
        this.liveActionVisualizer = null;
        this.emit();
      }
    }, 1400);
  }
  reset() {
    this.entries = [];
    this.liveIntentCard = null;
    this.liveActionVisualizer = null;
    this.emit();
  }
  attachResult(timestamp: number, result: string) {
    this.entries = this.entries.map((e) =>
      e.timestamp === timestamp ? { ...e, result } : e,
    );
    this.emit();
  }

  pushEncounter(record: EncounterRecord) {
    this.recentEncounters = [...this.recentEncounters, record].slice(
      -MAX_ENCOUNTER_HISTORY,
    );
    this.emit();
  }

  showNotification(n: DirectorNotification) {
    this.notification = n;
    this.emit();
    setTimeout(() => {
      if (this.notification === n) {
        this.notification = null;
        this.emit();
      }
    }, 2200);
  }
}

const store = new DirectorJournalStore();

// Public helper for any consumer to clear (used on match reset).
export const directorJournal = store;

// ---------------------------------------------------------------------------
// useDirectorJournal — re-renders on every change. Cheap because subscribers
// are tiny; the components below are already gated on visibility.
// ---------------------------------------------------------------------------
export function useDirectorJournal() {
  const [, setN] = useState(0);
  useEffect(() => store.subscribe(() => setN((n) => n + 1)), []);
  return {
    entries: store.getEntries(),
    liveIntent: store.getLiveIntent(),
    liveAction: store.getLiveAction(),
    recentEncounters: store.getRecentEncounters(),
    notification: store.getNotification(),
  };
}

// ===========================================================================
// INTENT-FIRST LIBRARY
//
// All "intent → reason → prediction" strings are pre-authored in narrator
// voice. They are derived purely from intent + simple runtime observations
// (HP, win count, dominant habit). No LLM. No new Director computation.
// ===========================================================================

export interface IntentCopy {
  /** one-line observable trend seen in the player's behaviour */
  observation: string;
  /** the intent the Director commits to in response */
  intent: string;
  /** why the Director picked this intent */
  reason: string;
  /** the theory the Director is currently testing — sounds like a hypothesis */
  hypothesis: string;
  /** what the Director expects the player will do next */
  prediction: string;
  /** baseline confidence 60–95 depending on how well the intent fits */
  confidence: number;
  /** titles for the cinematic / gameplay knobs applied */
  actions: string[];
}

// Observation → Intent. Keys match prose reasons we detect from `engine`.
const INTENT_LIBRARY: Record<string, IntentCopy> = {
  alpha_player: {
    observation: "Player dominates the round.",
    intent: "Restore Tension",
    reason: "Player defeated the previous encounter without taking damage.",
    hypothesis:
      "Stripping the player's comfort turns confidence into hesitation.",
    prediction: "Player will become more cautious.",
    confidence: 92,
    actions: ["Hard Rim Lighting", "Ash Storm", "Handheld Camera"],
  },
  aggressive_spree: {
    observation: "Combat becoming repetitive.",
    intent: "Increase Variation",
    reason: "Player has won three fights in identical fashion.",
    hypothesis:
      "A wider camera breaks the rhythm the player has been relying on.",
    prediction: "Player hesitates before rushing in.",
    confidence: 84,
    actions: ["Underlight", "Reduce Healing", "Wider Camera"],
  },
  low_hp_player: {
    observation: "Player under pressure.",
    intent: "Extend Pressure",
    reason: "Player recovering too easily. Pressure extended.",
    hypothesis: "A closer camera shrinks the safe ground the player reads.",
    prediction: "Player slows movement and plays defensively.",
    confidence: 88,
    actions: ["Closer Camera", "Increase Hitstop", "Low Music"],
  },
  passive_player: {
    observation: "Player playing too safe.",
    intent: "Invite Exploration",
    reason: "Player holding back. Reward curiosity.",
    hypothesis: "An open composition entices the player toward the centre.",
    prediction: "Player advances once space opens.",
    confidence: 78,
    actions: ["Open Composition", "Soft Lighting", "Lower Intensity"],
  },
  first_blood_player: {
    observation: "Player draws first blood.",
    intent: "Acknowledge the Strike",
    reason: "Player lands first decisive hit. The world registers it.",
    hypothesis:
      "A brief slow-motion beat tells the player the hit had weight.",
    prediction: "Player grows bolder; opponent reads need to escalate.",
    confidence: 86,
    actions: ["Brief Slowmo", "Ember Drift", "Camera Recoil"],
  },
  comeback_player: {
    observation: "Player recovering.",
    intent: "Hold the Frame",
    reason: "Player turns momentum. World refuses to flatten it.",
    hypothesis:
      "A wide pull grants the climb a stage to land on.",
    prediction: "Player presses the advantage into the next round.",
    confidence: 81,
    actions: ["Wide Pull", "Halo Lighting", "Long Sun Theme"],
  },
  dominant_enemy: {
    observation: "Enemy dominant.",
    intent: "Escalation",
    reason: "Enemy AI is overpowering the player.",
    hypothesis: "Dimming the world lowers the player's safety margin.",
    prediction: "Player adapts tactics or stalls for time.",
    confidence: 75,
    actions: ["Increase Hitstop", "Reduce Healing", "Dim Lighting"],
  },
  mid_match: {
    observation: "Mid-match tension.",
    intent: "Sustain Pressure",
    reason: "Momentum held evenly. Keep uncertainty.",
    hypothesis:
      "Holding the camera steady denies the player a tempo to settle into.",
    prediction: "Player searches for an opening.",
    confidence: 72,
    actions: ["Steady Camera", "Persistent Weather", "Constant Music"],
  },
};

// Fallback for intent transitions or unknown intents — derived from
// `directorState.intent` so the journal still has tone.
const INTENT_FALLBACK_BY_INTENT: Record<string, IntentCopy> = {
  revenge: INTENT_LIBRARY.aggressive_spree,
  revelation: INTENT_LIBRARY.comeback_player,
  defiance: INTENT_LIBRARY.dominant_enemy,
  grief: INTENT_LIBRARY.passive_player,
  triumph: INTENT_LIBRARY.alpha_player,
  redemption: INTENT_LIBRARY.mid_match,
};

// ===========================================================================
// MAIN WATCHER — pure read against `engine`.
// Call once per RAF tick from `EternalGame`. Cheap.
// ===========================================================================

interface WatcherState {
  lastWeatherName: string;
  lastLightingName: string;
  lastCameraName: string;
  lastMusicName: string;
  lastIntent: string;
  lastPhase: string;
  lastPlayerHpBucket: number;
  lastEnemyHpBucket: number;
  lastWinCount: number;
  lastT: number;
  /** soft cooldown so we don't spam identical decisions */
  cooldownMs: number;
  lastEmitAt: number;
  fightStartMs: number;
}

export function createDirectorWatcher(): WatcherState {
  return {
    lastWeatherName: "",
    lastLightingName: "",
    lastCameraName: "",
    lastMusicName: "",
    lastIntent: "",
    lastPhase: "",
    lastPlayerHpBucket: 100,
    lastEnemyHpBucket: 100,
    lastWinCount: 0,
    lastT: 0,
    cooldownMs: 4500,
    lastEmitAt: 0,
    fightStartMs: 0,
  };
}

/**
 * Top-level watcher. Called by the RAF loop in EternalGame. Idempotent.
 *
 * Strategy:
 *   1. Compare new director state names with the last seen names.
 *      Any change = "Director changed strategy" → emit entry.
 *   2. Detect major gameplay events (round change, dominant HP buckets,
 *      win count change). Each produces a narrator-voice entry.
 *   3. Always do an "applying strategy…" visualizer on emit.
 *
 * All decisions are PURELY derivative — no LLM, no extra Director work.
 */
export function watchDirector(
  engine: GameEngine,
  state: WatcherState,
): void {
  const now = Date.now();
  const ds: DirectorRuntimeState | undefined = engine.directorState;
  if (!ds) return;

  const onCooldown = now - state.lastEmitAt < state.cooldownMs;

  // Phase change (intro → fight → round_end etc.) is always a fresh beat
  // worth surfacing, even on cooldown (we want the player to see it).
  if (state.lastPhase && engine.phase !== state.lastPhase) {
    state.lastPhase = engine.phase;
    if (engine.phase === "fight") {
      state.fightStartMs = now;
      // On fight-start, emit "mid_match" or intent fallback
      const intentCopy =
        INTENT_FALLBACK_BY_INTENT[ds.intent] ?? INTENT_LIBRARY.mid_match;
      emitEntry(intentCopy, ds, engine, now, state.fightStartMs);
      return;
    }
  }
  state.lastPhase = engine.phase;

  // Cinematic knob changes → emit (cooldown guarded)
  const names = {
    w: ds.weatherName,
    l: ds.lightingName,
    c: ds.cameraName,
  };
  const cinematicChanged =
    names.w !== state.lastWeatherName ||
    names.l !== state.lastLightingName ||
    names.c !== state.lastCameraName ||
    ds.intent !== state.lastIntent;

  if (cinematicChanged && !onCooldown) {
    state.lastWeatherName = names.w;
    state.lastLightingName = names.l;
    state.lastCameraName = names.c;
    state.lastIntent = ds.intent;
    const intentCopy =
      INTENT_FALLBACK_BY_INTENT[ds.intent] ?? INTENT_LIBRARY.mid_match;
    emitEntry(intentCopy, ds, engine, now, state.fightStartMs);
    return;
  }

  // Gameplay heuristic: player dominant (HP gap big in player's favour)
  const playerHp = Math.round(
    (engine.player.hp / Math.max(1, engine.player.maxHp)) * 100,
  );
  const enemyHp = Math.round(
    (engine.enemy.hp / Math.max(1, engine.enemy.maxHp)) * 100,
  );
  const playerBucket = (playerHp / 25) | 0;
  const enemyBucket = (enemyHp / 25) | 0;

  if (engine.phase === "fight") {
    // Player dominating (player full, enemy low) → alpha_player
    if (
      !onCooldown &&
      playerBucket >= 4 &&
      enemyBucket <= 1 &&
      enemyBucket < state.lastEnemyHpBucket
    ) {
      emitEntry(
        INTENT_LIBRARY.alpha_player,
        ds,
        engine,
        now,
        state.fightStartMs,
      );
    }
    // Player low HP → low_hp_player
    else if (
      !onCooldown &&
      playerBucket <= 1 &&
      playerBucket < state.lastPlayerHpBucket
    ) {
      emitEntry(
        INTENT_LIBRARY.low_hp_player,
        ds,
        engine,
        now,
        state.fightStartMs,
      );
    }
    // Player playing safe (player full, enemy high, mid-timer)
    else if (
      !onCooldown &&
      playerBucket >= 3 &&
      enemyBucket >= 3 &&
      engine.roundTimer > 30
    ) {
      emitEntry(
        INTENT_LIBRARY.passive_player,
        ds,
        engine,
        now,
        state.fightStartMs,
      );
    }
    // Big enemy pressure (enemy full, player low)
    else if (
      !onCooldown &&
      enemyBucket >= 4 &&
      playerBucket <= 1 &&
      playerBucket < state.lastPlayerHpBucket
    ) {
      emitEntry(
        INTENT_LIBRARY.dominant_enemy,
        ds,
        engine,
        now,
        state.fightStartMs,
      );
    }
    // Win-count climb: player dominating the campaign → aggressive_spree
    if (
      !onCooldown &&
      engine.playerWins > state.lastWinCount &&
      engine.playerWins >= 2
    ) {
      emitEntry(
        INTENT_LIBRARY.aggressive_spree,
        ds,
        engine,
        now,
        state.fightStartMs,
      );
    }
  }

  state.lastPlayerHpBucket = playerBucket;
  state.lastEnemyHpBucket = enemyBucket;
  state.lastWinCount = engine.playerWins;

  // Light passive "mid-match" reminder if nothing has fired in a while
  // (only during fight) — keeps the Director visible to a passive viewer.
  if (
    engine.phase === "fight" &&
    state.fightStartMs > 0 &&
    now - state.lastEmitAt > 14000
  ) {
    emitEntry(INTENT_LIBRARY.mid_match, ds, engine, now, state.fightStartMs);
  }
}

function emitEntry(
  copy: IntentCopy,
  ds: DirectorRuntimeState,
  engine: GameEngine,
  now: number,
  fightStartMs: number,
) {
  // Avoid double-emit if the exact same intent/reason was just shown
  const last = store.getLiveIntent();
  if (
    last &&
    last.intent === copy.intent &&
    last.reason === copy.reason &&
    now - last.timestamp < 8000
  ) {
    return;
  }

  const actionLabels = labelActions(copy, ds);
  const entry: DirectorJournalEntry = {
    timestamp: now,
    t: Math.max(0, (now - fightStartMs) / 1000),
    intent: copy.intent,
    reason: copy.reason,
    hypothesis: copy.hypothesis,
    prediction: copy.prediction,
    confidence: copy.confidence,
    actions: actionLabels,
  };
  store.push(entry);
  store.showAction({ intent: copy.intent, actions: actionLabels });
}

// ===========================================================================
// ACTION LABEL MAPPING
//
// Maps the chosen intent's action list onto the LIVE runtime state names
// read from `engine.directorState`. If a runtime knob doesn't exist for
// the intent (e.g. no active hazard), it gets gracefully omitted.
// ===========================================================================
function labelActions(
  copy: IntentCopy,
  ds: DirectorRuntimeState,
): string[] {
  const labels: string[] = [];
  const have = {
    weather: ds.weatherName && ds.weatherName !== "CALM",
    lighting: ds.lightingName && ds.lightingName !== "FLAT",
    camera: ds.cameraName && ds.cameraName !== "STEADY",
    hazardDarkness: (ds.hazards?.darkness ?? 0) > 0,
    hazardChip: (ds.hazards?.chipDamage ?? 0) > 0,
    hazardSlip: (ds.hazards?.slipFactor ?? 0) > 0,
  };

  for (const a of copy.actions) {
    const upper = a.toUpperCase();
    if (upper.includes("LIGHTING") && have.lighting) {
      labels.push(`${ds.lightingName} Lighting`);
      continue;
    }
    if (upper.includes("CAMERA") && have.camera) {
      labels.push(`${ds.cameraName} Camera`);
      continue;
    }
    if (upper.includes("MUSIC") || upper.includes("THEME")) continue;
    if (upper.includes("WEATHER") || upper.includes("STORM")) {
      if (have.hazardDarkness) labels.push(ds.weatherName);
      else if (have.weather) labels.push(ds.weatherName);
      continue;
    }
    if (upper.includes("HEALING")) {
      if (have.hazardChip) labels.push("Reduced Healing");
      continue;
    }
    if (upper.includes("HITSTOP")) {
      labels.push("Increase Hitstop");
      continue;
    }
    if (upper.includes("EMBER") || upper.includes("SLOWMO")) {
      labels.push(a);
      continue;
    }
    if (upper.includes("WIDER") || upper.includes("WIDE PULL")) {
      labels.push("Wide Pull Camera");
      continue;
    }
    // If nothing matched, fall back to the raw action name when it
    // matches a runtime knob we actually have, otherwise drop it.
    if (
      upper === ds.weatherName.toUpperCase() ||
      upper === ds.lightingName.toUpperCase() ||
      upper === ds.cameraName.toUpperCase()
    ) {
      labels.push(a);
    }
  }
  // Deduplicate while preserving order
  return Array.from(new Set(labels));
}

// ===========================================================================
// READ-ONLY DERIVED DATA USED BY AI DEBRIEF
//
// Pure functions over `engine`. No new state. Safe to call from anywhere.
// ===========================================================================

export type RichArchetype =
  | "Calculated Duelist"
  | "Aggressive Explorer"
  | "Patient Hunter"
  | "Risk-Seeking Challenger"
  | "Methodical Defender"
  | "Adaptive Opportunist";

export interface PlayerTraits {
  /** 0..100 — how aggressively the player commits to attacks */
  aggression: number;
  /** 0..100 — how long the player waits before committing */
  patience: number;
  /** 0..100 — how much the player varies positions and tactics */
  exploration: number;
  /** 0..100 — how often the player takes the unfavourable trade */
  riskTaking: number;
  /** 0..100 — how quickly the player adjusts to new conditions */
  adaptability: number;
}

export type PredictionOutcome = "correct" | "incorrect" | "partial";

export interface PredictionAssessment {
  kind: PredictionOutcome;
  prediction: string;
  outcome: string;
  updatedLine: string;
}

export type ReflectionKind = "successful" | "failure";

export interface DirectorReflection {
  kind: ReflectionKind;
  headline: string;
  line: string;
}

export interface EncounterRecord {
  /** 1-indexed encounter counter — used as label in evolution chart */
  matchNo: number;
  archetype: RichArchetype;
  traits: PlayerTraits;
  modelConfidence: number;
  predictionResult: PredictionOutcome;
  reflectionKind: ReflectionKind;
}

export interface DirectorNotification {
  id: number;
  /** "Hypothesis Confirmed" / "Unexpected Behaviour" */
  headline: string;
  /** "Confidence Increased" / "Updating Player Model…" */
  subline: string;
  /** "correct" = green, "failure" = amber */
  tone: "correct" | "failure";
}

export interface AIDebriefSnapshot {
  archetype: RichArchetype;
  /** 3 short behavioural observations (no Director language) */
  archetypeObservations: string[];
  /** 5 inferred traits, each 0..100 */
  traits: PlayerTraits;
  /** "How confident the Director currently is in its player model." 0..100 */
  modelConfidence: number;
  prediction: PredictionAssessment;
  reflection: DirectorReflection;
  /** 3 small arrows: Confidence / Stress / Focus. */
  emotionalCurve: { label: string; direction: "up" | "down" | "flat" }[];
  /** Sliding window of recent encounters (oldest first). */
  encounterHistory: EncounterRecord[];
  /** Same length as encounterHistory — confidence per encounter. */
  confidenceHistory: number[];
  /** kept for cinematic continuation of the Director Report */
  adaptationScore: "S" | "A" | "B" | "C" | "D";
  nextStrategy: string;
}

const ARCHETYPE_TABLE: Record<
  RichArchetype,
  { observations: string[]; nextStrategy: string }
> = {
  "Calculated Duelist": {
    observations: [
      "Waits for punish windows before committing.",
      "Avoids unnecessary trades of HP for tempo.",
      "Maintains a deliberate, defensive spacing.",
    ],
    nextStrategy: "Hide the opening until late in the round.",
  },
  "Aggressive Explorer": {
    observations: [
      "Cycles through varied combos looking for an opening.",
      "Pushes tempo forward before the Director can settle.",
      "Tests new attack patterns before relying on the old ones.",
    ],
    nextStrategy: "Introduce a deceptive enemy formation.",
  },
  "Patient Hunter": {
    observations: [
      "Reads opponent behaviour before committing to a plan.",
      "Punishes the same pattern twice without flinching.",
      "Waits for the decisive moment rather than chasing it.",
    ],
    nextStrategy: "Force a tempo change the player did not ask for.",
  },
  "Risk-Seeking Challenger": {
    observations: [
      "Pushes through unfavourable trades to seize momentum.",
      "Commits to bold openings even at low HP.",
      "Refuses to play from behind — chooses pressure instead.",
    ],
    nextStrategy: "Increase chip damage and tighten the arena.",
  },
  "Methodical Defender": {
    observations: [
      "Holds position carefully and lets the fight come to them.",
      "Conserves HP by reading distance over committing.",
      "Wins rounds without trading heavily.",
    ],
    nextStrategy: "Apply sustained attrition over a long round.",
  },
  "Adaptive Opportunist": {
    observations: [
      "Adjusts to each opponent's habits round by round.",
      "Switches tactics mid-fight when the situation turns.",
      "Reads the round as it unfolds rather than following a script.",
    ],
    nextStrategy: "Force a tempo change the player did not ask for.",
  },
};

function pickArchetype(
  engine: GameEngine,
): RichArchetype {
  const playerHp = engine.player.hp / Math.max(1, engine.player.maxHp);
  const wins = engine.playerWins;
  const losses = engine.enemyWins;
  const maxCombo = engine.maxCombo;

  if (losses > wins && playerHp < 0.35) return "Risk-Seeking Challenger";
  if (maxCombo >= 5 && wins >= losses && playerHp > 0.45)
    return "Calculated Duelist";
  if (maxCombo >= 3 && wins > losses) return "Aggressive Explorer";
  if (wins > losses && playerHp > 0.55 && maxCombo < 4)
    return "Methodical Defender";
  if (wins <= losses && maxCombo < 3 && playerHp > 0.4)
    return "Patient Hunter";
  return "Adaptive Opportunist";
}

function derivePlayerTraits(engine: GameEngine): PlayerTraits {
  const playerHp = engine.player.hp / Math.max(1, engine.player.maxHp);
  const enemyHp = engine.enemy.hp / Math.max(1, engine.enemy.maxHp);
  const wins = engine.playerWins;
  const losses = engine.enemyWins;
  const maxCombo = engine.maxCombo;
  const turns = Math.max(1, engine.roundNo + (wins + losses));
  const margin = playerHp - enemyHp;

  // Aggression: combo pressure + opening commitment
  const aggression = clamp(
    45 + maxCombo * 6 + (playerHp > 0.5 ? 8 : -4) + (margin < 0 ? 6 : -2),
    12,
    96,
  );

  // Patience: low combo + remaining HP + waited turns
  const patience = clamp(
    55 - maxCombo * 4 + Math.round(playerHp * 25) + (margin > 0 ? 5 : 0),
    18,
    94,
  );

  // Exploration: combo variety proxy (more rounds → slightly higher)
  const exploration = clamp(
    40 + (turns - 1) * 6 + (wins > losses ? 8 : 0) + Math.round(margin * 14),
    20,
    96,
  );

  // Risk-taking: willing to be behind on HP, or fights being lost
  const riskTaking = clamp(
    38 +
      Math.max(0, -margin) * 60 +
      (losses > wins ? 18 : 0) +
      (playerHp < 0.3 ? 22 : 0),
    15,
    98,
  );

  // Adaptability: swing in player HP across the round, plus round count
  const adaptability = clamp(
    42 +
      Math.round(Math.abs(margin) * 38) +
      turns * 3 +
      (wins === losses ? 8 : 0),
    22,
    96,
  );

  return { aggression, patience, exploration, riskTaking, adaptability };
}

function derivePredictionAssessment(
  engine: GameEngine,
  fallbackPrediction: string,
): PredictionAssessment {
  const playerHp = engine.player.hp / Math.max(1, engine.player.maxHp);
  const enemyHp = engine.enemy.hp / Math.max(1, engine.enemy.maxHp);
  const wins = engine.playerWins;
  const losses = engine.enemyWins;
  const hpGap = playerHp - enemyHp;

  // Synthesize a Director-style prediction line that we then judge against
  // observed outcomes. The text mirrors the language used in INTENT_LIBRARY
  // predictions so it never sounds like debug output.
  const predictionLine = fallbackPrediction;
  let outcomeLine: string;
  let kind: PredictionOutcome;
  if (enemyHp < 0.2 && playerHp > 0.3) {
    kind = "correct";
    outcomeLine = "The Director's read held — the encounter closed as forecast.";
  } else if (playerHp < 0.15 && enemyHp > 0.4) {
    kind = "incorrect";
    outcomeLine = "The player surprised the Director.";
  } else if (Math.abs(hpGap) < 0.18) {
    kind = "partial";
    outcomeLine = "The round tipped a different way than expected.";
  } else if (wins > losses) {
    kind = "correct";
    outcomeLine = "Confidence paid off — the world behaved as modelled.";
  } else if (losses > wins) {
    kind = "incorrect";
    outcomeLine = "The Director's expectation did not survive contact.";
  } else {
    kind = "partial";
    outcomeLine = "Some outcomes matched; others diverged.";
  }

  const updatedLine =
    kind === "correct"
      ? "Confidence grew. Player model retained."
      : kind === "incorrect"
        ? "Model updated. The Director adjusted its expectations."
        : "Model updated partially. The Director hedged its read.";

  return {
    kind,
    prediction: predictionLine,
    outcome: outcomeLine,
    updatedLine,
  };
}

function deriveReflection(
  engine: GameEngine,
  archetype: RichArchetype,
  prediction: PredictionAssessment,
): DirectorReflection {
  const playerHp = engine.player.hp / Math.max(1, engine.player.maxHp);
  const enemyHp = engine.enemy.hp / Math.max(1, engine.enemy.maxHp);
  const won = playerHp > enemyHp;
  const dominantWin = playerHp - enemyHp > 0.4;

  if (prediction.kind === "correct" && won) {
    const lines: Record<RichArchetype, string> = {
      "Calculated Duelist":
        "Visual restraint pulled the player into a smaller arena — the hypothesis held, and confidence climbed.",
      "Aggressive Explorer":
        "Shifting the camera width broke the rhythm the player relied on — the read landed cleanly.",
      "Patient Hunter":
        "Holding the wide frame rewarded the player's patience just enough — the world nudged, not pushed.",
      "Risk-Seeking Challenger":
        "Pressure met pressure, and the player rose to it. The Director's confidence grew for the next chapter.",
      "Methodical Defender":
        "Sustained attrition drained the defender's safety margin — exactly what the model predicted.",
      "Adaptive Opportunist":
        "The tempo change forced a re-read; the opportunist adapted slower than the Director.",
    };
    return {
      kind: "successful",
      headline: dominantWin
        ? "The hypothesis held."
        : "The prediction held — barely.",
      line: lines[archetype],
    };
  }

  if (prediction.kind === "incorrect" || (!won && playerHp < 0.25)) {
    const lines: Record<RichArchetype, string> = {
      "Calculated Duelist":
        "Darkness failed to shrink the duelist — the read collapsed. The Director will try coordinated enemy behavior next.",
      "Aggressive Explorer":
        "Camera width alone did not stop the explorer. Pressure was misplaced; the world will shift tactics.",
      "Patient Hunter":
        "The patient hunter waited longer than the model expected. The Director now plans for a longer round.",
      "Risk-Seeking Challenger":
        "Pressure hardened the challenger instead of breaking them. The world learned — next time, it leans harder on tempo.",
      "Methodical Defender":
        "Distance alone could not lure the defender out. The Director will respond differently next time.",
      "Adaptive Opportunist":
        "The opportunist reads tempo changes faster than the model anticipated. Curiosity prevailed — the world will change shape.",
    };
    return {
      kind: "failure",
      headline: "The Director's read failed.",
      line: lines[archetype],
    };
  }

  // Partial — the encounter sat between forecasts.
  return {
    kind: "successful",
    headline: "Partially as predicted.",
    line: "The world learned something, but not enough to be certain. Pressure will be recalibrated next encounter.",
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function computeAIDebrief(engine: GameEngine): AIDebriefSnapshot {
  const playerHp = engine.player.hp / Math.max(1, engine.player.maxHp);
  const enemyHp = engine.enemy.hp / Math.max(1, engine.enemy.maxHp);
  const wins = engine.playerWins;
  const losses = engine.enemyWins;
  const maxCombo = engine.maxCombo;

  const entries = store.getEntries();

  const archetype = pickArchetype(engine);
  const archetypeObservations = ARCHETYPE_TABLE[archetype].observations;
  const nextStrategy = ARCHETYPE_TABLE[archetype].nextStrategy;

  // Emotional curve — three labels derived from combat trajectory
  const emotionalCurve: { label: string; direction: "up" | "down" | "flat" }[] = [
    { label: "Confidence", direction: playerHp >= enemyHp ? "up" : "down" },
    { label: "Stress", direction: playerHp < 0.3 ? "up" : "down" },
    { label: "Focus", direction: maxCombo >= 3 ? "up" : "flat" },
  ];

  // Model confidence — averages journal confidences and grows as the
  // Director builds a richer picture. Earlier encounters sit lower.
  const journalConfidence =
    entries.length > 0
      ? Math.round(
          entries.reduce((s, e) => s + e.confidence, 0) / entries.length,
        )
      : 72;
  const traitSpread = derivePlayerTraits(engine);
  const traitRichness =
    Math.min(96, 35 + Object.values(traitSpread).reduce((s, v) => s + v, 0) / 6);
  const modelConfidence = clamp(
    Math.round(journalConfidence * 0.65 + traitRichness * 0.35),
    28,
    98,
  );

  // Prediction assessment — uses the most recent entry's prediction line
  const fallbackPrediction =
    entries[0]?.prediction ?? "Player continues the current pattern.";
  const prediction = derivePredictionAssessment(engine, fallbackPrediction);

  const reflection = deriveReflection(engine, archetype, prediction);

  // Adaptation score — derived from HP swing and AI mode adaptation proxy
  const hpSwing = Math.round(Math.abs(playerHp - enemyHp) * 100);
  const adaptationScore: "S" | "A" | "B" | "C" | "D" =
    hpSwing < 15 ? "S" : hpSwing < 30 ? "A" : hpSwing < 50 ? "B" : hpSwing < 70 ? "C" : "D";

  // Encounter history — read from store, inject current encounter if missing
  const encounterHistory = store.getRecentEncounters();
  const confidenceHistory = encounterHistory.map((e) => e.modelConfidence);

  return {
    archetype,
    archetypeObservations,
    traits: traitSpread,
    modelConfidence,
    prediction,
    reflection,
    emotionalCurve,
    encounterHistory,
    confidenceHistory,
    adaptationScore,
    nextStrategy,
  };
}

/**
 * Record the just-finished encounter into the in-memory history so the
 * next MatchDebriefPanel render can show it in the evolution chart.
 *
 * Called from MatchDebriefPanel on mount. The number of recent encounters
 * retained is bounded (5) by the journal store itself.
 */
export function recordEncounter(
  engine: GameEngine,
  matchNo: number,
): void {
  const snap = computeAIDebrief(engine);
  const record: EncounterRecord = {
    matchNo,
    archetype: snap.archetype,
    traits: snap.traits,
    modelConfidence: snap.modelConfidence,
    predictionResult: snap.prediction.kind,
    reflectionKind: snap.reflection.kind,
  };
  store.pushEncounter(record);
  if (snap.prediction.kind === "correct") {
    store.showNotification({
      id: Date.now(),
      headline: "Hypothesis Confirmed",
      subline: "Confidence Increased",
      tone: "correct",
    });
  } else if (snap.prediction.kind === "incorrect") {
    store.showNotification({
      id: Date.now(),
      headline: "Unexpected Behaviour",
      subline: "Updating Player Model…",
      tone: "failure",
    });
  }
}

// Reset helper — call when starting a new match so each fight has its
// own journal & derived snapshot.
export function resetDirectorJournal() {
  store.reset();
}
