"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { STORY_BEATS, STORY_DURATION, TITLE } from "@/lib/game/story";
import { coverScale, ridge } from "@/lib/game/canvas-utils";
import type { SceneKind } from "@/lib/game/story";

export default function StoryIntro({ onFinish }: { onFinish: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const lastFrameRef = useRef(0);
  const finishedRef = useRef(false);
  const prevSceneRef = useRef<{ kind: SceneKind; t: number } | null>(null);
  const sceneAlphaRef = useRef(1); // crossfade alpha
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [beatIdx, setBeatIdx] = useState(0);

  const beat = STORY_BEATS[beatIdx] ?? STORY_BEATS[0];
  const progress = Math.min(1, time / STORY_DURATION);

  // ---- typed-line derivation ----
  const typed = useMemo(() => {
    const local = beat;
    const span = local.end - local.t;
    const elapsed = time - local.t;
    const per = span / local.lines.length;
    const visible = Math.min(local.lines.length, Math.floor(elapsed / per) + 1);
    const shown: string[] = [];
    for (let i = 0; i < visible; i++) {
      if (i < visible - 1) shown.push(local.lines[i]);
      else {
        const lineElapsed = elapsed - i * per;
        const chars = Math.max(
          0,
          Math.min(
            local.lines[i].length,
            Math.floor((lineElapsed / per) * local.lines[i].length),
          ),
        );
        shown.push(local.lines[i].slice(0, chars));
      }
    }
    return shown;
  }, [time, beat]);

  // ---- main render loop ----
  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const W = 960;
    const H = 540;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scale = coverScale(vw, vh, W, H);
      const w = W * scale;
      const h = H * scale;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvas.style.position = "absolute";
      canvas.style.left = (vw - w) / 2 + "px";
      canvas.style.top = (vh - h) / 2 + "px";
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = (now: number) => {
      if (!lastFrameRef.current) lastFrameRef.current = now;
      const dt = Math.min(0.1, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      if (playingRef.current) timeRef.current = Math.min(STORY_DURATION, timeRef.current + dt);
      const t = timeRef.current;
      setTime(t);
      if (t >= STORY_DURATION && !finishedRef.current) {
        finishedRef.current = true;
        playingRef.current = false;
        setPlaying(false);
        const a = audioRef.current;
        if (a) a.pause();
        window.setTimeout(onFinish, 600);
      }
      let bi = 0;
      for (let i = 0; i < STORY_BEATS.length; i++) {
        if (t >= STORY_BEATS[i].t) bi = i;
      }
      setBeatIdx(bi);

      // crossfade tracking: when the scene changes, fade in over 0.8s
      const cur = STORY_BEATS[bi];
      const ps = prevSceneRef.current;
      if (!ps || ps.kind !== cur.scene) {
        prevSceneRef.current = { kind: cur.scene, t };
        sceneAlphaRef.current = 0;
      }
      sceneAlphaRef.current = Math.min(1, sceneAlphaRef.current + 0.04);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sx = canvas.width / W;
      ctx.setTransform(sx, 0, 0, sx, 0, 0);
      // fade from black on scene change
      const a = sceneAlphaRef.current;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = a;
      drawScene(ctx, cur.scene, t, W, H);
      ctx.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [started]);

  // ---- controls ----
  const start = useCallback(() => {
    timeRef.current = 0;
    lastFrameRef.current = performance.now();
    finishedRef.current = false;
    playingRef.current = true;
    setPlaying(true);
    setStarted(true);
    const a = audioRef.current;
    if (a) {
      a.currentTime = 0;
      a.play().catch(() => {});
    }
  }, []);

  const skip = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    const a = audioRef.current;
    if (a) a.pause();
    onFinish();
  }, [onFinish]);

  const togglePause = useCallback(() => {
    playingRef.current = !playingRef.current;
    lastFrameRef.current = performance.now();
    setPlaying(playingRef.current);
    const a = audioRef.current;
    if (a) {
      if (playingRef.current) a.play().catch(() => {});
      else a.pause();
    }
  }, []);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none">
      <canvas ref={canvasRef} className="block" />
      <audio ref={audioRef} src="/audio/Steel_on_the_Riverbank.mp3" preload="auto" />

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65) 100%)",
        }}
      />

      {/* Act label */}
      {started && (
        <div className="absolute top-5 left-6 z-20 text-rose-200/60 font-mono text-xs sm:text-sm tracking-[0.25em]">
          {beat.act}
        </div>
      )}

      {/* Lower-third subtitles (cinematic, centered) */}
      {started && (
        <div className="absolute left-0 right-0 z-20 px-6 sm:px-16 pointer-events-none"
          style={{ bottom: "8%" }}
        >
          <div
            className="max-w-2xl mx-auto text-center min-h-[4.5em]"
            style={{ textShadow: "0 2px 10px rgba(0,0,0,0.95)" }}
          >
            {typed.map((line, i) => (
              <p
                key={i}
                className="text-white/85 text-lg sm:text-2xl font-light leading-relaxed tracking-wide"
                style={{
                  opacity: i === typed.length - 1 ? 1 : 0.5,
                  transition: "opacity 0.6s",
                }}
              >
                {line}
                <span className="text-rose-300/80">
                  {i === typed.length - 1 && line.length < (beat.lines[i]?.length ?? 0) ? "▍" : ""}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Title card on the final beat */}
      {started && beat.scene === "final_riverbank" && time > 138 && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div
            className="text-center animate-[sfpop_0.8s_ease-out]"
            style={{ textShadow: "0 0 30px rgba(180,30,20,0.85), 0 4px 16px #000" }}
          >
            <div className="text-rose-300/70 tracking-[0.4em] text-xs sm:text-sm mb-2">
              ETERNAL
            </div>
            <div className="text-white text-4xl sm:text-7xl font-black tracking-tight">
              {TITLE}
            </div>
          </div>
        </div>
      )}

      {/* Pre-start overlay */}
      {!started && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm text-center px-6">
          <div className="text-rose-300/60 tracking-[0.4em] text-xs sm:text-sm mb-3">
            ETERNAL
          </div>
          <h1
            className="text-white text-4xl sm:text-6xl font-black tracking-tight mb-3"
            style={{ textShadow: "0 0 28px rgba(180,30,20,0.6)" }}
          >
            {TITLE}
          </h1>
          <p className="text-zinc-400 text-sm max-w-md mb-8">
            A tale in eight acts. Best experienced with sound on.
            <br />
            <span className="text-zinc-500">2:22 · cinematic prologue</span>
          </p>
          <button
            onClick={start}
            className="px-8 py-3 rounded-full bg-gradient-to-r from-rose-700 via-red-600 to-rose-800 text-white font-black tracking-widest text-lg hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-rose-900/50 border border-rose-500/30"
          >
            ▶ BEGIN THE TALE
          </button>
          <button
            onClick={onFinish}
            className="mt-4 text-xs text-zinc-500 hover:text-zinc-300 transition"
          >
            skip the story →
          </button>
        </div>
      )}

      {/* In-story controls */}
      {started && (
        <>
          <div className="absolute top-0 left-0 right-0 h-1 bg-black/40 z-30">
            <div
              className="h-full bg-gradient-to-r from-rose-600 to-red-500 transition-[width]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="absolute top-3 right-3 z-40 flex gap-2">
            <button
              onClick={togglePause}
              aria-label={playing ? "Pause" : "Play"}
              className="w-9 h-9 rounded-full border border-white/20 bg-black/50 backdrop-blur text-white/80 hover:bg-white/15 active:scale-95 transition flex items-center justify-center text-xs"
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <button
              onClick={skip}
              aria-label="Skip"
              className="w-9 h-9 rounded-full border border-white/20 bg-black/50 backdrop-blur text-white/80 hover:bg-white/15 active:scale-95 transition flex items-center justify-center text-xs"
            >
              ✕
            </button>
          </div>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 text-[11px] text-white/40 font-mono tabular-nums pointer-events-none">
            {fmt(time)} / 2:22
          </div>
        </>
      )}
    </div>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ================================================================ SCENE RENDERER
// Each story beat paints a DISTINCT scene that visually depicts its narration.

function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: SceneKind,
  t: number,
  W: number,
  H: number,
) {
  switch (scene) {
    case "dawn_oath":
      sceneDawnOath(ctx, t, W, H);
      break;
    case "march_hunt":
      sceneMarchHunt(ctx, t, W, H);
      break;
    case "seals":
      sceneSeals(ctx, t, W, H);
      break;
    case "village":
      sceneVillage(ctx, t, W, H);
      break;
    case "gate_meet":
      sceneGateMeet(ctx, t, W, H);
      break;
    case "gate_fight":
      sceneGateFight(ctx, t, W, H);
      break;
    case "reflection_twist":
      sceneReflectionTwist(ctx, t, W, H);
      break;
    case "demon_reveal":
      sceneDemonReveal(ctx, t, W, H);
      break;
    case "screaming":
      sceneScreaming(ctx, t, W, H);
      break;
    case "final_riverbank":
      sceneFinalRiverbank(ctx, t, W, H);
      break;
  }
}

// ---------- shared helpers ----------
function gradSky(ctx: CanvasRenderingContext2D, stops: [number, string][], H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [p, c] of stops) g.addColorStop(p, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1e5, H);
}
function shimmerWater(ctx: CanvasRenderingContext2D, bankY: number, W: number, H: number, t: number, tint: string, alpha: number) {
  for (let i = 0; i < 16; i++) {
    const y = bankY + 4 + i * 5;
    ctx.strokeStyle = tint.replace("ALPHA", String((0.12 + i * 0.01) * alpha));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.05 + t * 2 + i) * 1.4);
    ctx.stroke();
  }
}
function emberDrift(ctx: CanvasRenderingContext2D, t: number, W: number, H: number, n: number, red: boolean) {
  for (let i = 0; i < n; i++) {
    const seed = i * 41.3;
    const x = (seed * 1.7 + t * (10 + (i % 5) * 4)) % W;
    const y = (H - ((seed * 0.6) % H) - t * (8 + (i % 4) * 3)) % H;
    const yy = (y + H) % H;
    ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(t * 1.5 + i));
    ctx.fillStyle = red ? "rgba(255,90,40,0.9)" : "rgba(255,200,120,0.8)";
    ctx.fillRect(x, yy, 2, 2);
  }
  ctx.globalAlpha = 1;
}
function silhouette(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, rim: string, sword: boolean, demon: boolean) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.shadowColor = demon ? "#ef4444" : rim;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "#050505";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // legs
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(-6, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(6, 0); ctx.stroke();
  // torso
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(0, -70); ctx.stroke();
  // head
  ctx.fillStyle = "#050505";
  ctx.beginPath(); ctx.arc(0, -78, 6, 0, Math.PI * 2); ctx.fill();
  // arms
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -64); ctx.lineTo(8, -50); ctx.lineTo(12, -34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -64); ctx.lineTo(-8, -52); ctx.lineTo(-6, -38); ctx.stroke();
  if (sword) {
    ctx.strokeStyle = demon ? "rgba(255,80,60,0.9)" : "rgba(220,230,255,0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(12, -34); ctx.lineTo(18, -2); ctx.stroke();
  }
  ctx.restore();
}

