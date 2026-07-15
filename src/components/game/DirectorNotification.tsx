"use client";

// ============================================================================
// DIRECTOR NOTIFICATION
//
// A subtle, cinematic toast that appears whenever the Director's prediction
// outcome changes ("Hypothesis Confirmed" or "Unexpected Behaviour"). Reads
// from the same journal store the IntentCard uses, so the notification
// lifecycle is fully driven by `recordEncounter()` in directorJournal.
//
// Lives near the top-right under the Director cards. Auto-clears after
// ~2.2s. Pure presentation — never makes gameplay decisions.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useDirectorJournal } from "@/lib/game/directorJournal";

export function DirectorNotification() {
  const { notification } = useDirectorJournal();
  // Derive `mounted` purely from notification presence, mirroring the
  // pattern in DirectorIntentCard so we never call setState synchronously
  // inside an effect body.
  const mounted = notification !== null;
  const [shown, setShown] = useState(false);
  const lastId = useRef<number>(0);

  useEffect(() => {
    if (!mounted || !notification) return;
    if (notification.id === lastId.current) return;
    lastId.current = notification.id;
    const raf = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => setShown(false), 1900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [mounted, notification]);

  if (!mounted || !notification) return null;

  const positive = notification.tone === "correct";
  const accent = positive ? "#34d399" : "#fbbf24";
  const emblem = positive ? "✓" : "!";

  return (
    <div
      data-testid="director-notification"
      className={`pointer-events-none absolute top-3 right-3 z-30 w-[260px] sm:w-[280px] rounded-xl border backdrop-blur-md px-3 py-2 shadow-lg transition-all duration-500 ease-out ${
        shown
          ? "opacity-100 translate-y-0"
          : "opacity-0 -translate-y-2"
      }`}
      style={{
        borderColor: `${accent}55`,
        background: "rgba(9,9,11,0.85)",
        boxShadow: `0 0 24px ${accent}33`,
      }}
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <span
          className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center font-bold text-sm"
          style={{
            color: accent,
            border: `1px solid ${accent}55`,
            textShadow: `0 0 8px ${accent}aa`,
          }}
        >
          {emblem}
        </span>
        <div className="min-w-0">
          <p
            className="text-[11px] font-bold tracking-widest leading-tight"
            style={{ color: accent, textShadow: `0 0 8px ${accent}55` }}
          >
            {notification.headline.toUpperCase()}
          </p>
          <p className="text-[10px] text-zinc-300 mt-0.5 italic leading-snug">
            {notification.subline}
          </p>
        </div>
      </div>
    </div>
  );
}

export default DirectorNotification;
