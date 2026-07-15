"use client";

// ============================================================================
// DIRECTOR TIMELINE
//
// Renders the Director's recent journal of decisions. Used by the in-fight
// Director panel as the "DIRECTOR'S JOURNAL" section.
//
// Reads ONLY from `useDirectorJournal()`. The list is rendered newest
// first; the store caps it at 20 entries so the DOM never grows.
// ============================================================================

import { useDirectorJournal } from "@/lib/game/directorJournal";

export interface DirectorTimelineProps {
  className?: string;
}

export function DirectorTimeline({ className = "" }: DirectorTimelineProps) {
  const { entries } = useDirectorJournal();

  return (
    <div
      data-testid="director-timeline"
      className={`rounded-lg border border-white/10 bg-black/40 backdrop-blur-sm ${className}`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <p className="text-[10px] tracking-[0.45em] text-emerald-300">
          DIRECTOR'S JOURNAL
        </p>
        <p className="text-[10px] text-zinc-500 font-mono">
          {entries.length} / 20
        </p>
      </div>

      <div className="max-h-72 overflow-y-auto p-2 space-y-2">
        {entries.length === 0 && (
          <p className="text-zinc-500 text-xs italic text-center py-6">
            The Director is observing. First decision will be recorded here.
          </p>
        )}
        {entries.map((e, i) => (
          <TimelineEntry
            key={e.timestamp + "-" + i}
            t={e.t}
            intent={e.intent}
            reason={e.reason}
            prediction={e.prediction}
            confidence={e.confidence}
            actions={e.actions}
            result={e.result}
            accent={i === 0 ? "#f59e0b" : "#a78bfa"}
          />
        ))}
      </div>
    </div>
  );
}

function TimelineEntry({
  t,
  intent,
  reason,
  prediction,
  confidence,
  actions,
  result,
  accent,
}: {
  t: number;
  intent: string;
  reason: string;
  prediction: string;
  confidence: number;
  actions: string[];
  result?: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-md border border-white/10 bg-zinc-950/70 px-3 py-2"
      style={{ boxShadow: `inset 2px 0 0 ${accent}` }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-mono tabular-nums"
          style={{ color: accent }}
        >
          {format(t)}
        </span>
        <span className="text-[10px] text-zinc-500 font-mono">
          {confidence}%
        </span>
      </div>
      <p className="mt-1 text-xs font-bold text-white leading-tight">
        {intent}
      </p>
      <p className="text-[11px] text-zinc-400 italic leading-snug">
        {reason}
      </p>
      <p className="text-[11px] text-emerald-300/90 leading-snug mt-0.5">
        → {prediction}
      </p>
      {actions.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {actions.map((a, i) => (
            <li
              key={i}
              className="text-[11px] text-cyan-300/90 leading-snug flex items-start gap-1.5"
            >
              <span className="text-emerald-400/70 mt-0.5 shrink-0">✓</span>
              <span>{a}</span>
            </li>
          ))}
        </ul>
      )}
      {result && (
        <p className="mt-1 text-[10px] text-amber-300/80 italic border-t border-white/5 pt-1">
          result · {result}
        </p>
      )}
    </div>
  );
}

function format(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default DirectorTimeline;
