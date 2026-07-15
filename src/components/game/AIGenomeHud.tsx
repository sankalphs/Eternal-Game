"use client";

// ============================================================================
// AI GENOME HUD
//
// Sits in the bottom-left of the fight. Shows:
//   - The 12 genes of the enemy currently being fought (live values).
//   - The current AI mode (approach / block / punish / rage / etc.) and
//     the next attack it is about to throw.
//   - Whether the adaptive habit system has learned a player pattern.
//
// All state is sampled from `engine.ai.getState()` once per RAF tick; the
// genome values come from `engine.opponent` (or the loaded champion genome
// when one is applied via `applyOpponentDefToEngine`).
// ============================================================================

import { useEffect, useRef, useState } from "react";
import type { GameEngine } from "@/lib/game/engine";
import type { OpponentDef } from "@/lib/game/types";

const GENE_KEYS: { key: keyof OpponentDef; label: string; color: string }[] = [
  { key: "aggression", label: "AGG", color: "#f87171" },
  { key: "reaction", label: "REACT", color: "#fbbf24" },
  { key: "blockChance", label: "BLOCK", color: "#60a5fa" },
  { key: "combo", label: "COMBO", color: "#a78bfa" },
  { key: "whiffPunish", label: "PUNISH", color: "#34d399" },
  { key: "antiAir", label: "ANTI-AIR", color: "#22d3ee" },
  { key: "pressure", label: "PRESSURE", color: "#f472b6" },
  { key: "mixup", label: "MIXUP", color: "#c084fc" },
  { key: "adaptive", label: "ADAPTIVE", color: "#fb923c" },
  { key: "rage", label: "RAGE", color: "#ef4444" },
  { key: "perfection", label: "PERFECT", color: "#fde68a" },
  { key: "readDelay", label: "READ-DLY", color: "#94a3b8" },
];

interface AIState {
  mode: string;
  nextAttack: string | null;
  comboLeft: number;
  selfHpFrac: number;
  rageActive: boolean;
  inPunishWindow: boolean;
  blocking: boolean;
  habit: { punch: number; kick: number; roundhouse: number; jump: number; block: number; lastMove: string | null };
  genomeSource: string | null;
}

export interface AIGenomeHudProps {
  engine: GameEngine;
  visible: boolean;
}

function geneValue(def: OpponentDef, key: keyof OpponentDef): number {
  const v = def[key];
  if (typeof v !== "number") return 0;
  return key === "combo" ? Math.min(1, v / 6) : Math.max(0, Math.min(1, v));
}

function geneDisplay(def: OpponentDef, key: keyof OpponentDef): string {
  const v = def[key];
  if (typeof v !== "number") return "—";
  if (key === "combo") return `${v}`;
  return v.toFixed(2);
}

function modeColor(mode: string): string {
  switch (mode) {
    case "approach":
      return "bg-emerald-500/20 text-emerald-200 border-emerald-400/40";
    case "block":
      return "bg-sky-500/20 text-sky-200 border-sky-400/40";
    case "retreat":
      return "bg-amber-500/20 text-amber-200 border-amber-400/40";
    case "wait":
      return "bg-zinc-500/20 text-zinc-200 border-zinc-400/40";
    case "zone":
      return "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/40";
    default:
      return "bg-white/10 text-white/80 border-white/20";
  }
}

function modeReason(mode: string, ai: AIState | null): string {
  if (!ai) return mode;
  if (ai.rageActive) return "RAGE — low HP, aggression & speed boosted";
  if (ai.inPunishWindow) return "PUNISH — player whiffed, capitalising";
  if (ai.blocking) return "BLOCK — defensive, waiting for an opening";
  if (ai.habit.lastMove === "jump") return `ANTI-AIR — player jumped ${ai.habit.jump}x`;
  if (ai.habit.lastMove === "punch" && ai.habit.punch > 3) return `ADAPTIVE — countering punch spam`;
  if (ai.habit.lastMove === "kick" && ai.habit.kick > 3) return `ADAPTIVE — countering kick spam`;
  if (mode === "approach") return "APPROACH — closing distance to strike";
  if (mode === "zone") return "ZONE — holding optimal spacing";
  return mode;
}

