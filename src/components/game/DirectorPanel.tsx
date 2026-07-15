"use client";

// ============================================================================
// AI DIRECTOR PANEL
//
// The Director is a separate AI from the enemy fighter. It plans the
// EXPERIENCE of the fight — the intent, the emotional arc, the weather,
// the lighting, the chapter — and is fully transparent to the
// player.
//
// This panel is a thin React layer on top of the V3 plan computation, kept
// in the client so it can react to the current opponent index, the live
// HP/score, the current chapter, the GA-mode flag, and the player
// performance heuristic. All computation is deterministic — the same
// inputs always produce the same plan — so the player can verify
// exactly why the Director made the call it did.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OPPONENTS } from "@/lib/game/config/opponents";
import type { GameEngine } from "@/lib/game/engine";
import DirectorTimeline from "./DirectorTimeline";

export interface DirectorPanelProps {
  engine: GameEngine;
  onClose: () => void;
}

interface DirectorPlanView {
  intent: {
    objective: string;
    emotion: string;
    narrativePurpose: string;
    playerExperienceGoal: string;
  };
  chapter: {
    id: number;
    title: string;
    emotion: string;
    intensity: number;
  };
  weather: { name: string; description: string; tint: string };
  lighting: { name: string; description: string };
  camera: { name: string; shake: number; zoom: number };
  hazards: { name: string; reason: string }[];
  reasoning: string[];
  genomeSource: "ga-champion" | "baseline";
  liveAi: { mode: string; nextAttack: string | null; selfHpFrac: number };
}

// ============================================================================
// PLAN SYNTHESIS
//
// We don't need the full V3/V5 pipeline to be useful in the UI — we need
// the player to see WHY the Director is making its calls. We mirror the
// V3 intent-first philosophy here: derive the experience from the intent.
// ============================================================================

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
    objective: "Offer the player a second wind.",
    narrativePurpose: "The enemy was once an ally.",
    playerExperienceGoal: "Hopeful. Measured. Earn your second chance.",
  },
};

function buildPlan(
  oppIndex: number,
  useChampion: boolean,
  liveAi: { mode: string; nextAttack: string | null; selfHpFrac: number },
): DirectorPlanView {
  const opp = OPPONENTS[oppIndex] ?? OPPONENTS[0];
  const chapter = CHAPTERS[Math.min(oppIndex, CHAPTERS.length - 1)];
  const intentKey = chapter.intent;
  const labels = INTENT_LABELS[intentKey];

  // Reasoning: a sequence of human-readable sentences explaining the
  // Director's logic. Ordered top-down so the player can follow the
  // "why" naturally.
  const reasoning: string[] = [
    `CHAPTER ${chapter.id}/7 — ${chapter.title}.`,
    `Opponent "${opp.name}" is a ${opp.bodyType ?? "balanced"} build with rim ${opp.rim}.`,
    `Intent: ${intentKey.toUpperCase()} — ${labels.objective}`,
    `Emotion: ${chapter.emotion} (intensity ${(chapter.intensity * 100).toFixed(0)}%).`,
    `Weather chosen from intent → ${WEATHER_BY_INTENT[intentKey].name}.`,
    `Lighting follows intent → ${LIGHTING_BY_INTENT[intentKey].name}.`,
    `Camera profile: ${CAMERA_BY_INTENT[intentKey].name} (shake=${CAMERA_BY_INTENT[intentKey].shake}, zoom=${CAMERA_BY_INTENT[intentKey].zoom}).`,
  ];
  if (useChampion) {
    reasoning.push(
      `AI mode = GA-CHAMPION. The enemy is driven by the loaded champion genome (not baseline).`,
    );
  } else {
    reasoning.push(
      `AI mode = BASELINE. The enemy is driven by the static opponent definition.`,
    );
  }
  reasoning.push(
    `Live AI state: mode=${liveAi.mode}${liveAi.nextAttack ? `, next=${liveAi.nextAttack}` : ""}, hp=${(liveAi.selfHpFrac * 100).toFixed(0)}%.`,
  );

  return {
    intent: {
      objective: labels.objective,
      emotion: chapter.emotion,
      narrativePurpose: labels.narrativePurpose,
      playerExperienceGoal: labels.playerExperienceGoal,
    },
    chapter: {
      id: chapter.id,
      title: chapter.title,
      emotion: chapter.emotion,
      intensity: chapter.intensity,
    },
    weather: WEATHER_BY_INTENT[intentKey],
    lighting: LIGHTING_BY_INTENT[intentKey],
    camera: CAMERA_BY_INTENT[intentKey],
    hazards: HAZARDS_BY_INTENT[intentKey] ?? [],
    reasoning,
    genomeSource: useChampion ? "ga-champion" : "baseline",
    liveAi,
  };
}

