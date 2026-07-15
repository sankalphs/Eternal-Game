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
  const thinkingSeconds = director.status === "thinking" && director.requestedAt
    ? Math.max(0, Math.floor((Date.now() - director.requestedAt) / 1000))
    : 0;
  const combat = engine.ai.getState();
  const statusTone =
    director.status === "live"
      ? "text-emerald-300"
      : director.status === "fallback"
        ? "text-amber-300"
        : "text-sky-300";
  const planApplied = director.status === "live" || director.status === "fallback";
  const headerLabel =
    director.status === "fallback" ? "AI DIRECTOR · CLASSIC" : "AI DIRECTOR · LIVE";

  return (
    <aside className="absolute right-3 top-16 z-30 w-[min(360px,calc(100vw-24px))] rounded-xl border border-sky-400/25 bg-zinc-950/80 p-3 text-white shadow-2xl backdrop-blur-md pointer-events-none">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
        <span className="text-[9px] font-bold tracking-[0.32em] text-sky-300">{headerLabel}</span>
        <span className={`text-[9px] font-mono uppercase ${statusTone}`}>
          {director.status === "thinking"
            ? `THINKING · ${thinkingSeconds}s`
            : director.status === "fallback"
              ? "CLASSIC"
              : director.status}
        </span>
      </div>
      <div className="mt-2 grid gap-2">
        <Field label="AI INTENT" value={director.intent} tone="text-emerald-200" />
        <Field label="ANALYSIS" value={director.reasoning} />
        <Field label="HIGH-LEVEL PLAN" value={director.highLevelPlan} tone="text-sky-200" />
        <Field
          label="LIVE ANALYSIS"
          value={`Enemy is ${combat.mode}${combat.nextAttack ? `; queuing ${combat.nextAttack}` : ""}. HP ${Math.round(combat.selfHpFrac * 100)}%. Expected player response: ${director.expectedPlayerReaction}`}
          tone="text-fuchsia-200"
        />
        {planApplied ? (
          <div>
            <p className="text-[8px] tracking-[0.25em] text-zinc-500">
              {director.status === "live" ? "APPLIED FROM LIVE QWEN" : "APPLIED FROM CLASSIC DIRECTOR (OFFLINE)"}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-1 text-[9px]">
              <Applied label="Weather" value={`${engine.directorState.weatherName} · ${Math.round(engine.directorState.weather.rate)}/s`} />
              <Applied label="Lighting" value={`${engine.directorState.lightingName} · ${Math.round(engine.directorState.lighting.intensity * 100)}%`} />
              <Applied label="Camera" value={`${engine.directorState.cameraName} · shake ${Math.round(engine.directorState.camera.baseShake * 100)}%`} />
              <Applied label="Score" value="THE IRON LOTUS · fixed mathematical score" />
              <Applied label="Darkness" value={`${Math.round(engine.directorState.hazards.darkness * 100)}%`} />
              <Applied label="Hazard damage" value={`${engine.directorState.hazards.chipDamage.toFixed(1)} HP/s`} />
            </div>
          </div>
        ) : (
          <div className="rounded border border-sky-400/20 bg-sky-500/5 p-2 text-[10px] text-sky-200">
            {director.status === "thinking"
              ? "Qwen is thinking (up to ~4s). If unavailable, Classic Director unlocks the fight automatically."
              : "No Director plan is currently applied."}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-[9px] font-mono text-zinc-500">
        <span>{director.model}</span>
        <span>
          {director.status === "live" && director.latencyMs != null
            ? `${Math.round(director.confidence * 100)}% · ${director.latencyMs}ms`
            : director.status === "fallback"
              ? "offline"
              : ""}
        </span>
      </div>
      {director.error && <p className="mt-1 text-[9px] text-amber-400/80">{director.error}</p>}
    </aside>
  );
}

function Applied({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-emerald-400/15 bg-emerald-500/5 px-1.5 py-1"><span className="text-emerald-400">✓ </span><span className="text-zinc-500">{label}: </span><span className="text-zinc-200">{value}</span></div>;
}

function Field({ label, value, tone = "text-zinc-200" }: { label: string; value: string; tone?: string }) {
  return <div><p className="text-[8px] tracking-[0.25em] text-zinc-500">{label}</p><p className={`mt-0.5 text-[11px] leading-snug ${tone}`}>{value}</p></div>;
}
