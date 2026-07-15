"use client";

// ============================================================================
// POST-MATCH PLAYER ANALYSIS
//
// Shown after a fight. During combat Qwen is never called — only Classic
// Director runs. Here we:
//   1. Derive grade / archetype / observations / traits locally
//      (computeAIDebrief).
//   2. Call Qwen once for a 1-paragraph analysis + next genome style.
//   3. Load that style genome and stage it on the engine for the next fight.
//
// UI shows ONLY:
//   • Grade
//   • Player model (archetype, behavioral observations)
//   • Player traits
//   • One-paragraph summary
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { GameEngine } from "@/lib/game/engine";
import {
  computeAIDebrief,
  recordEncounter,
  type PlayerTraits,
} from "@/lib/game/directorJournal";
import {
  buildAnalysisSummary,
  buildPostMatchDirectorContext,
  selectGenomeStyleFromIntent,
  type IntentLike,
} from "@/lib/game/postMatchAnalysis";
import type { GenomeStyle } from "@/lib/game/evolution/types";

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

const ANALYSIS_LOG_LINES = [
  "Reading combat signature…",
  "Profiling player archetype…",
  "Scoring grade…",
  "Requesting Qwen analysis…",
  "Selecting next genome…",
  "Assembling report…",
];

const QWEN_TIMEOUT_MS = 12_000;

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
  const ai = useMemo(() => computeAIDebrief(engine), [engine]);
  const ranRef = useRef(false);

  const [phase, setPhase] = useState<"analyzing" | "ready">("analyzing");
  const [progress, setProgress] = useState(0);
  const [logIdx, setLogIdx] = useState(0);
  const [summary, setSummary] = useState(() =>
    buildAnalysisSummary(engine, ai, result, null),
  );
  const [selectedStyle, setSelectedStyle] = useState<GenomeStyle | null>(null);
  const [qwenStatus, setQwenStatus] = useState<"pending" | "live" | "local">(
    "pending",
  );

  // Record this encounter once for history bookkeeping.
  useEffect(() => {
    const matchNo =
      (engine.playerWins ?? 0) + (engine.enemyWins ?? 0) + 1;
    recordEncounter(engine, matchNo);
  }, [engine]);

  // Progress bar + log lines while analysis runs.
  useEffect(() => {
    if (phase !== "analyzing") return;
    const tick = window.setInterval(() => {
      setProgress((p) => Math.min(96, p + 3));
    }, 80);
    const logTimer = window.setInterval(() => {
      setLogIdx((i) => Math.min(i + 1, ANALYSIS_LOG_LINES.length));
    }, 550);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(logTimer);
    };
  }, [phase]);

  // Qwen post-match only: analysis paragraph + genome selection for next fight.
  // Runs exactly once per panel mount (ref guard against Strict Mode double-invoke
  // still allows cleanup abort; second invoke is skipped).
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);

    (async () => {
      let intent: IntentLike | null = null;
      let modelLabel = "local";

      try {
        const response = await fetch("/api/ai/director", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(
            buildPostMatchDirectorContext(engine, result, ai),
          ),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? `Analysis failed (${response.status})`);
        }
        intent = data.intent as IntentLike;
        modelLabel = typeof data.model === "string" ? data.model : "Qwen";
        if (!cancelled) setQwenStatus("live");
      } catch {
        if (!cancelled) setQwenStatus("local");
      }

      const style = intent
        ? selectGenomeStyleFromIntent(intent)
        : selectGenomeStyleFromLocal(ai);
      const para = buildAnalysisSummary(engine, ai, result, intent);

      // Stage the selected genome for the next fight (never mid-combat).
      try {
        const gRes = await fetch(
          `/api/ai/genome?style=${encodeURIComponent(style)}`,
        );
        if (gRes.ok) {
          const gData = await gRes.json();
          if (gData?.ok && gData.genome?.genes) {
            engine.setChampionOverride({
              id: gData.genome.id ?? null,
              source: gData.genome.source ?? `style:${style}`,
              generation: gData.genome.generation ?? 0,
              version: gData.genome.version ?? null,
              genes: gData.genome.genes,
              fitnessHistory: Array.isArray(gData.genome.fitnessHistory)
                ? gData.genome.fitnessHistory
                : [],
              style,
            });
            engine.setUseChampionGenome(true);
          }
        }
      } catch {
        // Genome library optional — analysis still completes.
      }

      if (cancelled) return;
      setSelectedStyle(style);
      setSummary(
        intent
          ? `${para} Next opponent genome: ${style}.`
          : `${para} Next opponent genome: ${style} (${modelLabel} unavailable — local pick).`,
      );
      setProgress(100);
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [engine, result, ai]);

  return (
    <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-sm overflow-hidden">
      {phase === "analyzing" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/95 backdrop-blur-md">
          <div className="w-full max-w-md px-6">
            <p className="text-[10px] text-zinc-500 tracking-[0.45em] text-center mb-2">
              QWEN ANALYSIS
            </p>
            <div className="h-px bg-gradient-to-r from-transparent via-rose-700/50 to-transparent mb-6" />
            <div className="space-y-1.5 font-mono text-xs">
              {ANALYSIS_LOG_LINES.slice(0, Math.max(1, logIdx)).map((text, i) => (
                <p
                  key={i}
                  className="text-zinc-400 animate-in fade-in-0 slide-in-from-left-2 duration-300"
                >
                  <span className="text-emerald-400/70 mr-2">›</span>
                  {text}
                  {i === Math.max(0, logIdx - 1) &&
                    i < ANALYSIS_LOG_LINES.length - 1 && (
                      <span className="inline-block w-2 h-3 bg-amber-300/70 ml-1 align-middle animate-pulse" />
                    )}
                </p>
              ))}
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

      <div
        className={`absolute inset-0 overflow-y-auto p-4 sm:p-6 transition-opacity duration-700 ${
          phase === "ready" ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="w-full max-w-2xl mx-auto pb-12">
          {/* Outcome header */}
          <div className="rounded-2xl border border-rose-900/25 bg-zinc-950/90 backdrop-blur p-6 sm:p-8 text-center mb-4">
            <p className="text-[10px] text-zinc-500 tracking-[0.45em] mb-3">
              MATCH RESULT
            </p>
            <h2
              className="text-4xl sm:text-5xl font-black tracking-tight"
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
          </div>

          {/* PLAYER MODEL — grade, archetype, observations */}
          <Card className="bg-zinc-950/90 border-amber-400/25 mb-4">
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

              <Row label="Archetype">
                <p
                  className="text-base sm:text-lg font-black tracking-tight leading-tight"
                  style={{
                    color: accent,
                    textShadow: `0 0 12px ${accent}55`,
                  }}
                >
                  {ai.archetype}
                </p>
              </Row>

              <Row label="Behavioral Observations">
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
              </Row>
            </CardContent>
          </Card>

          {/* PLAYER TRAITS */}
          <Card className="bg-zinc-950/85 border-white/10 mb-4">
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
              <PlayerTraitsBars traits={ai.traits} accent={accent} />
            </CardContent>
          </Card>

          {/* One-paragraph summary */}
          <Card className="bg-zinc-950/90 border-amber-400/20 mb-6">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-zinc-500 tracking-[0.45em]">
                  ANALYSIS
                </p>
                <span className="text-[9px] font-mono text-zinc-500 tracking-widest">
                  {qwenStatus === "live"
                    ? "QWEN"
                    : qwenStatus === "local"
                      ? "LOCAL"
                      : "…"}
                  {selectedStyle ? ` · ${selectedStyle.toUpperCase()}` : ""}
                </span>
              </div>
              <div className="h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent mb-4" />
              <p className="text-zinc-200 text-sm sm:text-base leading-relaxed italic">
                {summary}
              </p>
            </CardContent>
          </Card>

          {/* Actions */}
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
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectGenomeStyleFromLocal(
  ai: ReturnType<typeof computeAIDebrief>,
): GenomeStyle {
  const t = ai.traits;
  if (t.aggression >= 70 && t.riskTaking >= 60) return "counter";
  if (t.patience >= 65) return "pressure";
  if (t.exploration >= 65) return "mindGame";
  if (t.adaptability >= 70) return "adaptive";
  if (t.aggression < 40) return "rushdown";
  return "balanced";
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[9px] text-zinc-500 tracking-[0.35em]">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function PlayerTraitsBars({
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
        const cells = 10;
        const filled = Math.round((v / 100) * cells);
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
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-1">
              <div
                className="h-full"
                style={{
                  width: `${Math.max(2, v)}%`,
                  background: `linear-gradient(90deg, ${accent}, #ef4444)`,
                  boxShadow: `0 0 10px ${accent}88`,
                  transition: "width 1500ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
            </div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-zinc-500 select-none">
              <span style={{ color: accent }}>{"█".repeat(filled)}</span>
              <span className="text-zinc-700">
                {"░".repeat(cells - filled)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
