"use client";

// ============================================================================
// DIRECTOR ACTION VISUALIZER
//
// Briefly (~1.4s) renders the list of cinematic knobs the Director just
// applied, with a ✓ next to each one. Reads from the same journal store
// the IntentCard uses. Intentionally minimal — the takeaway is "the AI
// is currently executing a plan."
// ============================================================================

import { useEffect, useState } from "react";
import { useDirectorJournal } from "@/lib/game/directorJournal";

export interface DirectorActionVisualizerProps {
  visible: boolean;
}

export function DirectorActionVisualizer({
  visible,
}: DirectorActionVisualizerProps) {
  const { liveAction } = useDirectorJournal();
  const [revealCount, setRevealCount] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (!liveAction) return;
    setMounted(true);
    setRevealCount(0);
    const ts = liveAction.actions[0]; // identifier of this emission
    // Reveal each action on a slow stagger — about 1s total
    const count = liveAction.actions.length;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= count; i++) {
      timers.push(setTimeout(() => setRevealCount(i), 120 + i * 180));
    }
    const unmount = setTimeout(() => setMounted(false), 1500);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(unmount);
      void ts;
    };
  }, [liveAction, visible]);

  if (!mounted || !liveAction) return null;

  return (
    <div
      data-testid="director-action-visualizer"
      className="absolute top-[260px] sm:top-[290px] right-3 z-40 w-[260px] sm:w-[300px] rounded-xl border border-cyan-400/25 bg-zinc-950/85 backdrop-blur-md p-3 text-white shadow-[0_0_22px_rgba(34,211,238,0.18)] animate-in fade-in-0 slide-in-from-right-3 duration-400"
    >
      <p className="text-[9px] tracking-[0.45em] text-cyan-300/90 mb-2">
        APPLYING STRATEGY…
      </p>
      <p className="text-[11px] italic text-zinc-300 leading-snug mb-2">
        {liveAction.intent}
      </p>
      <ul className="space-y-1">
        {liveAction.actions.map((a, i) => (
          <li
            key={a + i}
            className={`flex items-center gap-2 text-xs transition-all duration-300 ${
              i < revealCount ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"
            }`}
          >
            <span
              className={`text-[11px] font-bold ${
                i < revealCount ? "text-emerald-400" : "text-zinc-700"
              }`}
            >
              {i < revealCount ? "✓" : "○"}
            </span>
            <span className="text-white/90">{a}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default DirectorActionVisualizer;
