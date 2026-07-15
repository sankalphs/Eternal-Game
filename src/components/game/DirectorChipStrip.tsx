"use client";

// ============================================================================
// DIRECTOR CHIP STRIP
//
// A compact row of pills placed at the top-left of the fight canvas, just
// below the existing tool row. Each chip surfaces one of the live
// cinematic knobs the Director is currently applying — weather, lighting,
// camera and any active hazards. The soundtrack is fixed and independent.
//
// Reads ONLY from `engine.directorState` (`DirectorRuntimeState` shape
// from `src/lib/game/director/DirectorRuntime.ts`). No new computation,
// no LLM.
//
// Visual style: translucent dark pill, faint accent glow, mono-tiny
// label. Hover lifts the chip slightly.
// ============================================================================

import { useEffect, useState } from "react";
import type { GameEngine } from "@/lib/game/engine";
import type { DirectorRuntimeState } from "@/lib/game/director/DirectorRuntime";

export interface DirectorChipStripProps {
  engine: GameEngine;
  visible: boolean;
}

interface Chip {
  id: string;
  icon: string;
  label: string;
  accent: string;
}

const ICON_WEATHER: Record<string, string> = {
  rain: "🌧",
  snow: "❄",
  ash: "☠",
  fog: "🌫",
  ember: "🔥",
  dust: "✦",
  fireflies: "✧",
  petals: "❀",
  shadow: "◐",
  none: "·",
};

export function DirectorChipStrip({ engine, visible }: DirectorChipStripProps) {
  const [chips, setChips] = useState<Chip[]>([]);
  const [, setN] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const tick = () => {
      const ds: DirectorRuntimeState | undefined = engine.directorState;
      if (ds) setChips(buildChips(ds));
      setN((n) => (n + 1) % 100000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, visible]);

  if (!visible) return null;
  if (chips.length === 0) return null;

  return (
    <div
      data-testid="director-chip-strip"
      className="absolute top-[7.25rem] sm:top-[8.25rem] left-3 z-30 flex flex-col items-start gap-1.5 max-w-[40vw] pointer-events-none animate-in fade-in-0 slide-in-from-top-2 duration-700"
    >
      {chips.map((c) => (
        <div
          key={c.id}
          className="group pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-black/60 backdrop-blur-md px-2.5 py-1 text-[10px] sm:text-[11px] text-white shadow-[0_0_18px_rgba(0,0,0,0.4)] hover:border-white/40 hover:translate-y-[-1px] transition-all duration-300"
          style={{
            boxShadow: `0 0 14px ${c.accent}33, 0 0 18px rgba(0,0,0,0.4)`,
          }}
          title={c.label}
        >
          <span aria-hidden className="text-[11px] leading-none">
            {c.icon}
          </span>
          <span className="font-bold tracking-wider leading-none whitespace-nowrap">
            {c.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function buildChips(ds: DirectorRuntimeState): Chip[] {
  const chips: Chip[] = [];
  const we = ds.weather?.type ?? "none";
  const icon = ICON_WEATHER[we] ?? "·";
  if (ds.weatherName && we !== "none" && (ds.weather?.rate ?? 0) > 0) {
    chips.push({
      id: "weather",
      icon,
      label: titleCase(ds.weatherName),
      accent: ds.weather?.color ?? "#f59e0b",
    });
  }
  if (ds.lightingName) {
    chips.push({
      id: "lighting",
      icon: "💡",
      label: titleCase(ds.lightingName),
      accent: ds.lighting?.tint ?? "#fde68a",
    });
  }
  if (ds.cameraName) {
    chips.push({
      id: "camera",
      icon: "🎥",
      label: titleCase(ds.cameraName),
      accent: "#a78bfa",
    });
  }
  const h = ds.hazards ?? { darkness: 0, chipDamage: 0, slipFactor: 0 };
  if (h.darkness > 0) {
    chips.push({
      id: "darkness",
      icon: "◐",
      label: `Darkness ${Math.round(h.darkness * 100)}%`,
      accent: "#64748b",
    });
  }
  if (h.chipDamage > 0) {
    chips.push({
      id: "chip",
      icon: "⚠",
      label: "Chip Damage",
      accent: "#f87171",
    });
  }
  if (h.slipFactor > 0) {
    chips.push({
      id: "slip",
      icon: "❄",
      label: "Slippery Ground",
      accent: "#60a5fa",
    });
  }
  return chips;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

export default DirectorChipStrip;
