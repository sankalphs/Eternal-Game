"use client";

// ============================================================================
// AI DECISION TICKER
//
// Scrolling live log of what the enemy AI did, captured each frame. The
// ticker de-dupes contiguous "same state" frames and only emits a new line
// when the mode, attack, or a meaningful state change happens.
//
// Bottom-left, below the Genome HUD. Optional (off by default — user can
// toggle from the AI Insights panel).
// ============================================================================

import { useEffect, useRef, useState } from "react";
import type { GameEngine } from "@/lib/game/engine";

export interface AIDecisionTickerProps {
  engine: GameEngine;
  visible: boolean;
  maxLines?: number;
}

interface DecisionLine {
  t: number; // seconds since start
  text: string;
  color: string;
}

const MODE_COLOR: Record<string, string> = {
  approach: "text-emerald-300",
  block: "text-sky-300",
  retreat: "text-amber-300",
  wait: "text-zinc-300",
  zone: "text-fuchsia-300",
};

function format(t: number): string {
  const s = Math.floor(t);
  const cs = Math.floor((t - s) * 100);
  return `${s}.${cs.toString().padStart(2, "0")}s`;
}

export function AIDecisionTicker({ engine, visible, maxLines = 40 }: AIDecisionTickerProps) {
  const [lines, setLines] = useState<DecisionLine[]>([]);
  const lastRef = useRef<{ mode: string; attack: string | null; rage: boolean; punish: boolean; hpFracBucket: number; combo: number; habit: string | null }>({
    mode: "?",
    attack: null,
    rage: false,
    punish: false,
    hpFracBucket: 1,
    combo: 0,
    habit: null,
  });
  const startRef = useRef<number>(performance.now());
  const fightActiveRef = useRef<boolean>(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const tick = () => {
      const phase = engine.phase;
      const wasActive = fightActiveRef.current;
      const isActive = phase === "fight";
      if (isActive && !wasActive) {
        startRef.current = performance.now();
        setLines([{ t: 0, text: "── round start ──", color: "text-white/70" }]);
        lastRef.current = { mode: "?", attack: null, rage: false, punish: false, hpFracBucket: 1, combo: 0, habit: null };
      }
      fightActiveRef.current = isActive;

      if (isActive) {
        const s = engine.ai?.getState?.() ?? null;
        if (s) {
          const t = (performance.now() - startRef.current) / 1000;
          const last = lastRef.current;
          const hpBucket = s.selfHpFrac < 0.3 ? 0 : s.selfHpFrac < 0.6 ? 1 : 2;
          const out: string[] = [];
          if (s.mode !== last.mode) out.push(`mode → ${s.mode}`);
          if (s.nextAttack && s.nextAttack !== last.attack) out.push(`queued ${s.nextAttack}`);
          if (s.rageActive && !last.rage) out.push("RAGE triggered (HP < 30%)");
          if (!s.rageActive && last.rage) out.push("rage cleared");
          if (s.inPunishWindow && !last.punish) out.push("punish window opened (player whiffed)");
          if (s.habit.lastMove && s.habit.lastMove !== last.habit) {
            out.push(`player habit: ${s.habit.lastMove}`);
          }
          if (hpBucket !== last.hpFracBucket) {
            if (hpBucket === 0) out.push("HP low → aggression boost");
            if (last.hpFracBucket === 0 && hpBucket > 0) out.push("HP recovered");
          }
          if (out.length > 0) {
            const head = out[0];
            const tail = out.length > 1 ? ` (+${out.length - 1})` : "";
            const text = `${head}${tail}`;
            const color = MODE_COLOR[s.mode] ?? "text-white/85";
            setLines((prev) => {
              const next = [...prev, { t, text, color }];
              return next.length > maxLines ? next.slice(next.length - maxLines) : next;
            });
          }
          lastRef.current = {
            mode: s.mode,
            attack: s.nextAttack,
            rage: s.rageActive,
            punish: s.inPunishWindow,
            hpFracBucket: hpBucket,
            combo: s.comboLeft,
            habit: s.habit.lastMove,
          };
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [engine, visible, maxLines]);

  if (!visible) return null;

  return (
    <div
      data-testid="ai-decision-ticker"
      className="absolute bottom-2 right-2 z-30 w-[260px] max-w-[40vw] max-h-[180px] overflow-y-auto rounded-xl border border-white/15 bg-black/70 backdrop-blur-md p-2 text-white/85 font-mono text-[9px] leading-tight shadow-2xl"
    >
      <div className="flex items-center gap-1.5 mb-1 sticky top-0 bg-black/80 py-0.5 -mt-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[8px] font-bold tracking-widest text-white/70">AI DECISIONS</span>
        <span className="ml-auto text-[8px] text-white/40">{lines.length} evts</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-1.5">
            <span className="text-white/40 shrink-0">{format(l.t)}</span>
            <span className={l.color}>{l.text}</span>
          </div>
        ))}
        {lines.length === 0 && (
          <div className="text-white/40 italic">waiting for next round…</div>
        )}
      </div>
    </div>
  );
}

export default AIDecisionTicker;
