"use client";

// ============================================================================
// DIRECTOR REPORT — POST-BATTLE CINEMATIC DEBRIEF
//
// Evolved from the original MatchDebriefPanel. Same props, same engine, same
// data tables — only the presentation layer was rebuilt so the report feels
// like an invisible storyteller reconstructing the battle rather than a
// stats panel.
//
// Sections (top → bottom):
//   1. DIRECTOR INTENT         — objective, narrative purpose, experience,
//                                 emotion + intensity
//   2. DIRECTOR ANALYSIS       — weather / lighting / camera /
//                                 hazards with a poetic "WHY" for each
//   3. DIRECTOR COUNTER PLAN   — what the AI actually did, with reasoning
//   4. DIRECTOR PLAN           — the causal chain (intent → ... → outcome)
//   5. DIRECTOR CONFIDENCE     — % confidence, prediction, reasoning
//   6. DIRECTOR VERDICT        — final closing paragraph, typewriter-style
//
// Sequence:
//   • On mount, the "DIRECTOR LOG" intro plays (reconstruction phase).
//   • Each section fades in, staggered.
//   • The confidence bar fills.
//   • The Director Verdict types itself out character by character.
//
// Gameplay is untouched. The props interface is identical to the original so
// ShadowFight.tsx needs no changes.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GameEngine } from "@/lib/game/engine";
import { OPPONENTS } from "@/lib/game/config/opponents";
import {
  computeAIDebrief,
  recordEncounter,
  useDirectorJournal,
  type EncounterRecord,
  type PlayerTraits,
  type RichArchetype,
} from "@/lib/game/directorJournal";

export interface MatchDebriefPanelProps {
  engine: GameEngine;
  title: string;
  subtitle: string;
  accent: string;
  info?: string;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  result: "win" | "loss";
}

const CHAPTERS = [
  { id: 1, title: "THE LAST APPRENTICE", emotion: "curiosity", intensity: 0.25, intent: "defiance" },
  { id: 2, title: "THE DEFECTOR", emotion: "wariness", intensity: 0.35, intent: "revelation" },
  { id: 3, title: "THE MARTYR", emotion: "grief", intensity: 0.45, intent: "grief" },
  { id: 4, title: "THE ASSASSIN", emotion: "unease", intensity: 0.55, intent: "revenge" },
  { id: 5, title: "THE COLOSSUS", emotion: "fear", intensity: 0.65, intent: "defiance" },
  { id: 6, title: "THE SHOGUN", emotion: "respect", intensity: 0.75, intent: "revelation" },
  { id: 7, title: "THE WORLD'S LAST HOPE", emotion: "despair", intensity: 0.9, intent: "triumph" },
];

const INTENT_LABELS: Record<string, { objective: string; narrativePurpose: string; playerExperienceGoal: string }> = {
  revenge: {
    objective: "Make the player feel the weight of every hit.",
    narrativePurpose: "An old debt, called in.",
    playerExperienceGoal: "Brutal. Personal. No escape.",
  },
  revelation: {
    objective: "Surface a truth the player didn't expect.",
    narrativePurpose: "The mask falls.",
    playerExperienceGoal: "Slow. Cinematic. A revelation earned.",
  },
  defiance: {
    objective: "Refuse the player every comfortable option.",
    narrativePurpose: "A wall that does not bend.",
    playerExperienceGoal: "Tense. Claustrophobic. Adapt or die.",
  },
  grief: {
    objective: "Make the player hesitate before striking.",
    narrativePurpose: "Someone who mattered is on the other side.",
    playerExperienceGoal: "Heavy. Quiet. Every hit costs something.",
  },
  triumph: {
    objective: "Frame the player as inevitable.",
    narrativePurpose: "The final seal. The last gate.",
    playerExperienceGoal: "Cathartic. Operatic. A coronation.",
  },
  redemption: {
    objective: "Offer the player a chance to prove something.",
    narrativePurpose: "A door opens from the inside.",
    playerExperienceGoal: "Measured. Honourable. Earned.",
  },
};

// Per-intent hypothesis + prediction strings — used in the Director Plan
// chain when the live journal has no fresh entry to source from. The
// director should always sound like it is testing a theory.
const HYPOTHESIS_BY_INTENT: Record<string, string> = {
  revenge:
    "A darker weather should sharpen the player's sense of consequence.",
  revelation:
    "Opening the composition forces the player to look closer at what they won.",
  defiance:
    "A heavier arena tells the player that retreat is no longer an option.",
  grief:
    "Quieter stage design hands the moment back to the player without words.",
  triumph:
    "A brighter sky should feel earned, never handed over.",
  redemption:
    "Drizzle pulls the tempo back without flattening the player's momentum.",
};

const PREDICTION_BY_INTENT: Record<string, string> = {
  revenge: "Player will hesitate before each commitment.",
  revelation: "Player will pause to take in the moment.",
  defiance: "Player commits more aggressively to close faster.",
  grief: "Player lets the round settle into a longer tempo.",
  triumph: "Player absorbs the moment before pressing on.",
  redemption: "Player rebuilds spacing more carefully.",
};

const WEATHER_BY_INTENT: Record<string, { name: string; description: string; tint: string }> = {
  revenge: { name: "RUST SKY", description: "Blood-orange haze. The air tastes like iron.", tint: "#dc2626" },
  redemption: { name: "GREY DAWN", description: "Drizzle. Wet steel. A second chance.", tint: "#64748b" },
  revelation: { name: "GOLDEN HOUR", description: "The sun breaks at the horizon — a final truth.", tint: "#f59e0b" },
  defiance: { name: "BLACK STORM", description: "No stars. No mercy. No retreat.", tint: "#0f172a" },
  grief: { name: "ASHEN RAIN", description: "Embers fall like tears. The world is quiet.", tint: "#a8a29e" },
  triumph: { name: "CRIMSON SUN", description: "Victory is a colour. Today it is red.", tint: "#ef4444" },
};

const LIGHTING_BY_INTENT: Record<string, { name: string; description: string }> = {
  revenge: { name: "HARD RIM", description: "Single-source backlight. Every edge a blade." },
  redemption: { name: "DIFFUSED", description: "Soft overhead. No shadows to hide in." },
  revelation: { name: "GOD-RAYS", description: "Shafts cut through dust. The divine, on film." },
  defiance: { name: "UNDERLIGHT", description: "Fire from below. The hero is a silhouette." },
  grief: { name: "COLD FLAT", description: "Even, grey. There is no warmth to lose." },
  triumph: { name: "HALO", description: "Backlight crown. The winner, framed." },
};

const CAMERA_BY_INTENT: Record<string, { name: string; shake: number; zoom: number }> = {
  revenge: { name: "HANDHELD", shake: 0.6, zoom: 0.05 },
  redemption: { name: "STEADICAM", shake: 0.1, zoom: 0.0 },
  revelation: { name: "WIDE PULL", shake: 0.0, zoom: 0.12 },
  defiance: { name: "CLOSE-UP", shake: 0.3, zoom: 0.2 },
  grief: { name: "LONG LENS", shake: 0.0, zoom: 0.08 },
  triumph: { name: "LOW HERO", shake: 0.0, zoom: 0.15 },
};

const HAZARDS_BY_INTENT: Record<string, { name: string; reason: string }[]> = {
  revenge: [
    { name: "EMBER DRIFT", reason: "The past is catching up. The screen smoulders." },
  ],
  revelation: [
    { name: "DUST MOTES", reason: "Light needs particles to be visible." },
  ],
  defiance: [
    { name: "GROUND TREMBLE", reason: "The earth is rejecting the hero." },
    { name: "BLACKOUT", reason: "Pull the floor. The hero must fall to rise." },
  ],
  grief: [
    { name: "RAIN", reason: "The sky mourns with the player." },
  ],
  triumph: [
    { name: "VIGNETTE PULSE", reason: "The frame breathes with the winner." },
  ],
  redemption: [],
};