export function AIGenomeHud({ engine, visible }: AIGenomeHudProps) {
  // The HUD always shows the LIVE AI def. When the GA toggle is on, the
  // engine mutates `engine.ai.def` to the champion's effective def — so
  // the bars and the "GA / baseline" badge update automatically.
  const [def, setDef] = useState<OpponentDef | null>(engine.ai?.def ?? engine.opponent ?? null);
  const [aiState, setAiState] = useState<AIState | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const tick = () => {
      // Prefer the live AI def (so champion genes are reflected). Fall
      // back to the static opponent when AI isn't ready.
      const live = engine.ai?.def ?? engine.opponent ?? null;
      if (live) setDef(live);
      try {
        const s = engine.ai?.getState?.() ?? null;
        if (s) setAiState(s as unknown as AIState);
      } catch {
        // engine not ready yet
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [engine, visible]);

  if (!visible || !def) return null;

  const isChampion = def.name === "Eternal Champion";
  const sourceLabel = isChampion ? "GA CHAMPION" : "BASELINE";

  return (
    <div
      data-testid="ai-genome-hud"
      className="absolute bottom-2 left-2 z-30 w-[300px] max-w-[44vw] rounded-xl border border-white/15 bg-black/70 backdrop-blur-md p-2.5 text-white/90 shadow-2xl"
    >
      {/* header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: isChampion ? "#a78bfa" : "#60a5fa", boxShadow: `0 0 8px ${isChampion ? "#a78bfa" : "#60a5fa"}` }}
          />
          <span className="text-[9px] font-bold tracking-widest text-white/70">AI GENOME</span>
          <span
            className={`text-[8px] font-bold tracking-wider px-1.5 py-0.5 rounded ${
              isChampion ? "bg-fuchsia-500/25 text-fuchsia-200" : "bg-sky-500/20 text-sky-200"
            }`}
          >
            {sourceLabel}
          </span>
        </div>
        <span className="text-[8px] text-white/50 font-mono truncate max-w-[120px]">
          {def.name}
        </span>
      </div>

      {/* live mode */}
      {aiState && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span
            className={`text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded border ${modeColor(aiState.mode)}`}
            data-testid="ai-mode"
          >
            {aiState.mode.toUpperCase()}
          </span>
          {aiState.nextAttack && (
            <span className="text-[8px] text-white/70 font-mono">
              → {aiState.nextAttack.toUpperCase()}
              {aiState.comboLeft > 0 ? ` ×${aiState.comboLeft}` : ""}
            </span>
          )}
          {aiState.rageActive && (
            <span className="text-[8px] font-bold text-red-300 animate-pulse">🔥 RAGE</span>
          )}
        </div>
      )}

      {/* gene bars */}
      <div className="grid grid-cols-3 gap-x-1.5 gap-y-1">
        {GENE_KEYS.map(({ key, label, color }) => {
          const v = geneValue(def, key);
          return (
            <div key={key} className="flex flex-col">
              <div className="flex items-center justify-between text-[7px] font-bold tracking-wider text-white/60">
                <span>{label}</span>
                <span className="font-mono text-white/80">{geneDisplay(def, key)}</span>
              </div>
              <div className="h-1 rounded-full bg-white/10 overflow-hidden mt-0.5">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${v * 100}%`, background: color, boxShadow: `0 0 4px ${color}` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* reasoning */}
      {aiState && (
        <div className="mt-1.5 pt-1.5 border-t border-white/10 text-[8px] text-white/65 leading-tight italic">
          {modeReason(aiState.mode, aiState)}
        </div>
      )}
    </div>
  );
}

export default AIGenomeHud;
