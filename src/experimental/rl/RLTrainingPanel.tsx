"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rlTrainer } from "./rl";

interface LogEntry {
  episode: number;
  reward: number;
  policyLoss: number;
  valueLoss: number;
  entropy: number;
}

interface TrainingState {
  isTraining: boolean;
  episodes: number;
  targetEpisodes: number;
  lastReward: number;
  lastPolicyLoss: number;
  lastValueLoss: number;
  lastEntropy: number;
  avgReward: number;
  log: LogEntry[];
}

function getTrainerState(): TrainingState {
  const t = rlTrainer;
  const last = t.log[t.log.length - 1];
  return {
    isTraining: t.isTraining,
    episodes: t.agent.episodes,
    targetEpisodes: t.targetEpisodes,
    lastReward: last?.reward ?? 0,
    lastPolicyLoss: last?.policyLoss ?? 0,
    lastValueLoss: last?.valueLoss ?? 0,
    lastEntropy: last?.entropy ?? 0,
    avgReward: t.agent.avgReward,
    log: t.log.slice(),
  };
}

export default function RLTrainingPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [state, setState] = useState<TrainingState>(getTrainerState);
  const [batchSize, setBatchSize] = useState(50);
  const rafRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the trainer every 500ms for updates (the trainer runs async)
  useEffect(() => {
    const poll = () => setState(getTrainerState());
    pollRef.current = setInterval(poll, 500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startTraining = useCallback(
    async (eps: number) => {
      if (rlTrainer.isTraining) return;
      // Run in the background, yielding to the UI thread
      void rlTrainer.trainBatch(eps, 5);
    },
    [],
  );

  const stopTraining = useCallback(() => {
    rlTrainer.stop();
  }, []);

  const clearModel = useCallback(() => {
    rlTrainer.clearSaved();
    setState(getTrainerState());
  }, []);

  // Reward chart data (last 100 points)
  const chartData = state.log.slice(-100);
  const maxAbsReward = Math.max(1, ...chartData.map((d) => Math.abs(d.reward)));

  const pct = Math.min(
    100,
    (state.episodes / Math.max(1, state.targetEpisodes)) * 100,
  );

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-3xl rounded-2xl border border-sky-900/40 bg-zinc-950/90 backdrop-blur p-5 sm:p-7 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-sky-400/60 tracking-[0.3em] text-[10px] mb-0.5">
              REINFORCEMENT LEARNING
            </p>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">
              🧠 RL TRAINING LAB
            </h2>
            <p className="text-zinc-500 text-xs mt-1">
              PPO agent · 2×128 network · vs random opponent · auto-saved to localStorage
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white border border-white/15 rounded-full px-3 py-1.5 text-xs transition"
          >
            ✕ Close
          </button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <Stat
            label="EPISODES"
            value={String(state.episodes)}
            sub={`/ ${state.targetEpisodes}`}
            color="text-sky-300"
          />
          <Stat
            label="AVG REWARD"
            value={state.avgReward.toFixed(1)}
            sub="per episode"
            color="text-emerald-300"
          />
          <Stat
            label="VALUE LOSS"
            value={state.lastValueLoss.toFixed(3)}
            sub="MSE"
            color="text-amber-300"
          />
          <Stat
            label="ENTROPY"
            value={state.lastEntropy.toFixed(3)}
            sub="exploration"
            color="text-violet-300"
          />
        </div>

        {/* Progress bar */}
        <div className="mb-5">
          <div className="flex justify-between text-[10px] text-zinc-500 mb-1 tracking-widest">
            <span>TRAINING PROGRESS</span>
            <span>{pct.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-black/60 border border-sky-900/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-500 to-violet-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Reward chart */}
        <div className="mb-5">
          <div className="flex justify-between text-[10px] text-zinc-500 mb-1 tracking-widest">
            <span>REWARD (last {chartData.length} episodes)</span>
            <span
              className={
                state.isTraining ? "text-emerald-400 animate-pulse" : ""
              }
            >
              {state.isTraining ? "● TRAINING" : "○ IDLE"}
            </span>
          </div>
          <div className="h-32 bg-black/50 border border-white/10 rounded-lg p-2 relative overflow-hidden">
            {chartData.length < 2 ? (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-xs">
                Run training to see the reward curve
              </div>
            ) : (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="w-full h-full"
              >
                {/* zero line */}
                <line
                  x1="0"
                  y1={
                    50 +
                    (0 / maxAbsReward) * 40
                  }
                  x2="100"
                  y2={
                    50 +
                    (0 / maxAbsReward) * 40
                  }
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="0.5"
                  strokeDasharray="2 2"
                />
                {/* reward polyline */}
                <polyline
                  points={chartData
                    .map((d, i) => {
                      const x = (i / (chartData.length - 1)) * 100;
                      const y = 50 - (d.reward / maxAbsReward) * 40;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
                {/* value loss polyline (normalized) */}
                <polyline
                  points={chartData
                    .map((d, i) => {
                      const x = (i / (chartData.length - 1)) * 100;
                      const maxVL = Math.max(
                        0.01,
                        ...chartData.map((e) => e.valueLoss),
                      );
                      const y = 100 - (d.valueLoss / maxVL) * 45;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="0.8"
                  strokeOpacity="0.6"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
          <div className="flex gap-4 mt-1.5 text-[9px] tracking-wider">
            <span className="flex items-center gap-1 text-sky-400">
              <span className="w-3 h-0.5 bg-sky-400" /> Reward
            </span>
            <span className="flex items-center gap-1 text-amber-400">
              <span className="w-3 h-0.5 bg-amber-400" /> Value Loss
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-2 items-center justify-center">
          {!state.isTraining ? (
            <>
              <button
                onClick={() => startTraining(batchSize)}
                className="px-5 py-2.5 rounded-full bg-gradient-to-r from-sky-600 to-violet-600 text-white font-bold tracking-wide hover:scale-105 active:scale-95 transition shadow-lg shadow-sky-900/50"
              >
                ▶ TRAIN {batchSize} EPISODES
              </button>
              <button
                onClick={() => startTraining(500)}
                className="px-4 py-2.5 rounded-full border border-sky-500/40 bg-sky-950/40 text-sky-200 font-bold text-sm hover:bg-sky-900/40 active:scale-95 transition"
              >
                TRAIN 500
              </button>
              <button
                onClick={() => startTraining(state.targetEpisodes - state.episodes)}
                disabled={state.episodes >= state.targetEpisodes}
                className="px-4 py-2.5 rounded-full border border-violet-500/40 bg-violet-950/40 text-violet-200 font-bold text-sm hover:bg-violet-900/40 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                TRAIN TO TARGET
              </button>
            </>
          ) : (
            <button
              onClick={stopTraining}
              className="px-5 py-2.5 rounded-full bg-rose-700 text-white font-bold tracking-wide hover:bg-rose-600 active:scale-95 transition shadow-lg shadow-rose-900/50"
            >
              ⏹ STOP TRAINING
            </button>
          )}
          <button
            onClick={clearModel}
            className="px-4 py-2.5 rounded-full border border-zinc-600/40 text-zinc-400 font-bold text-sm hover:bg-zinc-800/40 hover:text-zinc-200 active:scale-95 transition"
          >
            🗑 CLEAR MODEL
          </button>
        </div>

        {/* Batch size selector */}
        {!state.isTraining && (
          <div className="flex items-center justify-center gap-2 mt-3 text-[10px] text-zinc-500">
            <span className="tracking-widest">BATCH:</span>
            {[25, 50, 100, 250].map((n) => (
              <button
                key={n}
                onClick={() => setBatchSize(n)}
                className={`px-2 py-1 rounded border transition ${
                  batchSize === n
                    ? "border-sky-500/60 bg-sky-950/50 text-sky-300"
                    : "border-zinc-700/40 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        {/* Info */}
        <div className="mt-5 p-3 rounded-lg bg-sky-950/20 border border-sky-900/30 text-[11px] text-zinc-400 leading-relaxed">
          <p className="text-sky-300/80 font-bold mb-1 tracking-wide">
            HOW IT WORKS
          </p>
          <p>
            The agent trains against a{" "}
            <span className="text-sky-300">fixed random opponent</span> in a
            lightweight simulation. Each episode, transitions are collected and
            a{" "}
            <span className="text-sky-300">PPO update</span> runs (8 epochs,
            clipped surrogate ε=0.2, GAE-λ=0.95, entropy bonus decaying
            β=0.005→0.0005). Weights auto-save to{" "}
            <code className="text-violet-300">localStorage</code> every 50
            episodes, so the trained ghost persists across page refreshes. Once
            trained, fight it via{" "}
            <span className="text-violet-300">FIGHT RL GHOST</span> on the menu.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-black/40 border border-white/10 p-3">
      <div className="text-[9px] tracking-[0.2em] text-zinc-500 mb-1">
        {label}
      </div>
      <div className={`text-xl font-black ${color}`}>{value}</div>
      <div className="text-[9px] text-zinc-600">{sub}</div>
    </div>
  );
}
