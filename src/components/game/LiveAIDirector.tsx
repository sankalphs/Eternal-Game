"use client";

import { useEffect, useState } from "react";
import type { GameEngine } from "@/lib/game/engine";

export default function LiveAIDirector({ engine }: { engine: GameEngine }) {
  const [, render] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => render((n) => n + 1), 150);
    return () => window.clearInterval(id);
  }, []);
  const director = engine.directorState.ai;
  const combat = engine.ai.getState();

  return (
    <aside className="absolute right-3 top-28 sm:top-32 z-30 w-[min(360px,calc(100vw-24px))] rounded-xl border border-sky-400/25 bg-zinc-950/80 p-3 text-white shadow-2xl backdrop-blur-md pointer-events-none">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
        <span className="text-[9px] font-bold tracking-[0.32em] text-sky-300">ANALYSIS</span>
        <span className="text-[9px] font-mono uppercase text-zinc-500">
          {director.status === "live" ? "live" : director.status === "thinking" ? "thinking" : "classic"}
        </span>
      </div>
      <div className="mt-2 grid gap-2">
        <Field
          label="LIVE ANALYSIS"
          value={`Enemy is ${combat.mode}${combat.nextAttack ? `; queuing ${combat.nextAttack}` : ""}. HP ${Math.round(combat.selfHpFrac * 100)}%. Expected player response: ${director.expectedPlayerReaction}`}
          tone="text-fuchsia-200"
        />
      </div>
    </aside>
  );
}

function Field({ label, value, tone = "text-zinc-200" }: { label: string; value: string; tone?: string }) {
  return <div><p className="text-[8px] tracking-[0.25em] text-zinc-500">{label}</p><p className={`mt-0.5 text-[11px] leading-snug ${tone}`}>{value}</p></div>;
}