// ---------- SCENE 1: dawn oath — lone figure at a riverbank at dawn ----------
function sceneDawnOath(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  gradSky(ctx, [[0, "#1a1530"], [0.5, "#4a2350"], [0.85, "#9a3a3a"], [1, "#e07040"]], H);
  // stars
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  for (let i = 0; i < 50; i++) {
    const x = (i * 71.3) % W, y = (i * 53.7) % (H * 0.4);
    ctx.globalAlpha = 0.3 + 0.6 * Math.abs(Math.sin(t * 2 + i));
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.globalAlpha = 1;
  // sun
  const sx = W * 0.5, sy = H * 0.62;
  const gl = ctx.createRadialGradient(sx, sy, 6, sx, sy, 260);
  gl.addColorStop(0, "rgba(255,220,160,0.9)"); gl.addColorStop(0.35, "rgba(255,180,90,0.3)"); gl.addColorStop(1, "rgba(255,140,60,0)");
  ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,235,180,0.95)"; ctx.beginPath(); ctx.arc(sx, sy, 38, 0, Math.PI * 2); ctx.fill();
  // hills
  ridge(ctx, [0, 30, 140, 80, 300, 40, 460, 95, 620, 55, 800, 100, 960, 70], H * 0.66, "rgba(20,10,24,0.7)");
  ridge(ctx, [0, 18, 160, 45, 340, 22, 500, 55, 660, 28, 820, 60, 960, 35], H * 0.68, "rgba(8,4,10,0.88)");
  // riverbank
  const bankY = H * 0.8;
  ctx.fillStyle = "#0c0608"; ctx.fillRect(0, bankY, W, H - bankY);
  // water
  const wg = ctx.createLinearGradient(0, bankY, 0, H);
  wg.addColorStop(0, "#0c1018"); wg.addColorStop(1, "#000004");
  ctx.fillStyle = wg; ctx.fillRect(0, bankY, W, H - bankY);
  shimmerWater(ctx, bankY, W, H, t, "rgba(255,200,140,ALPHA)", 1);
  // the lone figure, swearing (kneeling-ish, sword planted)
  const fx = W * 0.32, fy = bankY;
  ctx.save();
  ctx.translate(fx, fy);
  const bob = Math.sin(t * 1.2) * 1;
  ctx.translate(0, bob);
  silhouette(ctx, 0, 0, 1.1, "#e2e8f0", true, false);
  // sword planted in the ground
  ctx.strokeStyle = "rgba(220,230,255,0.7)"; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(18, -2); ctx.lineTo(18, 38); ctx.stroke();
  ctx.restore();
  // mist
  ctx.globalAlpha = 0.4;
  for (let i = 0; i < 3; i++) {
    const y = H * (0.62 + i * 0.07), off = (t * (8 + i * 4)) % (W + 200);
    const g = ctx.createLinearGradient(0, y - 15, 0, y + 25);
    g.addColorStop(0, "rgba(200,200,220,0)"); g.addColorStop(0.5, `rgba(200,200,220,${0.2 - i * 0.04})`); g.addColorStop(1, "rgba(200,200,220,0)");
    ctx.fillStyle = g; ctx.fillRect(-200 + off, y - 15, W + 400, 40); ctx.fillRect(-200 + off - W, y - 15, W + 400, 40);
  }
  ctx.globalAlpha = 1;
}

