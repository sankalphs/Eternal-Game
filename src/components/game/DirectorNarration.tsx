"use client";

// ============================================================================
// AI DIRECTOR NARRATION
//
// A small caption that lives at the top of the fight screen and surfaces
// the Director's live intent, the chapter, and what it is doing right now
// for the enemy AI. Updated on a slow interval so it reads like a
// cinematic subtitle, not a console log.
//
// Player-facing principle: every AI call that affects the player's
// experience is narrated in plain language right next to the action.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { OPPONENTS } from "@/lib/game/config/opponents";
import type { GameEngine } from "@/lib/game/engine";

export interface DirectorNarrationProps {
  engine: GameEngine;
  visible: boolean;
}

const CHAPTERS = [
  { id: 1, title: "THE LAST APPRENTICE", intent: "defiance" },
  { id: 2, title: "THE DEFECTOR", intent: "revelation" },
  { id: 3, title: "THE MARTYR", intent: "grief" },
  { id: 4, title: "THE ASSASSIN", intent: "revenge" },
  { id: 5, title: "THE COLOSSUS", intent: "defiance" },
  { id: 6, title: "THE SHOGUN", intent: "revelation" },
  { id: 7, title: "THE WORLD'S LAST HOPE", intent: "triumph" },
];

const INTENT_LABEL: Record<string, string> = {
  revenge: "make every hit count",
  revelation: "surface a truth",
  defiance: "refuse a comfortable option",
  grief: "make the player hesitate",
  triumph: "frame the player as inevitable",
  redemption: "offer a second wind",
};

const MODE_REASON: Record<string, string> = {
  approach: "closing distance to strike",
  block: "waiting for an opening",
  retreat: "creating space, kiting",
  wait: "reading the player's pattern",
  zone: "holding optimal spacing",
};

export function DirectorNarration({ engine, visible }: DirectorNarrationProps) {
  const [line, setLine] = useState<string>("");
  const [subline, setSubline] = useState<string>("");
  const lastIdxRef = useRef<number>(-1);
  const lastUpdateRef = useRef<number>(0);
  const [aiSnap, setAiSnap] = useState<{ mode: string; next: string | null; hp: number }>({
    mode: "approach",
    next: null,
    hp: 1,
  });
  const [useChampion, setUseChampion] = useState(false);
  const [oppIdx, setOppIdx] = useState(0);

  // Pull live AI state on RAF so the narration is always in sync.
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const tick = () => {
      try {
        const ai = engine.ai.getState();
        setAiSnap({ mode: ai.mode, next: ai.nextAttack, hp: ai.selfHpFrac });
      } catch {
        // engine not ready yet
      }
      setOppIdx(engine.opponentIndex);
      setUseChampion(engine.useChampionGenome);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, visible]);

  // Refresh the headline every ~1.6s, or when opponent / champion mode changes.
  useEffect(() => {
    if (!visible) return;
    const refresh = () => {
      const now = performance.now();
      if (
        now - lastUpdateRef.current < 1500 &&
        lastIdxRef.current === oppIdx
      ) {
        return;
      }
      lastUpdateRef.current = now;
      lastIdxRef.current = oppIdx;

      const opp = OPPONENTS[oppIdx] ?? OPPONENTS[0];
      const ch = CHAPTERS[Math.min(oppIdx, CHAPTERS.length - 1)];
      const aiTag = useChampion ? "GA CHAMPION" : "BASELINE";
      setLine(
        `Director · Chapter ${ch.id}/7 — ${ch.title} · Intent: ${ch.intent.toUpperCase()} (${INTENT_LABEL[ch.intent] ?? ""})`,
      );
      setSubline(
        `Enemy "${opp.name}" is being driven by the ${aiTag} AI. Current mode: ${aiSnap.mode.toUpperCase()} (${MODE_REASON[aiSnap.mode] ?? aiSnap.mode})${aiSnap.next ? `, next attack: ${aiSnap.next}` : ""}.`,
      );
    };
    refresh();
    const id = window.setInterval(refresh, 1600);
    return () => window.clearInterval(id);
  }, [visible, oppIdx, useChampion, aiSnap]);

  if (!visible) return null;
  return (
    <div
      data-testid="director-narration"
      className="pointer-events-none max-w-3xl mx-auto px-3 py-1.5 rounded-md bg-black/55 backdrop-blur border border-emerald-400/20 text-center"
    >
      <div className="text-[10px] sm:text-[11px] font-bold tracking-wider text-emerald-300 leading-tight">
        {line}
      </div>
      <div className="text-[9px] sm:text-[10px] text-zinc-300 leading-tight italic">
        {subline}
      </div>
    </div>
  );
}

export default DirectorNarration;
