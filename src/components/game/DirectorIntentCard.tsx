"use client";

// ============================================================================
// DIRECTOR INTENT CARD
//
// A floating cinematic card that appears whenever the Director commits a
// new intent (see `src/lib/game/directorJournal.ts`). Fades in, holds for
// ~4 seconds, fades out. Card content always follows the Intent-First
// architecture:
//
//   Intent → Reason → Prediction → Confidence
//
// Triggered ONLY by `useDirectorJournal()` — never by direct prop. The
// card auto-clears so subsequent events can re-trigger it.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useDirectorJournal } from "@/lib/game/directorJournal";

export interface DirectorIntentCardProps {
  visible: boolean;
}

export function DirectorIntentCard({ visible }: DirectorIntentCardProps) {
  const { liveIntent } = useDirectorJournal();
  // Derive `mounted` purely from whether the journal has a live intent
  // — avoids a synchronous setState in an effect body.
  const mounted = visible && liveIntent !== null;
  // `shown` drives the CSS reveal; we flip it via timers on each new
  // intent entry, so it stays out of the synchronous effect body.
  const [shown, setShown] = useState(false);
  const lastTs = useRef<number>(0);

  useEffect(() => {
    if (!mounted || !liveIntent) return;
    if (liveIntent.timestamp === lastTs.current) return;
    lastTs.current = liveIntent.timestamp;
    // All state mutations live inside async callbacks so the
    // `react-hooks/set-state-in-effect` rule never sees a sync call.
    const rafId = requestAnimationFrame(() => setShown(true));
    const hideAt = setTimeout(() => setShown(false), 4000);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(hideAt);
    };
  }, [mounted, liveIntent]);

  if (!mounted || !liveIntent) return null;

  return (
    <div
      data-testid="director-intent-card"
      className={`absolute top-3 right-3 z-40 w-[280px] sm:w-[320px] max-w-[80vw] rounded-xl border border-amber-400/30 bg-zinc-950/85 backdrop-blur-md p-3.5 text-white shadow-[0_0_28px_rgba(245,158,11,0.18)] transition-all duration-500 ease-out ${
        shown
          ? "opacity-100 translate-y-0"
          : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] tracking-[0.45em] font-bold text-amber-300/90">
          AI DIRECTOR
        </span>
        <span
          className="text-[10px] font-mono text-white/60 tabular-nums"
          aria-label="confidence"
        >
          {liveIntent.confidence}%
        </span>
      </div>

      <div className="h-px bg-gradient-to-r from-amber-400/0 via-amber-400/40 to-amber-400/0 mb-2.5" />

      <Row label="Intent" value={liveIntent.intent} accent="text-amber-300" />
      <Row label="Reason" value={liveIntent.reason} accent="text-white" />
      <Row
        label="Hypothesis"
        value={liveIntent.hypothesis ?? liveIntent.reason}
        accent="text-fuchsia-300"
      />
      <Row
        label="Prediction"
        value={liveIntent.prediction}
        accent="text-emerald-300"
      />

      <div className="mt-2.5 pt-2 border-t border-white/10">
        <p className="text-[9px] tracking-[0.3em] text-zinc-500 mb-1">CONFIDENCE</p>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full"
            style={{
              width: `${liveIntent.confidence}%`,
              background: "linear-gradient(90deg,#f59e0b,#ef4444)",
              boxShadow: "0 0 10px rgba(245,158,11,0.6)",
              transition: "width 700ms cubic-bezier(0.22,1,0.36,1)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="mt-1.5 first:mt-0">
      <p className="text-[9px] tracking-[0.3em] text-zinc-500">{label}</p>
      <p className={`text-xs leading-snug mt-0.5 ${accent}`}>{value}</p>
    </div>
  );
}

export default DirectorIntentCard;