// ---------- SCENE 2: march hunt — silhouette marching, demon shapes ahead ----------
function sceneMarchHunt(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  gradSky(ctx, [[0, "#100a1c"], [0.5, "#2a1430"], [1, "#6a2a3a"]], H);
  // a winding path
  ctx.strokeStyle = "rgba(40,20,30,0.6)"; ctx.lineWidth = 40; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-20, H * 0.9);
  ctx.quadraticCurveTo(W * 0.3, H * 0.78, W * 0.55, H * 0.82);
  ctx.quadraticCurveTo(W * 0.8, H * 0.86, W + 20, H * 0.7);
  ctx.stroke();
  // distant hills
  ridge(ctx, [0, 50, 200, 110, 420, 60, 640, 130, 860, 70, 960, 90], H * 0.6, "rgba(14,8,16,0.8)");
  // demon shapes ahead on the path (small dark hunched figures with red eyes)
  for (let i = 0; i < 3; i++) {
    const dx = W * (0.7 + i * 0.08);
    const dy = H * (0.82 - i * 0.01) + Math.sin(t * 3 + i) * 1.5;
    ctx.fillStyle = "#060406";
    ctx.beginPath();
    ctx.ellipse(dx, dy, 9, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    // red eyes
    ctx.fillStyle = "rgba(240,50,40,0.9)";
    ctx.fillRect(dx - 3, dy - 10, 2, 1.6);
    ctx.fillRect(dx + 1, dy - 10, 2, 1.6);
  }
  // the hero marching from the left
  const fx = W * 0.22 + Math.sin(t * 1.5) * 2;
  silhouette(ctx, fx, H * 0.85, 1.0, "#e2e8f0", true, false);
  emberDrift(ctx, t, W, H, 14, false);
}