const COUNTER_PLAN_BY_INTENT: Record<string, string[]> = {
  revenge: [
    "Opened every exchange with the heaviest punish to make the first hit count.",
    "Held the centre of the stage — no retreat, no reset.",
    "Punished every whiffed attack on contact. No free recoveries.",
    "Pushed the player into the corner and kept them there.",
  ],
  revelation: [
    "Stayed mid-range to read the player's timing before committing.",
    "Cycled slowly between zone, approach, and block to expose habits.",
    "Counter-attacked late — the AI waited for the player's pattern to repeat.",
    "Used the long camera zoom to surface tells the player didn't know they had.",
  ],
  defiance: [
    "Held ground with blocks whenever the player advanced.",
    "Triggered mixups after two consecutive blocked attacks (low / overhead).",
    "Closed distance only after the player committed to an attack.",
    "Refused every comfortable spacing — the AI never gave a free mid-range reset.",
  ],
  grief: [
    "Hesitated on the first attack of every round (one-step delay).",
    "Let the player advance for free — then punished the first committed move.",
    "Avoided chip damage windows; preferred single decisive hits.",
    "Kept the camera cold and the lighting flat to drain the player's tempo.",
  ],
  triumph: [
    "Opened with a confident approach to set the rhythm of the round.",
    "Used combos to finish rounds cleanly — no scrappy trades.",
    "Saved rage / finisher for the moment the player's HP dropped below 30%.",
    "Framed every KO with the dramatic low-hero camera angle.",
  ],
  redemption: [
    "Matched the player's pace — never over-committed, never retreated.",
    "Opened with the same first move twice, then mixed on the third to test reads.",
    "Took a single hit on purpose to give the player a fair opening.",
    "Ended on a clean exchange — no cheap chip damage.",
  ],
};

const MODE_VERB: Record<string, string> = {
  approach: "pressuring forward",
  block: "holding guard",
  retreat: "creating space",
  zone: "controlling mid-range",
  wait: "reading the player's timing",
};

// Poetic, narrator-tone one-liner per intent + cinematic choice. Used in
// Director Analysis to justify WHY each choice was made, not just list it.
const ANALYSIS_WHY: Record<
  string,
  { weather: string; lighting: string; camera: string }
> = {
  revenge: {
    weather: "The sky itself refuses to forgive.",
    lighting: "Edges sharper than any blade on the field.",
    camera: "Every frame shakes like the past won't stay buried.",
  },
  revelation: {
    weather: "Light pierces the long doubt at last.",
    lighting: "The truth arrives on shafts of gold.",
    camera: "Pull back. Let the player see what they've missed.",
  },
  defiance: {
    weather: "A sky that has stopped caring.",
    lighting: "From below — every face becomes a silhouette.",
    camera: "Close enough to hear the teeth clench.",
  },
  grief: {
    weather: "The heavens fall quietly with the player.",
    lighting: "Even, grey. Nothing left to warm.",
    camera: "A long lens. Distance, the way mourners keep.",
  },
  triumph: {
    weather: "Victory is a colour. Today it is red.",
    lighting: "The victor deserves a crown before one is ever worn.",
    camera: "Every angle reminds the player this is the final ascent.",
  },
  redemption: {
    weather: "A second chance arrives on wet steel.",
    lighting: "Soft. No shadows to hide in this time.",
    camera: "Steady. Honour is filmed on a tripod.",
  },
};

// Narrative-tone counter plan phrasings, paired with the existing reasoning
// lines. Each sentence explains intent, not mechanics.
const COUNTER_PLAN_PRESENTATION: Record<string, string[]> = {
  revenge: [
    "Opened confidently — the first hit had to land like a verdict.",
    "Held the centre of the stage to deny the player any retreat.",
    "Refused free recoveries — every whiff was answered.",
    "Drove the player into the corner and sealed the walls shut.",
  ],
  revelation: [
    "Held mid-range — patience was the first weapon.",
    "Cycled rhythms to expose the player's habits.",
    "Countered late — only when the pattern had betrayed itself.",
    "Used the long lens to surface tells the player didn't know they had.",
  ],
  defiance: [
    "Held ground — every advance was met with guard.",
    "Mixed up after blocks to deny safe reads.",
    "Closed only after the player committed first.",
    "Denied every comfortable reset — the wall never moved.",
  ],
  grief: [
    "Hesitated on the first attack — mercy has a cost.",
    "Let the player come — then punished what they offered.",
    "Avoided the chip window — only decisive strikes.",
    "Kept the frame cold — drained the player's tempo.",
  ],
  triumph: [
    "Opened confidently to establish tempo.",
    "Maintained pressure to deny recovery.",
    "Reserved the finisher until the player entered critical health.",
    "Forced continuous engagement instead of allowing resets.",
  ],
  redemption: [
    "Matched the player's pace — never over-committed.",
    "Opened the same way twice, then broke the pattern.",
    "Took a single hit deliberately — a fair door, briefly open.",
    "Ended clean — no chip damage, no shortcuts.",
  ],
};

// Director Log — the reconstruction sequence shown before the report.
const DIRECTOR_LOG_LINES: { text: string; delay: number }[] = [
  { text: "Analyzing battle...", delay: 0 },
  { text: "Intent identified...", delay: 600 },
  { text: "Narrative verified...", delay: 1100 },
  { text: "Player profile compared...", delay: 1600 },
  { text: "Genome evaluation complete...", delay: 2100 },
  { text: "Generating verdict...", delay: 2600 },
];