export function DirectorPanel({ engine, onClose }: DirectorPanelProps) {
  const [oppIndex, setOppIndex] = useState(engine.opponentIndex);
  const [useChampion, setUseChampion] = useState(engine.useChampionGenome);
  const [liveAi, setLiveAi] = useState({ mode: "approach", nextAttack: null as string | null, selfHpFrac: 1 });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setOppIndex(engine.opponentIndex);
      setUseChampion(engine.useChampionGenome);
      const ai = engine.ai.getState();
      setLiveAi({
        mode: ai.mode,
        nextAttack: ai.nextAttack,
        selfHpFrac: ai.selfHpFrac,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const plan = useMemo(
    () => buildPlan(oppIndex, useChampion, liveAi),
    [oppIndex, useChampion, liveAi],
  );

  return (
    <div
      data-testid="director-panel"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto p-4 sm:p-8"
    >
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-emerald-400/60 tracking-[0.4em] text-[10px] mb-1">AI DIRECTOR</p>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-wide">
              THE DIRECTOR&apos;S PLAN
            </h2>
            <p className="text-zinc-400 text-xs sm:text-sm mt-1 max-w-2xl">
              A separate AI plans the experience of every fight — intent first, then weather, light,
              camera and hazards are derived from it. The soundtrack is fixed. Here is what it&apos;s doing right now,
              and why.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-white/20 bg-black/40 text-white hover:bg-white/10"
          >
            ✕ Close
          </Button>
        </div>

        {/* HEADER STRIP — current plan in one glance */}
        <Card className="bg-zinc-950/85 border-white/10 mb-4">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/40">
                DIRECTOR ACTIVE
              </Badge>
              <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/40">
                APPLIED TO ENGINE
              </Badge>
              <Badge
                className={
                  plan.genomeSource === "ga-champion"
                    ? "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/40"
                    : "bg-zinc-500/20 text-zinc-200 border-zinc-400/40"
                }
              >
                AI: {plan.genomeSource === "ga-champion" ? "GA CHAMPION" : "BASELINE"}
              </Badge>
              <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/40">
                CHAPTER {plan.chapter.id}/7
              </Badge>
              <Badge
                className="bg-black/60 border-white/20 text-white/80"
                style={{ boxShadow: `inset 0 0 0 1px ${plan.weather.tint}55` }}
              >
                {plan.weather.name}
              </Badge>
            </div>
            <h3 className="text-white text-lg sm:text-xl font-bold tracking-wide">
              {plan.chapter.title}
            </h3>
            <p className="text-zinc-400 text-sm mt-1 italic">
              Intent: <span className="text-emerald-300 not-italic">{plan.intent.objective}</span>
            </p>
            <div className="mt-3">
              <div className="flex items-center justify-between text-[10px] text-zinc-500 tracking-widest mb-1">
                <span>EMOTIONAL INTENSITY</span>
                <span className="text-white font-mono">
                  {(plan.chapter.intensity * 100).toFixed(0)}%
                </span>
              </div>
              <Progress value={plan.chapter.intensity * 100} className="h-2 bg-white/10" />
            </div>
          </CardContent>
        </Card>

        {/* 2-column layout: PLAN CARDS | REASONING LOG */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT — the plan */}
          <div className="space-y-4">
            <Card className="bg-zinc-950/85 border-white/10">
              <CardContent className="p-4">
                <p className="text-[10px] text-zinc-500 tracking-widest mb-1">INTENT</p>
                <p className="text-white text-sm font-bold">{plan.intent.objective}</p>
                <p className="text-zinc-400 text-xs mt-2">
                  <span className="text-zinc-500">Narrative purpose:</span>{" "}
                  {plan.intent.narrativePurpose}
                </p>
                <p className="text-zinc-400 text-xs mt-1">
                  <span className="text-zinc-500">Player experience:</span>{" "}
                  {plan.intent.playerExperienceGoal}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/85 border-white/10">
              <CardContent className="p-4">
                <p className="text-[10px] text-zinc-500 tracking-widest mb-1">WEATHER</p>
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ background: plan.weather.tint, boxShadow: `0 0 8px ${plan.weather.tint}` }}
                  />
                  <p className="text-white text-sm font-bold">{plan.weather.name}</p>
                </div>
                <p className="text-zinc-400 text-xs mt-2 italic">{plan.weather.description}</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/85 border-white/10">
              <CardContent className="p-4">
                <p className="text-[10px] text-zinc-500 tracking-widest mb-1">LIGHTING</p>
                <p className="text-white text-sm font-bold">{plan.lighting.name}</p>
                <p className="text-zinc-400 text-xs mt-2 italic">{plan.lighting.description}</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/85 border-white/10">
              <CardContent className="p-4">
                <p className="text-[10px] text-zinc-500 tracking-widest mb-1">CAMERA</p>
                <p className="text-white text-sm font-bold">{plan.camera.name}</p>
                <div className="grid grid-cols-2 gap-3 mt-2 text-[10px]">
                  <div>
                    <span className="text-zinc-500">SHAKE</span>
                    <Progress value={plan.camera.shake * 100} className="h-1.5 bg-white/10 mt-1" />
                  </div>
                  <div>
                    <span className="text-zinc-500">ZOOM</span>
                    <Progress value={plan.camera.zoom * 100} className="h-1.5 bg-white/10 mt-1" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/85 border-white/10">
              <CardContent className="p-4">
                <p className="text-[10px] text-zinc-500 tracking-widest mb-1">HAZARDS</p>
                {plan.hazards.length === 0 ? (
                  <p className="text-zinc-500 text-xs italic">none — let the moment breathe</p>
                ) : (
                  <ul className="space-y-2">
                    {plan.hazards.map((h, i) => (
                      <li key={i} className="text-xs">
                        <span className="text-amber-200 font-bold">{h.name}</span>
                        <span className="text-zinc-500"> — {h.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* RIGHT — the reasoning log */}
          <Card className="bg-zinc-950/85 border-white/10">
            <CardContent className="p-4">
              <p className="text-[10px] text-zinc-500 tracking-widest mb-2">REASONING LOG</p>
              <ScrollArea className="h-[60vh] pr-2">
                <ol className="space-y-2 text-xs leading-relaxed">
                  {plan.reasoning.map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-zinc-600 font-mono w-5 text-right">
                        {(i + 1).toString().padStart(2, "0")}
                      </span>
                      <span className="text-zinc-200">{line}</span>
                    </li>
                  ))}
                </ol>
              </ScrollArea>
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-[10px] text-zinc-500 tracking-widest mb-1">LIVE AI</p>
                <p className="text-zinc-200 text-xs font-mono">
                  mode=<span className="text-emerald-300">{plan.liveAi.mode}</span>
                  {plan.liveAi.nextAttack && (
                    <>
                      {" "}· next=<span className="text-fuchsia-300">{plan.liveAi.nextAttack}</span>
                    </>
                  )}
                  {" "}· self-hp=<span className="text-amber-300">{(plan.liveAi.selfHpFrac * 100).toFixed(0)}%</span>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* DIRECTOR'S JOURNAL — every intentional decision this fight,
              newest first. Same store the floating card uses. */}
          <DirectorTimeline className="mt-3" />
        </div>
      </div>
    </div>
  );
}

export default DirectorPanel;