// ---------- SCENE 3: seals — body with glowing seals, reflection fading ----------
function sceneSeals(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  gradSky(ctx, [[0, "#0c0814"], [0.6, "#1c1024"], [1, "#3a1828"]], H);
  // still water filling most of the frame (the reflection)
  const wg = ctx.createLinearGradient(0, 0, 0, H);
  wg.addColorStop(0, "#1a1422"); wg.addColorStop(1, "#08040c");
  ctx.fillStyle = wg; ctx.fillRect(0, H * 0.3, W, H * 0.7);
  // the figure center, standing
  const fx = W * 0.5, fy = H * 0.3;
  silhouette(ctx, fx, fy, 1.2, "#e2e8f0", true, false);
  // glowing seals orbiting the figure
  for (let i = 0; i < 5; i++) {
    const a = t * 0.8 + i * (Math.PI * 2 / 5);
    const sx = fx + Math.cos(a) * 50;
    const sy = fy - 40 + Math.sin(a) * 30;
    const g = ctx.createRadialGradient(sx, sy, 1, sx, sy, 14);
    g.addColorStop(0, "rgba(255,210,120,0.9)"); g.addColorStop(1, "rgba(255,180,60,0)");
    ctx.fillStyle = g; ctx.fillRect(sx - 14, sy - 14, 28, 28);
    ctx.fillStyle = "rgba(255,240,200,0.95)";
    ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
  }
  // the reflection — fading (flickering opacity)
  const refA = 0.15 + 0.1 * Math.abs(Math.sin(t * 4));
  ctx.save();
  ctx.globalAlpha = refA;
  ctx.translate(fx, fy + (fy - H * 0.3) + H * 0.3 - fy);
  ctx.scale(1, -1);
  silhouette(ctx, 0, 0, 1.2, "#e2e8f0", true, false);
  ctx.restore();
  ctx.globalAlpha = 1;
  shimmerWater(ctx, H * 0.3, W, H, t, "rgba(180,140,200,ALPHA)", 0.5);
}

// ---------- SCENE 4: village — a crowd cheering, torches ----------
function sceneVillage(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  gradSky(ctx, [[0, "#1a1208"], [0.5, "#3a2410"], [1, "#7a3a14"]], H);
  // distant village huts (silhouettes with warm window glows)
  const baseY = H * 0.72;
  for (const hx of [80, 200, 760, 880]) {
    ctx.fillStyle = "#0a0604";
    // hut body
    ctx.fillRect(hx, baseY - 50, 50, 50);
    // roof
    ctx.beginPath();
    ctx.moveTo(hx - 8, baseY - 50); ctx.lineTo(hx + 25, baseY - 78); ctx.lineTo(hx + 58, baseY - 50);
    ctx.closePath(); ctx.fill();
    // warm window
    ctx.fillStyle = "rgba(255,180,80,0.8)";
    ctx.fillRect(hx + 18, baseY - 38, 14, 12);
  }
  // ground
  ctx.fillStyle = "#0a0604"; ctx.fillRect(0, baseY, W, H - baseY);
  // a crowd of small silhouettes cheering (arms raised), with torches
  for (let i = 0; i < 16; i++) {
    const cx = 60 + i * 56 + Math.sin(t * 2 + i) * 1.5;
    const cy = baseY + 8 + (i % 2) * 6;
    const raise = Math.sin(t * 4 + i * 0.5) * 3;
    ctx.strokeStyle = "#060406"; ctx.lineWidth = 3; ctx.lineCap = "round";
    // body
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 22); ctx.stroke();
    // head
    ctx.fillStyle = "#060406"; ctx.beginPath(); ctx.arc(cx, cy - 27, 4, 0, Math.PI * 2); ctx.fill();
    // raised arms
    ctx.beginPath(); ctx.moveTo(cx, cy - 18); ctx.lineTo(cx - 6, cy - 30 - raise); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 18); ctx.lineTo(cx + 6, cy - 30 - raise); ctx.stroke();
    // torch in one hand
    const tx = cx + 6, ty = cy - 30 - raise;
    const g = ctx.createRadialGradient(tx, ty, 1, tx, ty, 12);
    g.addColorStop(0, "rgba(255,200,80,0.9)"); g.addColorStop(1, "rgba(255,120,30,0)");
    ctx.fillStyle = g; ctx.fillRect(tx - 12, ty - 12, 24, 24);
    ctx.fillStyle = "rgba(255,220,140,0.95)";
    ctx.beginPath(); ctx.arc(tx, ty, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  // the hero standing tall in center-back, hailed
  silhouette(ctx, W * 0.5, baseY, 1.3, "#e2e8f0", true, false);
  emberDrift(ctx, t, W, H, 24, false);
}