export default function MatchDebriefPanel({
  engine,
  title,
  subtitle,
  accent,
  info,
  primary,
  secondary,
  result,
}: MatchDebriefPanelProps) {
  // ---------------------------------------------------------------------------
  // DATA — same as the original panel; intentional.
  // ---------------------------------------------------------------------------
  const oppIndex = engine.opponentIndex ?? 0;
  const opp = OPPONENTS[oppIndex] ?? OPPONENTS[0];
  const chapter = CHAPTERS[Math.min(oppIndex, CHAPTERS.length - 1)];
  const intentKey = chapter.intent;
  const labels = INTENT_LABELS[intentKey];
  const weather = WEATHER_BY_INTENT[intentKey];
  const lighting = LIGHTING_BY_INTENT[intentKey];
  const camera = CAMERA_BY_INTENT[intentKey];
  const hazards = HAZARDS_BY_INTENT[intentKey] ?? [];
  const counterPlan = COUNTER_PLAN_BY_INTENT[intentKey] ?? [];
  const counterPlanPresentation =
    COUNTER_PLAN_PRESENTATION[intentKey] ?? counterPlan;
  const analysisWhy = ANALYSIS_WHY[intentKey];

  // ---------------------------------------------------------------------------
  // RECONSTRUCTION PHASE — DIRECTOR LOG intro overlay.
  // Plays before the report assembles itself.
  // ---------------------------------------------------------------------------
  const [logIdx, setLogIdx] = useState(0);
  const [phase, setPhase] = useState<"log" | "assembling" | "done">("log");
  const [progress, setProgress] = useState(0);

  // ---------------------------------------------------------------------------
  // SUBSCRIBE to the journal store so the evolution chart, the live
  // hypothesis line, and the prediction notification all reactively reflect
  // the encounter history. The hook is lightweight (subscribes to a Set of
  // listeners).
  // ---------------------------------------------------------------------------
  const journal = useDirectorJournal();

  // ---------------------------------------------------------------------------
  // AI SNAPSHOT — derived once per render. Pure function over `engine` plus
  // the encounter history held in the journal store.
  // ---------------------------------------------------------------------------
  const ai = useMemo(() => computeAIDebrief(engine), [engine]);

  // ---------------------------------------------------------------------------
  // ENCOUNTER RECORD — append this fight's summary to the in-memory history
  // so the next MatchDebriefPanel can show it in the evolution chart. Runs
  // exactly once when the panel mounts.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const matchNo =
      ((engine.playerWins ?? 0) + (engine.enemyWins ?? 0)) + 1;
    recordEncounter(engine, matchNo);
    // Intentionally empty deps: fires exactly once on mount.
  }, []);

  useEffect(() => {
    if (phase !== "log") return;
    const tick = setInterval(() => {
      setProgress((p) => Math.min(100, p + 4));
    }, 60);
    const advance = setTimeout(() => setPhase("assembling"), 3300);
    return () => {
      clearInterval(tick);
      clearTimeout(advance);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "log") return;
    const t = setTimeout(() => {
      setLogIdx((i) => Math.min(i + 1, DIRECTOR_LOG_LINES.length));
    }, 600);
    return () => clearTimeout(t);
  });

  // ---------------------------------------------------------------------------
  // ANIMATED SECTIONS — fade in sequentially after the log finishes.
  // ---------------------------------------------------------------------------
  const [visibleCount, setVisibleCount] = useState(0);
  useEffect(() => {
    if (phase !== "assembling") return;
    const steps = [0, 1, 2, 3, 4, 5, 6]; // 0=header, 1..6 = sections
    const timers = steps.map((i) =>
      setTimeout(() => setVisibleCount((c) => Math.max(c, i + 1)), i * 260),
    );
    const doneTimer = setTimeout(() => setPhase("done"), steps.length * 260 + 200);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(doneTimer);
    };
  }, [phase]);

  // ---------------------------------------------------------------------------
  // CONFIDENCE ANIMATION
  // ---------------------------------------------------------------------------
  const targetConfidence = useMemo(() => {
    const playerHp = engine.player.hp / Math.max(1, engine.player.maxHp);
    const enemyHp = engine.enemy.hp / Math.max(1, engine.enemy.maxHp);
    const championBonus = engine.useChampionGenome ? 0.08 : 0;
    const intensity = chapter.intensity;
    let base: number;
    if (result === "win") {
      base = 0.55 + intensity * 0.35;
    } else {
      base = 0.6 + intensity * 0.32;
    }
    const marginAdj = result === "win" ? enemyHp * -0.15 : playerHp * -0.15;
    return Math.max(0.45, Math.min(0.97, base + marginAdj + championBonus));
  }, [engine, chapter.intensity, result]);

  const [confidenceAnim, setConfidenceAnim] = useState(0);
  useEffect(() => {
    if (phase === "assembling") {
      const t = setTimeout(() => setConfidenceAnim(targetConfidence), 1100);
      return () => clearTimeout(t);
    }
  }, [phase, targetConfidence]);

  const predictionMatch = useMemo(() => {
    if (result === "win") {
      return {
        line: `${opp.name} falls. The gate groans wider.`,
        title: "Player victory.",
      };
    }
    const margin = enemyHpPct(engine);
    if (margin > 0.4) {
      return {
        line: `${opp.name} stood alone and unbroken.`,
        title: "Titan victory.",
      };
    }
    return {
      line: `${opp.name} endured. The seal does not break today.`,
      title: "Champion victory.",
    };
  }, [result, opp.name, engine]);

  // ---------------------------------------------------------------------------
  // CONFIDENCE REASONING — assembled from in-fight signals. These read like
  // narrator observations, not algorithms.
  // ---------------------------------------------------------------------------
  const confidenceReasons = useMemo(() => {
    const reasons: string[] = [];
    if (engine.useChampionGenome) {
      reasons.push(
        "Champion genome performs strongly on this chapter's tempo.",
      );
    } else {
      reasons.push("Baseline build — predictable, but honest.");
    }
    if (chapter.intensity >= 0.7) {
      reasons.push(
        `Intensity at ${Math.round(chapter.intensity * 100)}% — the world was asked to lean in.`,
      );
    } else {
      reasons.push(
        `Intensity held at ${Math.round(chapter.intensity * 100)}% — restraint, not absence.`,
      );
    }
    if (result === "loss") {
      reasons.push(
        `The final seal remained. The player could not answer intent.`,
      );
    } else {
      reasons.push(
        `The player carved through intent — the Director must adapt.`,
      );
    }
    if (chapter.emotion === "despair" || chapter.emotion === "fear") {
      reasons.push(
        "Cinematic weight carried the intended emotion throughout the encounter.",
      );
    } else if (chapter.emotion === "respect" || chapter.emotion === "curiosity") {
      reasons.push(
        "Tone remained earned — the player felt every choice without being told.",
      );
    } else {
      reasons.push(
        "Pressure strategy matched the player's habits turn for turn.",
      );
    }
    return reasons;
  }, [engine, chapter.intensity, chapter.emotion, result]);

  // Prediction-failed branch: when the player beats the expected outcome.
  const predictionFailed =
    result === "win" && engine.useChampionGenome === false
      ? false
      : result === "win";

  // ---------------------------------------------------------------------------
  // FINAL PLAN / COUNTER STEPS — kept identical to the original. The data
  // shape must remain stable so any future consumer (telemetry, replays) is
  // not broken by the visual refactor.
  // ---------------------------------------------------------------------------
  const finalPlan = useMemo(() => {
    const playerHpFrac = engine.player.hp / Math.max(1, engine.player.maxHp);
    const enemyHpFrac = engine.enemy.hp / Math.max(1, engine.enemy.maxHp);
    const ai = engine.ai;
    const useChampion = !!engine.useChampionGenome;

    const reasoning: string[] = [
      `CHAPTER ${chapter.id}/7 — ${chapter.title}.`,
      `Opponent "${opp.name}" is a ${opp.bodyType ?? "balanced"} build with rim ${opp.rim}.`,
      `Intent: ${intentKey.toUpperCase()} — ${labels.objective}`,
      `Emotion: ${chapter.emotion} (intensity ${(chapter.intensity * 100).toFixed(0)}%).`,
      `Weather chosen from intent → ${weather.name}.`,
      `Lighting follows intent → ${lighting.name}.`,
      `Camera profile: ${camera.name} (shake=${camera.shake}, zoom=${camera.zoom}).`,
      useChampion
        ? `AI mode = GA-CHAMPION. The enemy is driven by the loaded champion genome (not baseline).`
        : `AI mode = BASELINE. The enemy is driven by the static opponent definition.`,
      `Live AI state at end of match: mode=${ai.mode}${ai.nextAttack ? `, last planned = ${ai.nextAttack}` : ""}.`,
      `Final HP — player: ${(playerHpFrac * 100).toFixed(0)}%, enemy: ${(enemyHpFrac * 100).toFixed(0)}%.`,
    ];

    return {
      playerHpFrac,
      enemyHpFrac,
      ai,
      useChampion,
      reasoning,
    };
  }, [engine, chapter, opp, intentKey, labels, weather, lighting, camera]);

  const counterSteps = useMemo(() => {
    const playerHpFrac = finalPlan.playerHpFrac;
    const enemyHpFrac = finalPlan.enemyHpFrac;
    const mode = finalPlan.ai.mode;
    const angerLine = enemyHpFrac < 0.3
      ? "Rage threshold crossed — AI was committing to finishers."
      : enemyHpFrac > 0.7
        ? "AI held back — confident in control of the round."
        : "AI was in the mid-fight — neither ahead nor behind.";

    const outcomeLine = result === "win"
      ? "The player's strategy broke through the Director's intent."
      : "The Director's intent held — the player could not answer it.";

    return {
      intro: `Director intent "${intentKey.toUpperCase()}" dictated the counter-plan below.`,
      steps: counterPlan,
      closing: `${angerLine} Final state: ${mode} (${MODE_VERB[mode] ?? mode}). ${outcomeLine}`,
      playerHpFrac,
      enemyHpFrac,
    };
  }, [finalPlan, counterPlan, intentKey, result]);

  // ---------------------------------------------------------------------------
  // VERDICT — narrator prose. Win and loss get mirrored language.
  // ---------------------------------------------------------------------------
  const verdictText = useMemo(() => {
    const chapterTitle = chapter.title;
    if (result === "loss") {
      return (
        `The player resisted until ${chapterTitle}, ` +
        `but the Director maintained relentless pressure. ` +
        `The intended emotion of ${chapter.emotion} remained dominant ` +
        `throughout the encounter.`
      );
    }
    return (
      `The player refused the Director's intent. ` +
      `${chapterTitle} closed with momentum reversed — ` +
      `the world learned something it did not expect, ` +
      `and the narrative will never be told the same way again.`
    );
  }, [chapter.title, chapter.emotion, result]);

  const verdictHeadline = useMemo(() => {
    if (result === "loss") {
      return "Intent Achieved";
    }
    return "Intent Refused";
  }, [result]);

  // ---------------------------------------------------------------------------
  // TYPEWRITER — Director Verdict types itself out one char at a time.
  // ---------------------------------------------------------------------------
  const [typed, setTyped] = useState("");
  const [verdictVisible, setVerdictVisible] = useState(false);
  useEffect(() => {
    if (phase !== "assembling" && phase !== "done") return;
    // The verdict section is section index 6 (last). It reveals on tick 6.
    const start = setTimeout(() => setVerdictVisible(true), 6 * 260 + 380);
    return () => clearTimeout(start);
  }, [phase]);

  useEffect(() => {
    if (!verdictVisible) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(verdictText.slice(0, i));
      if (i >= verdictText.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [verdictVisible, verdictText]);

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  return (
    <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-sm overflow-hidden">
      {/* === DIRECTOR LOG — reconstruction intro ============================ */}
      {phase === "log" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/95 backdrop-blur-md">
          <div className="w-full max-w-md px-6">
            <p className="text-[10px] text-zinc-500 tracking-[0.45em] text-center mb-2">
              DIRECTOR LOG
            </p>
            <div className="h-px bg-gradient-to-r from-transparent via-rose-700/50 to-transparent mb-6" />
            <div className="space-y-1.5 font-mono text-xs">
              {DIRECTOR_LOG_LINES.slice(0, logIdx).map((l, i) => (
                <p
                  key={i}
                  className="text-zinc-400 animate-in fade-in-0 slide-in-from-left-2 duration-300"
                >
                  <span className="text-emerald-400/70 mr-2">›</span>
                  {l.text}
                  {i === logIdx - 1 && i < DIRECTOR_LOG_LINES.length - 1 && (
                    <span className="inline-block w-2 h-3 bg-amber-300/70 ml-1 align-middle animate-pulse" />
                  )}
                </p>
              ))}
              {logIdx === 0 && (
                <p className="text-zinc-400">
                  <span className="text-emerald-400/70 mr-2">›</span>
                  Analyzing battle...
                  <span className="inline-block w-2 h-3 bg-amber-300/70 ml-1 align-middle animate-pulse" />
                </p>
              )}
            </div>
            <div className="mt-8">
              <div className="font-mono text-[10px] text-zinc-500 flex justify-between mb-1">
                <span className="tracking-widest">ANALYZING</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full transition-all duration-200 ease-out"
                  style={{
                    width: `${progress}%`,
                    background:
                      "linear-gradient(90deg,#f59e0b,#ef4444,#f59e0b)",
                    boxShadow: "0 0 12px rgba(239,68,68,0.5)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === MAIN REPORT — scrollable once assembled ======================== */}
      <div
        className={`absolute inset-0 overflow-y-auto p-4 sm:p-6 transition-opacity duration-700 ${
          phase === "assembling" || phase === "done" ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="w-full max-w-3xl mx-auto pb-12">
          {/* ---------------------------------------------------------------- */}
          {/* PLAYER MODEL — the post-battle picture of the player.           */}
          {/* All language here is about the player. The Director's plan lives */}
          {/* further down in the Director Report sections.                    */}
          {/* ---------------------------------------------------------------- */}
          <Reveal shown={visibleCount > 0}>
            <Card className="bg-zinc-950/90 border-amber-400/25 hover:border-amber-400/45 hover:shadow-[0_0_28px_rgba(245,158,11,0.18)] transition-all duration-500 mb-4">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] text-amber-300/90 tracking-[0.45em] font-bold">
                    PLAYER MODEL
                  </p>
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-amber-400/30 text-amber-200/90"
                    style={{ boxShadow: "0 0 10px rgba(245,158,11,0.18)" }}
                  >
                    GRADE · {ai.adaptationScore}
                  </span>
                </div>

                <div className="h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent mb-4" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* LEFT — Archetype + 3 behavioural observations */}
                  <div>
                    <DebriefRow label="Archetype">
                      <p
                        className="text-base sm:text-lg font-black tracking-tight leading-tight"
                        style={{
                          color: accent,
                          textShadow: `0 0 12px ${accent}55`,
                        }}
                      >
                        {ai.archetype}
                      </p>
                    </DebriefRow>

                    <DebriefRow label="Behavioral Observations">
                      <ul className="space-y-1 mt-0.5">
                        {ai.archetypeObservations.map((obs, i) => (
                          <li
                            key={i}
                            className="flex gap-2 text-zinc-200 text-xs leading-snug"
                          >
                            <span className="text-amber-400/80 mt-0.5 shrink-0">
                              •
                            </span>
                            <span>{obs}</span>
                          </li>
                        ))}
                      </ul>
                    </DebriefRow>

                    <DebriefRow label="Emotional Curve">
                      <ul className="space-y-1">
                        {ai.emotionalCurve.map((e) => (
                          <li
                            key={e.label}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="text-zinc-400 w-20">
                              {e.label}
                            </span>
                            <Arrow direction={e.direction} />
                          </li>
                        ))}
                      </ul>
                    </DebriefRow>
                  </div>

                  {/* RIGHT — Model Confidence / Prediction / Next */}
                  <div>
                    <DebriefRow label="Model Confidence">
                      <div className="flex items-baseline gap-2">
                        <span
                          className="text-3xl font-black font-mono leading-none"
                          style={{
                            color: accent,
                            textShadow: `0 0 14px ${accent}88`,
                          }}
                        >
                          {ai.modelConfidence}
                        </span>
                        <span className="text-zinc-500 text-base font-mono">
                          %
                        </span>
                        <span className="ml-auto text-zinc-500 text-[10px] tracking-widest">
                          {ai.modelConfidence >= 90
                            ? "RESONANT"
                            : ai.modelConfidence >= 75
                              ? "STEADY"
                              : ai.modelConfidence >= 55
                                ? "FORMING"
                                : "NEW"}
                        </span>
                      </div>
                      <p className="text-zinc-500 text-[10px] mt-1 italic">
                        How confident the Director is in its model of the
                        player.
                      </p>
                      <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${ai.modelConfidence}%`,
                            background: `linear-gradient(90deg, ${accent}, #ef4444)`,
                            boxShadow: `0 0 10px ${accent}99`,
                            transition:
                              "width 1500ms cubic-bezier(0.22,1,0.36,1)",
                          }}
                        />
                      </div>
                    </DebriefRow>

                    <DebriefRow label="Prediction Result">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-bold tracking-wide"
                          style={{
                            color:
                              ai.prediction.kind === "correct"
                                ? "#34d399"
                                : ai.prediction.kind === "incorrect"
                                  ? "#f87171"
                                  : "#fbbf24",
                          }}
                        >
                          {ai.prediction.kind === "correct"
                            ? "✓ Correct"
                            : ai.prediction.kind === "incorrect"
                              ? "✗ Incorrect"
                              : "≈ Partially Correct"}
                        </span>
                      </div>
                      <div className="mt-1.5 rounded-md border border-white/10 bg-black/30 p-2 space-y-1">
                        <p className="text-[10px] leading-snug">
                          <span className="text-zinc-500 tracking-widest mr-1">
                            PREDICTION
                          </span>
                          <span className="text-zinc-200 italic">
                            {ai.prediction.prediction}
                          </span>
                        </p>
                        <p className="text-[10px] leading-snug">
                          <span className="text-zinc-500 tracking-widest mr-1">
                            OUTCOME
                          </span>
                          <span className="text-zinc-200 italic">
                            {ai.prediction.outcome}
                          </span>
                        </p>
                      </div>
                      <p className="text-zinc-500 text-[10px] mt-1 italic">
                        {ai.prediction.updatedLine}
                      </p>
                    </DebriefRow>

                    <DebriefRow label="Next Planned Strategy">
                      <p className="text-emerald-300/90 text-xs leading-snug">
                        {ai.nextStrategy}
                      </p>
                    </DebriefRow>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Reveal>

          {/* ---------------------------------------------------------------- */}
          {/* PLAYER TRAITS — five inferred trait scores derived from         */}
          {/* existing gameplay metrics. Animated bars.                        */}
          {/* ---------------------------------------------------------------- */}
          <Reveal shown={visibleCount > 0}>
            <Card className="bg-zinc-950/85 border-white/10 hover:border-white/25 transition-all duration-500 mb-4">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] text-zinc-400 tracking-[0.45em] font-bold">
                    PLAYER TRAITS
                  </p>
                  <span className="text-[10px] font-mono text-zinc-500">
                    inferred from combat signature
                  </span>
                </div>
                <div className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent mb-4" />
                <PlayerTraits traits={ai.traits} accent={accent} />
              </CardContent>
            </Card>
          </Reveal>

          {/* ---------------------------------------------------------------- */}
          {/* PLAYER MODEL EVOLUTION — how the Director's understanding of   */}
          {/* the player has shifted across recent encounters.                */}
          {/* ---------------------------------------------------------------- */}
          <Reveal shown={visibleCount > 0}>
            <Card className="bg-zinc-950/85 border-white/10 hover:border-white/25 transition-all duration-500 mb-4">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] text-zinc-400 tracking-[0.45em] font-bold">
                    PLAYER MODEL EVOLUTION
                  </p>
                  <span className="text-[10px] font-mono text-zinc-500">
                    last {Math.max(1, ai.encounterHistory.length)} encounters
                  </span>
                </div>
                <div className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent mb-4" />
                <EvolutionChart
                  history={ai.encounterHistory}
                  accent={accent}
                />
              </CardContent>
            </Card>
          </Reveal>

          {/* ---------------------------------------------------------------- */}
          {/* MODEL CONFIDENCE HISTORY — confidence per recent encounter.    */}
          {/* ---------------------------------------------------------------- */}
          <Reveal shown={visibleCount > 0}>
            <Card className="bg-zinc-950/85 border-white/10 hover:border-white/25 transition-all duration-500 mb-4">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] text-zinc-400 tracking-[0.45em] font-bold">
                    MODEL CONFIDENCE HISTORY
                  </p>
                  <span className="text-[10px] font-mono text-zinc-500">
                    across recent encounters
                  </span>
                </div>
                <div className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent mb-4" />
                <ConfidenceHistoryChart
                  values={ai.confidenceHistory}
                  accent={accent}
                />
              </CardContent>
            </Card>
          </Reveal>


          {/* ---------------------------------------------------------------- */}
          {/* HEADER — match outcome                                           */}
          {/* ---------------------------------------------------------------- */}
          <Reveal shown={visibleCount > 0}>
            <div className="rounded-2xl border border-rose-900/25 bg-zinc-950/90 backdrop-blur p-6 sm:p-8 text-center mb-4">
              <div className="w-16 h-px bg-gradient-to-r from-transparent via-rose-700/50 to-transparent mx-auto mb-4" />
              <p className="text-[10px] text-zinc-500 tracking-[0.45em] mb-3">
                DIRECTOR REPORT
              </p>
              <h2
                className="text-4xl sm:text-6xl font-black tracking-tight"
                style={{
                  color: accent,
                  textShadow: `0 0 28px ${accent}88`,
                }}
              >
                {title}
              </h2>
              <p className="text-zinc-300 mt-3 italic leading-relaxed max-w-md mx-auto">
                {subtitle}
              </p>
              {info && (
                <p className="text-amber-300/60 text-xs mt-3 tracking-wide">
                  {info}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/40">
                  DIRECTOR · {intentKey.toUpperCase()}
                </Badge>
                <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/40">
                  CHAPTER {chapter.id}/7
                </Badge>
                <Badge
                  className={
                    finalPlan.useChampion
                      ? "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/40"
                      : "bg-zinc-500/20 text-zinc-200 border-zinc-400/40"
                  }
                >
                  AI: {finalPlan.useChampion ? "GA CHAMPION" : "BASELINE"}
                </Badge>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 max-w-md mx-auto text-left">
                <HpBar
                  label="PLAYER"
                  pct={finalPlan.playerHpFrac * 100}
                  color="#22d3ee"
                />
                <HpBar
                  label={opp.name?.toUpperCase() ?? "ENEMY"}
                  pct={finalPlan.enemyHpFrac * 100}
                  color="#ef4444"
                />
              </div>
            </div>
          </Reveal>

          {/* ---------------------------------------------------------------- */}
          {/* TWO-COLUMN GRID — Intent / Counter Plan                          */}
          {/* ---------------------------------------------------------------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* SECTION 1 — DIRECTOR INTENT */}
            <Reveal shown={visibleCount > 1}>
              <Card className="bg-zinc-950/85 border-white/10 hover:border-amber-400/30 hover:shadow-[0_0_24px_rgba(245,158,11,0.08)] transition-all duration-500 h-full">
                <CardContent className="p-4">
                  <p className="text-[10px] text-zinc-500 tracking-[0.45em] mb-2">
                    DIRECTOR INTENT
                  </p>
                  <p className="text-white text-sm font-bold leading-snug">
                    {labels.objective}
                  </p>
                  <NarrativeRow label="Narrative Purpose" value={labels.narrativePurpose} accent="text-amber-300" />
                  <NarrativeRow label="Desired Experience" value={labels.playerExperienceGoal} accent="text-emerald-300" />
                  <NarrativeRow
                    label="Primary Emotion"
                    value={chapter.emotion}
                    accent="text-rose-300"
                    isValue
                  />
                  <div className="mt-3">
                    <IntensityBar value={chapter.intensity} accent="#ef4444" />
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* SECTION 2 — DIRECTOR ANALYSIS */}
            <Reveal shown={visibleCount > 2}>
              <Card className="bg-zinc-950/85 border-white/10 hover:border-rose-400/30 hover:shadow-[0_0_24px_rgba(244,63,94,0.08)] transition-all duration-500 h-full">
                <CardContent className="p-4">
                  <p className="text-[10px] text-zinc-500 tracking-[0.45em] mb-2">
                    DIRECTOR ANALYSIS
                  </p>

                  <AnalysisRow label="WEATHER">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{
                          background: weather.tint,
                          boxShadow: `0 0 8px ${weather.tint}`,
                        }}
                      />
                      <span className="text-white text-sm font-bold tracking-wide">
                        {weather.name}
                      </span>
                    </span>
                    <p className="text-zinc-500 text-[11px] italic mt-1 leading-snug">
                      {weather.description}
                    </p>
                    <p className="text-zinc-400 text-[11px] mt-1.5 leading-snug">
                      — {analysisWhy.weather}
                    </p>
                  </AnalysisRow>

                  <AnalysisRow label="LIGHTING">
                    <span className="text-white text-sm font-bold tracking-wide">
                      {lighting.name}
                    </span>
                    <p className="text-zinc-500 text-[11px] italic mt-1 leading-snug">
                      {lighting.description}
                    </p>
                    <p className="text-zinc-400 text-[11px] mt-1.5 leading-snug">
                      — {analysisWhy.lighting}
                    </p>
                  </AnalysisRow>

                  <AnalysisRow label="CAMERA">
                    <span className="text-white text-sm font-bold tracking-wide">
                      {camera.name}
                    </span>
                    <p className="text-zinc-400 text-[11px] mt-1 leading-snug">
                      — {analysisWhy.camera}
                    </p>
                  </AnalysisRow>

                  {hazards.length > 0 && (
                    <AnalysisRow label="HAZARDS">
                      <ul className="space-y-1">
                        {hazards.map((h) => (
                          <li key={h.name}>
                            <span className="text-rose-300 text-xs font-bold tracking-wide">
                              {h.name}
                            </span>
                            <span className="text-zinc-500 text-[11px] italic">
                              {" "}— {h.reason}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </AnalysisRow>
                  )}
                </CardContent>
              </Card>
            </Reveal>

            {/* SECTION 3 — DIRECTOR COUNTER PLAN */}
            <Reveal shown={visibleCount > 3}>
              <Card className="bg-zinc-950/85 border-white/10 hover:border-fuchsia-400/30 hover:shadow-[0_0_24px_rgba(217,70,239,0.08)] transition-all duration-500 h-full">
                <CardContent className="p-4">
                  <p className="text-[10px] text-zinc-500 tracking-[0.45em] mb-2">
                    DIRECTOR COUNTER PLAN
                  </p>
                  <p className="text-zinc-300 text-[11px] italic mb-3 leading-snug">
                    {counterSteps.intro}
                  </p>
                  <ol className="space-y-2.5">
                    {counterPlanPresentation.map((s, i) => (
                      <li
                        key={i}
                        className="text-zinc-200 text-xs leading-relaxed flex gap-2.5"
                      >
                        <span className="text-rose-400/70 font-mono text-[10px] mt-0.5 shrink-0">
                          0{i + 1}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <p className="text-zinc-300 text-xs leading-relaxed">
                      {counterSteps.closing}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* SECTION 4 — DIRECTOR PLAN (causal chain) */}
            <Reveal shown={visibleCount > 4}>
              <Card className="bg-zinc-950/85 border-white/10 hover:border-cyan-400/30 hover:shadow-[0_0_24px_rgba(34,211,238,0.08)] transition-all duration-500 h-full">
                <CardContent className="p-4">
                  <p className="text-[10px] text-zinc-500 tracking-[0.45em] mb-3">
                    DIRECTOR PLAN
                  </p>

                  <ChainNode accent="#f59e0b" label="Intent">
                    {intentKey.toUpperCase()} — {labels.objective}
                  </ChainNode>
                  <ChainArrow />
                  <ChainNode accent="#a78bfa" label="Reason">
                    {labels.playerExperienceGoal}
                  </ChainNode>
                  <ChainArrow />
                  <ChainNode accent="#f472b6" label="Hypothesis">
                    {journal.liveIntent?.hypothesis ??
                      HYPOTHESIS_BY_INTENT[intentKey] ??
                      labels.narrativePurpose}
                  </ChainNode>
                  <ChainArrow />
                  <ChainNode accent="#22d3ee" label="Prediction">
                    {journal.liveIntent?.prediction ??
                      PREDICTION_BY_INTENT[intentKey] ??
                      "Player continues the current pattern."}
                  </ChainNode>
                  <ChainArrow />
                  <ChainNode accent="#ef4444" label="Emotion">
                    {chapter.emotion} · intensity {(chapter.intensity * 100).toFixed(0)}%
                  </ChainNode>
                  <ChainArrow />
                  <ChainNode accent="#a78bfa" label="Narrative Goal">
                    {labels.narrativePurpose}
                  </ChainNode>
                  <ChainArrow />
                  <div className="rounded-md border border-white/10 bg-black/30 p-2.5">
                    <p className="text-[10px] text-zinc-500 tracking-widest mb-1.5">
                      CINEMATIC DECISIONS
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      <ChainLeaf label="Weather" value={weather.name} />
                      <ChainLeaf label="Lighting" value={lighting.name} />
                      <ChainLeaf label="Camera" value={camera.name} />
                    </div>
                  </div>
                  <ChainArrow />
                  <div className="rounded-md border border-white/10 bg-black/30 p-2.5">
                    <p className="text-[10px] text-zinc-500 tracking-widest mb-1.5">
                      GAMEPLAY DECISIONS
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      <ChainLeaf
                        label="AI Genome"
                        value={finalPlan.useChampion ? "GA Champion" : "Baseline"}
                      />
                      <ChainLeaf label="Strategy" value={intentKey} />
                      <ChainLeaf
                        label="Difficulty"
                        value={`Intensity ${(chapter.intensity * 100).toFixed(0)}`}
                      />
                      <ChainLeaf
                        label="Hazards"
                        value={hazards.length > 0 ? `${hazards.length} active` : "none"}
                      />
                    </div>
                  </div>
                  <ChainArrow />
                  <ChainNode accent="#22d3ee" label="Outcome">
                    {result === "win"
                      ? `Player broke through the seal. ${opp.name} falls.`
                      : `The seal held. ${opp.name} endured intent.`}
                  </ChainNode>
                </CardContent>
              </Card>
            </Reveal>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* SECTION 5 — DIRECTOR CONFIDENCE                                  */}
          {/* ---------------------------------------------------------------- */}
          <Reveal shown={visibleCount > 5}>
            <Card className="bg-zinc-950/85 border-white/10 hover:border-emerald-400/30 hover:shadow-[0_0_24px_rgba(16,185,129,0.08)] transition-all duration-500 mb-4">
              <CardContent className="p-4">
                <p className="text-[10px] text-zinc-500 tracking-[0.45em] mb-3">
                  DIRECTOR CONFIDENCE
                </p>
                <div className="flex items-baseline gap-4">
                  <div className="flex items-baseline gap-1">
                    <span
                      className="text-5xl font-black font-mono tracking-tight"
                      style={{
                        color: accent,
                        textShadow: `0 0 18px ${accent}66`,
                      }}
                    >
                      {Math.round(confidenceAnim * 100)}
                    </span>
                    <span className="text-zinc-500 text-lg font-mono">%</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-500 text-[10px] tracking-widest mb-1">
                      PREDICTION
                    </p>
                    <p className="text-white text-sm font-bold tracking-wide">
                      {predictionMatch.title}
                    </p>
                    <p className="text-zinc-400 text-xs italic mt-0.5 leading-snug">
                      {predictionMatch.line}
                    </p>
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      width: `${confidenceAnim * 100}%`,
                      background: `linear-gradient(90deg, ${accent}, #ef4444)`,
                      boxShadow: `0 0 12px ${accent}aa`,
                      transition: "width 1500ms cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  />
                </div>
                <div className="mt-4 pt-3 border-t border-white/10">
                  <p className="text-[10px] text-zinc-500 tracking-widest mb-2">
                    REASONING
                  </p>
                  <ul className="space-y-1.5">
                    {confidenceReasons.map((r, i) => (
                      <li
                        key={i}
                        className="text-zinc-300 text-xs leading-relaxed flex gap-2"
                      >
                        <span className="text-emerald-400/70 mt-0.5 shrink-0">
                          •
                        </span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                  {predictionFailed && (
                    <p className="mt-3 text-amber-300/80 text-[11px] italic border-t border-white/5 pt-2">
                      Unexpected player adaptation detected.
                      <br />
                      Player profile updated.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </Reveal>

          {/* ---------------------------------------------------------------- */}
          {/* DIRECTOR REFLECTION — the Director evaluates its own strategy. */}
          {/* Replaces the old "unexpected adaptation" line with a full prose */}
          {/* self-evaluation that sounds like a Director, not a debugger.    */}
          {/* ---------------------------------------------------------------- */}
          <Reveal shown={visibleCount > 5}>
            <Card
              className={`bg-zinc-950/85 border-white/10 transition-all duration-500 mb-4 ${
                ai.reflection.kind === "successful"
                  ? "hover:border-emerald-400/30 hover:shadow-[0_0_24px_rgba(16,185,129,0.10)]"
                  : "hover:border-amber-400/30 hover:shadow-[0_0_24px_rgba(245,158,11,0.10)]"
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] text-zinc-500 tracking-[0.45em]">
                    DIRECTOR REFLECTION
                  </p>
                  <span
                    className={`text-[10px] font-mono tracking-widest px-2 py-0.5 rounded-full border ${
                      ai.reflection.kind === "successful"
                        ? "border-emerald-400/30 text-emerald-300"
                        : "border-amber-400/30 text-amber-300"
                    }`}
                    style={{
                      boxShadow:
                        ai.reflection.kind === "successful"
                          ? "0 0 10px rgba(16,185,129,0.18)"
                          : "0 0 10px rgba(245,158,11,0.18)",
                    }}
                  >
                    {ai.reflection.kind === "successful"
                      ? "HYPOTHESIS HELD"
                      : "HYPOTHESIS FAILED"}
                  </span>
                </div>
                <h3
                  className="text-lg sm:text-xl font-black tracking-tight mb-2"
                  style={{ color: accent, textShadow: `0 0 14px ${accent}55` }}
                >
                  {ai.reflection.headline}
                </h3>
                <p className="text-zinc-200 text-sm italic leading-relaxed">
                  {ai.reflection.line}
                </p>
              </CardContent>
            </Card>
          </Reveal>

          {/* ---------------------------------------------------------------- */}
          {/* SECTION 6 — DIRECTOR VERDICT                                     */}
          {/* ---------------------------------------------------------------- */}
          <Reveal shown={visibleCount > 6}>
            <Card
              className="bg-zinc-950/90 border-amber-400/20 hover:border-amber-400/40 hover:shadow-[0_0_28px_rgba(245,158,11,0.12)] transition-all duration-500 mb-6"
              style={{
                boxShadow: `inset 0 0 0 1px rgba(245,158,11,0.06), 0 0 28px rgba(245,158,11,0.05)`,
              }}
            >
              <CardContent className="p-5">
                <p className="text-[10px] text-zinc-500 tracking-[0.45em] mb-1">
                  DIRECTOR VERDICT
                </p>
                <h3
                  className="text-2xl sm:text-3xl font-black tracking-tight mb-3"
                  style={{
                    color: accent,
                    textShadow: `0 0 18px ${accent}55`,
                  }}
                >
                  {verdictHeadline}
                </h3>
                <div className="h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent mb-4" />
                <p className="text-zinc-200 text-sm sm:text-base leading-relaxed italic min-h-[4.5rem]">
                  {phase === "done" ? verdictText : typed}
                  {(phase === "assembling" || phase === "done") &&
                    typed.length < verdictText.length && (
                      <span className="inline-block w-2 h-4 bg-amber-300/80 ml-0.5 align-middle animate-pulse" />
                    )}
                </p>
              </CardContent>
            </Card>
          </Reveal>

          {/* ---------------------------------------------------------------- */}
          {/* ACTIONS                                                           */}
          {/* ---------------------------------------------------------------- */}
          <Reveal shown={visibleCount > 6}>
            <div className="rounded-2xl border border-rose-900/25 bg-zinc-950/90 backdrop-blur p-5 sm:p-6">
              <div className="flex flex-wrap gap-3 justify-center">
                <button
                  onClick={primary.onClick}
                  className="px-7 py-3 rounded-full bg-gradient-to-r from-rose-700 via-red-600 to-rose-800 text-white font-bold tracking-wide hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-rose-900/50 border border-rose-500/25"
                >
                  {primary.label}
                </button>
                {secondary && (
                  <button
                    onClick={secondary.onClick}
                    className="px-7 py-3 rounded-full border border-white/20 text-white font-bold tracking-wide hover:bg-white/10 active:scale-95 transition"
                  >
                    {secondary.label}
                  </button>
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

// Wrap children in a fade-in that toggles based on the parent's
// sequential reveal counter.
function Reveal({
  shown,
  children,
}: {
  shown: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`transition-all duration-700 ease-out ${
        shown
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-3 pointer-events-none"
      }`}
    >
      {children}
    </div>
  );
}

function DebriefRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2.5 first:mt-0">
      <p className="text-[9px] text-zinc-500 tracking-[0.35em]">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Arrow({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up") {
    return (
      <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
        <span>↑</span>
        <span className="text-[10px] tracking-widest text-emerald-300/70">
          UP
        </span>
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span className="text-rose-400 font-bold inline-flex items-center gap-1">
        <span>↓</span>
        <span className="text-[10px] tracking-widest text-rose-300/70">
          DOWN
        </span>
      </span>
    );
  }
  return (
    <span className="text-zinc-400 font-bold inline-flex items-center gap-1">
      <span>→</span>
      <span className="text-[10px] tracking-widest text-zinc-300/70">
        FLAT
      </span>
    </span>
  );
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

function NarrativeRow({
  label,
  value,
  accent,
  isValue,
}: {
  label: string;
  value: string;
  accent: string;
  isValue?: boolean;
}) {
  return (
    <div className="mt-2">
      <p className="text-[9px] text-zinc-600 tracking-[0.3em]">{label}</p>
      <p
        className={`text-xs mt-0.5 leading-snug ${
          isValue ? `${accent} font-bold italic text-sm` : "text-zinc-300"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function IntensityBar({ value, accent }: { value: number; accent: string }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-zinc-400 tracking-[0.3em] mb-1">
        <span>INTENSITY</span>
        <span className="font-mono text-white">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full transition-all duration-1000 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${accent}, #b91c1c)`,
            boxShadow: `0 0 10px ${accent}99`,
          }}
        />
      </div>
    </div>
  );
}

function AnalysisRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[9px] text-zinc-600 tracking-[0.3em]">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function ChainNode({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 px-3 py-2">
      <p
        className="text-[9px] tracking-[0.35em] font-bold mb-0.5"
        style={{ color: accent }}
      >
        {label.toUpperCase()}
      </p>
      <p className="text-zinc-200 text-xs leading-snug">{children}</p>
    </div>
  );
}

function ChainArrow() {
  return (
    <div className="flex justify-center py-1">
      <div className="flex flex-col items-center">
        <div className="w-px h-2 bg-gradient-to-b from-zinc-700 to-zinc-500" />
        <svg width="10" height="6" viewBox="0 0 10 6" className="text-zinc-500">
          <path
            d="M5 6 L0 0 L10 0 Z"
            fill="currentColor"
            transform="rotate(180 5 3)"
          />
        </svg>
      </div>
    </div>
  );
}

function ChainLeaf({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-500 text-[10px] tracking-wider">{label}:</span>
      <span className="text-white text-[11px] font-bold">{value}</span>
    </div>
  );
}

function HpBar({
  label,
  pct,
  color,
}: {
  label: string;
  pct: number;
  color: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-zinc-400 tracking-widest mb-1">
        <span>{label}</span>
        <span className="font-mono text-white">{clamped.toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full transition-all"
          style={{
            width: `${clamped}%`,
            background: color,
            boxShadow: `0 0 8px ${color}`,
          }}
        />
      </div>
    </div>
  );
}

// Compute the post-match HP fraction of the enemy fighter.
function enemyHpPct(engine: GameEngine): number {
  return engine.enemy.hp / Math.max(1, engine.enemy.maxHp);
}

// ============================================================================
// PLAYER TRAITS — five animated progress bars driven by derivePlayerTraits.
// Pure render, no state. The width transition animates from 0 → value on
// first paint thanks to the CSS transition rule.
// ============================================================================
function PlayerTraits({
  traits,
  accent,
}: {
  traits: PlayerTraits;
  accent: string;
}) {
  const rows: { key: keyof PlayerTraits; label: string }[] = [
    { key: "aggression", label: "Aggression" },
    { key: "patience", label: "Patience" },
    { key: "exploration", label: "Exploration" },
    { key: "riskTaking", label: "Risk Taking" },
    { key: "adaptability", label: "Adaptability" },
  ];

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {rows.map((r) => {
        const v = Math.round(traits[r.key]);
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between text-[10px] tracking-[0.35em] mb-1">
              <span className="text-zinc-400">{r.label.toUpperCase()}</span>
              <span
                className="font-mono text-xs"
                style={{ color: accent, textShadow: `0 0 8px ${accent}66` }}
              >
                {v}%
              </span>
            </div>
            <TraitBar value={v} accent={accent} />
          </li>
        );
      })}
    </ul>
  );
}

function TraitBar({ value, accent }: { value: number; accent: string }) {
  // ⠿ 10-cell block bar mirrors the example in the spec.
  const cells = 10;
  const filled = Math.round((value / 100) * cells);
  const pct = Math.max(2, value); // ensure a sliver is visible on tiny values
  return (
    <div className="space-y-1">
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${accent}, #ef4444)`,
            boxShadow: `0 0 10px ${accent}88`,
            transition: "width 1500ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
      <div className="font-mono text-[10px] tracking-[0.2em] text-zinc-500 select-none">
        <span style={{ color: accent }}>{"█".repeat(filled)}</span>
        <span className="text-zinc-700">{"░".repeat(cells - filled)}</span>
      </div>
    </div>
  );
}

// ============================================================================
// EVOLUTION CHART — show how each trait moved across recent encounters.
//
// Renders one row per trait and a column per encounter, with block bars.
// Newest encounter fades in with a slower transition than the others. If
// fewer than 5 encounters exist, the missing cells render as subdued `·`.
// ============================================================================
function EvolutionChart({
  history,
  accent,
}: {
  history: EncounterRecord[];
  accent: string;
}) {
  const slots = 5;
  const traits: { key: keyof PlayerTraits; label: string }[] = [
    { key: "aggression", label: "Aggression" },
    { key: "patience", label: "Patience" },
    { key: "exploration", label: "Exploration" },
    { key: "riskTaking", label: "Risk Taking" },
    { key: "adaptability", label: "Adaptability" },
  ];

  // Pad to length `slots` from the right (older end) so newer bars sit at
  // the right. Empty older slots render dimmed.
  const padded: (EncounterRecord | null)[] = history.slice(-slots);
  while (padded.length < slots) padded.unshift(null);

  const encounterLabels = padded.map((h, i) =>
    h ? `Encounter ${h.matchNo}` : "—",
  );

  return (
    <div>
      <div className="grid grid-cols-[110px_repeat(5,minmax(0,1fr))] gap-2 items-center text-[9px] tracking-[0.3em] text-zinc-500 mb-2">
        <span />
        {encounterLabels.map((l, i) => (
          <span
            key={i}
            className={`text-center font-mono uppercase ${
              l === "—" ? "text-zinc-700" : "text-zinc-400"
            }`}
          >
            {l}
          </span>
        ))}
      </div>

      <ul className="space-y-2">
        {traits.map((t) => {
          return (
            <li key={t.key} className="contents">
              <div className="grid grid-cols-[110px_repeat(5,minmax(0,1fr))] gap-2 items-center">
                <span className="text-[10px] text-zinc-400 tracking-[0.35em]">
                  {t.label.toUpperCase()}
                </span>
                {padded.map((h, i) => {
                  const rawVal =
                    h?.traits?.[t.key] ?? 0;
                  const v = Math.round(rawVal);
                  const isLatest = i === padded.length - 1 && h !== null;
                  return (
                    <EvolutionCell
                      key={i}
                      value={v}
                      accent={accent}
                      isLatest={isLatest}
                      empty={h === null}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-zinc-500 italic mt-3">
        Each row is the Director's read on the player for that encounter.
        Newest encounter appears at the far right.
      </p>
    </div>
  );
}

function EvolutionCell({
  value,
  accent,
  isLatest,
  empty,
}: {
  value: number;
  accent: string;
  isLatest: boolean;
  empty: boolean;
}) {
  const cells = 10;
  const filled = Math.round((value / 100) * cells);
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`font-mono text-[10px] tabular-nums ${
          empty ? "text-zinc-700" : "text-zinc-300"
        }`}
        style={!empty ? { color: accent } : undefined}
      >
        {empty ? "—" : `${value}%`}
      </span>
      <span
        className={`font-mono text-[10px] tracking-[0.15em] ${
          empty ? "text-zinc-800" : ""
        }`}
        style={{
          transition: "opacity 700ms ease-out, color 700ms ease-out",
          animation: isLatest ? "evofadein 1100ms ease-out" : undefined,
        }}
      >
        {empty ? (
          "··········"
        ) : (
          <>
            <span style={{ color: accent }}>{"█".repeat(filled)}</span>
            <span className="text-zinc-700">{"░".repeat(cells - filled)}</span>
          </>
        )}
      </span>
    </div>
  );
}

// ============================================================================
// CONFIDENCE HISTORY CHART — vertical bars showing model confidence across
// recent encounters, with labels.
// ============================================================================
function ConfidenceHistoryChart({
  values,
  accent,
}: {
  values: number[];
  accent: string;
}) {
  const slots = 5;
  const padded: (number | null)[] = values.slice(-slots);
  while (padded.length < slots) padded.unshift(null);
  const labels = padded.map((_, i) => `Encounter ${i + 1}`);

  return (
    <div>
      <div className="space-y-2">
        {padded.map((v, i) => {
          const isLatest = i === padded.length - 1 && v !== null;
          const empty = v === null;
          const safe = Math.max(0, Math.min(100, v ?? 0));
          return (
            <div
              key={i}
              className="grid grid-cols-[110px_1fr_56px] items-center gap-3"
            >
              <span
                className={`text-[10px] tracking-[0.35em] ${
                  empty ? "text-zinc-700" : "text-zinc-400"
                }`}
              >
                {labels[i].toUpperCase()}
              </span>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full"
                  style={{
                    width: empty ? "0%" : `${Math.max(2, safe)}%`,
                    background: `linear-gradient(90deg, ${accent}, #ef4444)`,
                    boxShadow: empty ? "none" : `0 0 10px ${accent}88`,
                    transition: "width 1500ms cubic-bezier(0.22,1,0.36,1)",
                    animation: isLatest
                      ? "evofadein 1100ms ease-out"
                      : undefined,
                  }}
                />
              </div>
              <span
                className={`text-right font-mono text-xs tabular-nums ${
                  empty ? "text-zinc-700" : "text-zinc-300"
                }`}
                style={!empty ? { color: accent } : undefined}
              >
                {empty ? "—" : `${safe}%`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-zinc-500 italic mt-3">
        How certain the Director has become about the player's behaviour as
        more encounters are studied.
      </p>
      <style>{`
        @keyframes evofadein {
          0%   { opacity: 0; transform: translateY(2px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