// ---------- SCENE 5: gate meet — the gate, an old master waiting ----------
function sceneGateMeet(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  gradSky(ctx, [[0, "#0a0818"], [0.5, "#1a1030"], [1, "#3a1840"]], H);
  // the gate, center, towering
  const cx = W * 0.5, baseY = H * 0.8;
  ctx.fillStyle = "#000";
  ctx.fillRect(cx - 90, baseY - 200, 16, 200);
  ctx.fillRect(cx + 74, baseY - 200, 16, 200);
  ctx.fillRect(cx - 90, baseY - 216, 180, 16);
  // doors
  ctx.fillStyle = "#06030a";
  ctx.fillRect(cx - 74, baseY - 196, 72, 196);
  ctx.fillRect(cx + 2, baseY - 196, 72, 196);
  // a sliver of light between doors
  const lg = ctx.createLinearGradient(0, baseY - 196, 0, baseY);
  lg.addColorStop(0, "rgba(255,200,120,0.6)"); lg.addColorStop(1, "rgba(255,200,120,0)");
  ctx.fillStyle = lg; ctx.fillRect(cx - 2, baseY - 196, 4, 196);
  // ground
  ctx.fillStyle = "#080410"; ctx.fillRect(0, baseY, W, H - baseY);
  // the old master, small, hunched, waiting before the gate
  const mx = cx - 120;
  ctx.save();
  ctx.translate(mx, baseY);
  ctx.scale(0.9, 0.9);
  ctx.strokeStyle = "#0a0608"; ctx.lineWidth = 5; ctx.lineCap = "round";
  // hunched body
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(2, -34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2, -34); ctx.lineTo(-4, -50); ctx.stroke(); // hunched back
  ctx.fillStyle = "#0a0608"; ctx.beginPath(); ctx.arc(-4, -55, 5, 0, Math.PI * 2); ctx.fill();
  // staff
  ctx.strokeStyle = "rgba(120,90,60,0.8)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(12, -56); ctx.stroke();
  ctx.restore();
  // the hero approaching from the left
  silhouette(ctx, W * 0.22, baseY, 1.1, "#e2e8f0", true, false);
  emberDrift(ctx, t, W, H, 18, false);
}

// ---------- SCENE 5b: gate fight — INTENSE sword clash at the gate ----------
// Two silhouettes (the shadow vs the master) duel with choreographed clashes,
// spark bursts on impact, motion trails, and a pulsing gate behind them.
function sceneGateFight(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  // dark, intense sky with pulsing red from the gate
  const pulse = 0.5 + 0.5 * Math.sin(t * 6);
  gradSky(ctx, [[0, "#08040a"], [0.5, "#18060f"], [1, "#3a0a14"]], H);

  const cx = W * 0.5;
  const baseY = H * 0.8;

  // the gate, pulsing with red light (cracking open)
  ctx.fillStyle = "#000";
  ctx.fillRect(cx - 90, baseY - 200, 16, 200);
  ctx.fillRect(cx + 74, baseY - 200, 16, 200);
  ctx.fillRect(cx - 90, baseY - 216, 180, 16);
  // doors slightly open, red light pouring through
  const openW = 8 + pulse * 6;
  ctx.fillStyle = "#06030a";
  ctx.fillRect(cx - 74 - openW/2, baseY - 196, 70, 196);
  ctx.fillRect(cx + 4 + openW/2, baseY - 196, 70, 196);
  // red gate light
  const gl = ctx.createLinearGradient(0, baseY - 196, 0, baseY);
  gl.addColorStop(0, `rgba(255,40,30,${0.5 + pulse * 0.4})`);
  gl.addColorStop(1, "rgba(255,40,30,0)");
  ctx.fillStyle = gl;
  ctx.fillRect(cx - openW/2, baseY - 196, openW, 196);
  // gate glow halo
  const halo = ctx.createRadialGradient(cx, baseY - 100, 10, cx, baseY - 100, 180);
  halo.addColorStop(0, `rgba(180,30,20,${0.3 + pulse * 0.2})`);
  halo.addColorStop(1, "rgba(180,30,20,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  // ground
  ctx.fillStyle = "#06030a";
  ctx.fillRect(0, baseY, W, H - baseY);

  // ---- fight choreography ----
  // Each clash cycle: approach → clash (spark!) → recoil → reset.
  // Cycle length ~1.1s (synced to ~107 BPM, 2 beats per clash).
  const sceneT = t - 62; // time within the fight scene
  const cycleDur = 1.1;
  const cyc = (sceneT % cycleDur) / cycleDur; // 0..1 within a cycle
  // 0-0.35: approach, 0.35-0.45: clash hold, 0.45-0.7: recoil, 0.7-1: reset
  const clashing = cyc > 0.33 && cyc < 0.47;
  const clashPt = cyc >= 0.34 && cyc <= 0.38; // brief spark window

  // fighter positions: shadow (left) and master (right), centered on gate
  const gap = clashing ? 26 : 70 + Math.sin(cyc * Math.PI) * 30; // close on clash
  const shX = cx - gap;
  const maX = cx + gap;
  // lunge offsets
  const lunge = clashing ? 8 : 0;
  const shLunge = lunge;
  const maLunge = -lunge;

  // motion trails before the clash (approach phase)
  if (cyc < 0.35 && !clashing) {
    const trailA = 0.15 * (0.35 - cyc) / 0.35;
    ctx.globalAlpha = trailA;
    silhouette(ctx, shX - 18, baseY, 1.1, "#e2e8f0", true, false);
    silhouette(ctx, maX + 18, baseY, 1.0, "#f59e0b", true, false);
    ctx.globalAlpha = 1;
  }

  // draw both fighters
  // the shadow (left, white-rimmed)
  drawFighter(ctx, shX + shLunge, baseY, 1.1, "#e2e8f0", true, false, cyc, true);
  // the master (right, amber-rimmed, hunched)
  drawFighter(ctx, maX + maLunge, baseY, 1.0, "#f59e0b", true, false, cyc, false);

  // ---- spark burst on clash ----
  if (clashPt) {
    const sparkX = cx;
    const sparkY = baseY - 70;
    const sa = 1 - (cyc - 0.34) / 0.04; // fade over the spark window
    // bright flash core
    const fg = ctx.createRadialGradient(sparkX, sparkY, 2, sparkX, sparkY, 60);
    fg.addColorStop(0, `rgba(255,250,220,${sa})`);
    fg.addColorStop(0.3, `rgba(255,180,80,${sa * 0.6})`);
    fg.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = fg;
    ctx.fillRect(sparkX - 60, sparkY - 60, 120, 120);
    // radiating sparks
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + t;
      const sp = 80 + Math.random() * 140;
      const len = 8 + Math.random() * 10;
      ctx.strokeStyle = `rgba(255,230,160,${sa * 0.8})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sparkX, sparkY);
      ctx.lineTo(sparkX + Math.cos(ang) * sp * 0.3, sparkY + Math.sin(ang) * sp * 0.3);
      ctx.stroke();
    }
    ctx.restore();
    // impact ring
    ctx.strokeStyle = `rgba(255,220,150,${sa * 0.7})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, (1 - sa) * 40 + 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  // crossed sword-glow lines between them during clash hold
  if (clashing) {
    ctx.strokeStyle = "rgba(220,235,255,0.6)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(shX + 14, baseY - 50);
    ctx.lineTo(maX - 14, baseY - 90);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(shX + 14, baseY - 90);
    ctx.lineTo(maX - 14, baseY - 50);
    ctx.stroke();
  }

  emberDrift(ctx, t, W, H, 30, true);
}

// A duel fighter: silhouette with a swinging sword arm driven by the cycle.
function drawFighter(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  scale: number,
  rim: string,
  sword: boolean,
  demon: boolean,
  cyc: number,
  facingRight: boolean,
) {
  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(scale, scale);
  if (!facingRight) ctx.scale(-1, 1);
  ctx.shadowColor = demon ? "#ef4444" : rim;
  ctx.shadowBlur = 12;
  ctx.strokeStyle = "#050505";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // legs (stance)
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(-7, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(6, 0); ctx.stroke();
  // torso (slight forward lean)
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(4, -70); ctx.stroke();
  // head
  ctx.fillStyle = "#050505";
  ctx.beginPath(); ctx.arc(4, -78, 6, 0, Math.PI * 2); ctx.fill();
  // back arm
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(4, -64); ctx.lineTo(-6, -54); ctx.lineTo(-8, -40); ctx.stroke();
  // sword arm — swings on the clash (front arm raised then strikes down)
  const swing = cyc > 0.2 && cyc < 0.45 ? 1 : 0; // raised during approach/clash
  const sx = 4 + 8, sy = -64;
  const handX = sx + (swing ? 10 : 4);
  const handY = sy + (swing ? -10 : -4);
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(handX, handY); ctx.stroke();
  // sword
  if (sword) {
    ctx.strokeStyle = demon ? "rgba(255,80,60,0.9)" : "rgba(220,235,255,0.8)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    // sword points forward+down on clash, up during wind-up
    const tipX = handX + (swing ? 22 : 8);
    const tipY = handY + (swing ? 18 : -22);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- SCENE 6: reflection twist — reflection is NOT the hero ----------
function sceneReflectionTwist(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  gradSky(ctx, [[0, "#0a0608"], [0.6, "#280810"], [1, "#5a1018"]], H);
  // water fills lower half
  const bankY = H * 0.5;
  const wg = ctx.createLinearGradient(0, bankY, 0, H);
  wg.addColorStop(0, "#1a0608"); wg.addColorStop(1, "#080204");
  ctx.fillStyle = wg; ctx.fillRect(0, bankY, W, H - bankY);
  // the figure standing at the bank edge
  const fx = W * 0.5, fy = bankY;
  silhouette(ctx, fx, fy, 1.3, "#e2e8f0", true, false);
  // the reflection — a DIFFERENT, demonic face (red-rimmed, horned)
  ctx.save();
  ctx.translate(fx, bankY);
  ctx.scale(1.3, -1.3);
  ctx.translate(0, -(fy - bankY) / 1.3);
  // draw a demon reflection
  ctx.shadowColor = "#ef4444"; ctx.shadowBlur = 14;
  ctx.strokeStyle = "#1a0204"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(-6, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(6, 0); ctx.stroke();
  ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(0, -70); ctx.stroke();
  ctx.fillStyle = "#1a0204"; ctx.beginPath(); ctx.arc(0, -78, 6, 0, Math.PI * 2); ctx.fill();
  // horns
  ctx.strokeStyle = "rgba(239,68,68,0.9)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-5, -82); ctx.lineTo(-9, -92); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(5, -82); ctx.lineTo(9, -92); ctx.stroke();
  // glowing eyes
  ctx.fillStyle = "rgba(255,60,40,0.95)";
  ctx.fillRect(-3, -79, 2, 1.6); ctx.fillRect(1, -79, 2, 1.6);
  ctx.restore();
  ctx.globalAlpha = 1;
  shimmerWater(ctx, bankY, W, H, t, "rgba(200,40,40,ALPHA)", 0.6);
  emberDrift(ctx, t, W, H, 20, true);
}

// ---------- SCENE 7: demon reveal — hero silhouette splits to show the demon ----------
function sceneDemonReveal(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  gradSky(ctx, [[0, "#06040a"], [0.5, "#1a0410"], [1, "#460814"]], H);
  const cx = W * 0.5, cy = H * 0.78;
  // the hero skin peeling away (two halves drifting apart)
  const split = Math.min(40, (t - 103) * 8);
  // left half
  ctx.save();
  ctx.globalAlpha = Math.max(0, 0.5 - (t - 103) * 0.03);
  ctx.translate(cx - split, cy);
  ctx.scale(-1, 1);
  silhouette(ctx, 0, 0, 1.4, "#e2e8f0", false, false);
  ctx.restore();
  // right half
  ctx.save();
  ctx.globalAlpha = Math.max(0, 0.5 - (t - 103) * 0.03);
  ctx.translate(cx + split, cy);
  silhouette(ctx, 0, 0, 1.4, "#e2e8f0", false, false);
  ctx.restore();
  ctx.globalAlpha = 1;
  // the demon within, growing in
  const grow = Math.min(1.4, 0.6 + (t - 104) * 0.12);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(grow, grow);
  ctx.shadowColor = "#ef4444"; ctx.shadowBlur = 20;
  ctx.strokeStyle = "#0a0204"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(-6, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(6, 0); ctx.stroke();
  ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(0, -70); ctx.stroke();
  ctx.fillStyle = "#0a0204"; ctx.beginPath(); ctx.arc(0, -78, 6, 0, Math.PI * 2); ctx.fill();
  // horns + glowing eyes
  ctx.strokeStyle = "rgba(239,68,68,0.95)"; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(-5, -82); ctx.lineTo(-10, -94); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(5, -82); ctx.lineTo(10, -94); ctx.stroke();
  ctx.fillStyle = "rgba(255,70,40,0.98)";
  ctx.fillRect(-3.5, -79, 2.2, 1.8); ctx.fillRect(1.3, -79, 2.2, 1.8);
  ctx.restore();
  ctx.fillStyle = "#06030a"; ctx.fillRect(0, H * 0.78, W, H - H * 0.78);
  emberDrift(ctx, t, W, H, 30, true);
}

// ---------- SCENE 8: screaming — the cheering crowd revealed as screaming/fleeing ----------
function sceneScreaming(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  gradSky(ctx, [[0, "#080406"], [0.5, "#280608"], [1, "#5a0a0e"]], H);
  const baseY = H * 0.72;
  ctx.fillStyle = "#08040a"; ctx.fillRect(0, baseY, W, H - baseY);
  // the crowd — same huts but now dark windows
  for (const hx of [80, 200, 760, 880]) {
    ctx.fillStyle = "#060406";
    ctx.fillRect(hx, baseY - 50, 50, 50);
    ctx.beginPath();
    ctx.moveTo(hx - 8, baseY - 50); ctx.lineTo(hx + 25, baseY - 78); ctx.lineTo(hx + 58, baseY - 50);
    ctx.closePath(); ctx.fill();
  }
  // crowd fleeing (leaning away, arms up in terror)
  for (let i = 0; i < 16; i++) {
    const cx = 60 + i * 56 + Math.sin(t * 6 + i) * 2;
    const cy = baseY + 8 + (i % 2) * 6;
    const flee = Math.sin(t * 5 + i) * 4;
    ctx.strokeStyle = "#060406"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - flee, cy - 22); ctx.stroke();
    ctx.fillStyle = "#060406"; ctx.beginPath(); ctx.arc(cx - flee, cy - 27, 4, 0, Math.PI * 2); ctx.fill();
    // arms thrown up in terror
    ctx.beginPath(); ctx.moveTo(cx - flee, cy - 18); ctx.lineTo(cx - flee - 7, cy - 34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - flee, cy - 18); ctx.lineTo(cx - flee + 7, cy - 34); ctx.stroke();
    // open screaming mouth (tiny red)
    ctx.fillStyle = "rgba(120,20,20,0.7)";
    ctx.fillRect(cx - flee - 1, cy - 28, 2, 2);
  }
  // the shadow looms center, demonic now
  ctx.save();
  ctx.translate(W * 0.5, baseY);
  ctx.scale(1.5, 1.5);
  ctx.shadowColor = "#ef4444"; ctx.shadowBlur = 22;
  ctx.strokeStyle = "#0a0204"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(-6, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(6, 0); ctx.stroke();
  ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(0, -70); ctx.stroke();
  ctx.fillStyle = "#0a0204"; ctx.beginPath(); ctx.arc(0, -78, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(239,68,68,0.95)"; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(-5, -82); ctx.lineTo(-10, -94); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(5, -82); ctx.lineTo(10, -94); ctx.stroke();
  ctx.fillStyle = "rgba(255,70,40,0.98)";
  ctx.fillRect(-3.5, -79, 2.2, 1.8); ctx.fillRect(1.3, -79, 2.2, 1.8);
  ctx.restore();
  emberDrift(ctx, t, W, H, 36, true);
}

// ---------- SCENE 9: final riverbank — shadow stands where the oath was sworn, river red ----------
function sceneFinalRiverbank(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  gradSky(ctx, [[0, "#060408"], [0.5, "#1a0408"], [1, "#460810"]], H);
  const sx = W * 0.5, sy = H * 0.62;
  const gl = ctx.createRadialGradient(sx, sy, 6, sx, sy, 280);
  gl.addColorStop(0, "rgba(180,30,20,0.9)"); gl.addColorStop(0.35, "rgba(140,20,20,0.3)"); gl.addColorStop(1, "rgba(120,10,10,0)");
  ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,60,40,0.9)"; ctx.beginPath(); ctx.arc(sx, sy, 38, 0, Math.PI * 2); ctx.fill();
  ridge(ctx, [0, 30, 140, 80, 300, 40, 460, 95, 620, 55, 800, 100, 960, 70], H * 0.66, "rgba(20,4,8,0.8)");
  ridge(ctx, [0, 18, 160, 45, 340, 22, 500, 55, 660, 28, 820, 60, 960, 35], H * 0.68, "rgba(8,2,4,0.9)");
  const bankY = H * 0.8;
  ctx.fillStyle = "#0a0204"; ctx.fillRect(0, bankY, W, H - bankY);
  // red water
  const wg = ctx.createLinearGradient(0, bankY, 0, H);
  wg.addColorStop(0, "#3a0608"); wg.addColorStop(1, "#1a0204");
  ctx.fillStyle = wg; ctx.fillRect(0, bankY, W, H - bankY);
  shimmerWater(ctx, bankY, W, H, t, "rgba(255,40,30,ALPHA)", 0.9);
  // the shadow, demonic, where the oath was sworn
  const fx = W * 0.32, fy = bankY;
  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(1.15, 1.15);
  ctx.shadowColor = "#ef4444"; ctx.shadowBlur = 16;
  ctx.strokeStyle = "#0a0204"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(-6, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(6, 0); ctx.stroke();
  ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(0, -70); ctx.stroke();
  ctx.fillStyle = "#0a0204"; ctx.beginPath(); ctx.arc(0, -78, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(239,68,68,0.95)"; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(-5, -82); ctx.lineTo(-10, -94); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(5, -82); ctx.lineTo(10, -94); ctx.stroke();
  ctx.fillStyle = "rgba(255,70,40,0.98)";
  ctx.fillRect(-3.5, -79, 2.2, 1.8); ctx.fillRect(1.3, -79, 2.2, 1.8);
  ctx.restore();
  emberDrift(ctx, t, W, H, 40, true);
}
