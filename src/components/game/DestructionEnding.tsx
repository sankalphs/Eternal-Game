"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { coverScale } from "@/lib/game/canvas-utils";

// The villain's victory screen. When the player (the Shadow) cuts down all
// eight heroes, the world ends in fire. An animated apocalypse plays out on
// a canvas while an epilogue narration types out line-by-line; once it
// finishes, the "THE WORLD BURNS" title types in and the player is offered
// a chance to reign again or return to the riverbank.

const EPILOGUE_LINES = [
  "The last hero falls.",
  "The final seal is yours.",
  "The Gates of Shadow swing wide — and cannot close again.",
  "The rivers run red with the ash of the world you once knew.",
  "The villages that once cheered the heroes are silence now.",
  "The temples are broken. The banners are ash.",
  "No apprentices rise. No defectors turn. No masters wait.",
  "The stars themselves grow dim above your shadow.",
  "You stand atop the ruined gate where the oath was sworn,",
  "wearing a crown of embers, a cloak of night.",
  "There is no one left to cage you.",
  "The world is yours to end. And so — it ends.",
];

const TITLE_TEXT = "THE WORLD BURNS";

const LINE_DURATION = 2.4; // seconds per epilogue line
const EPILOGUE_DURATION = LINE_DURATION * EPILOGUE_LINES.length; // 28.8s
const TITLE_DURATION = 3.0; // seconds for the title to type + hold

export default function DestructionEnding({
  maxCombo,
  onRestart,
  onMenu,
}: {
  maxCombo: number;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const [time, setTime] = useState(0);
  const startRef = useRef<number>(0);

  // typed-line derivation for the epilogue
  const epilogue = useMemo(() => {
    const elapsed = Math.min(time, EPILOGUE_DURATION);
    const per = LINE_DURATION;
    const visible = Math.min(EPILOGUE_LINES.length, Math.floor(elapsed / per) + 1);
    const shown: string[] = [];
    for (let i = 0; i < visible; i++) {
      if (i < visible - 1) shown.push(EPILOGUE_LINES[i]);
      else {
        const lineElapsed = elapsed - i * per;
        const chars = Math.max(
          0,
          Math.min(
            EPILOGUE_LINES[i].length,
            Math.floor((lineElapsed / per) * EPILOGUE_LINES[i].length),
          ),
        );
        shown.push(EPILOGUE_LINES[i].slice(0, chars));
      }
    }
    return shown;
  }, [time]);

  const epilogueDone = time >= EPILOGUE_DURATION;

  // typed title (starts after the epilogue)
  const titleText = useMemo(() => {
    if (!epilogueDone) return "";
    const t = time - EPILOGUE_DURATION;
    const chars = Math.max(
      0,
      Math.min(TITLE_TEXT.length, Math.floor((t / 1.8) * TITLE_TEXT.length)),
    );
    return TITLE_TEXT.slice(0, chars);
  }, [time, epilogueDone]);
  const showButtons = time >= EPILOGUE_DURATION + TITLE_DURATION * 0.85;

  // ---- canvas apocalypse animation ----
  useEffect(() => {
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

    startRef.current = performance.now();
    const loop = (now: number) => {
      const t = (now - startRef.current) / 1000;
      setTime(t);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sx = canvas.width / W;
      ctx.setTransform(sx, 0, 0, sx, 0, 0);
      drawApocalypse(ctx, t, W, H);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <canvas ref={canvasRef} className="block" />

      {/* epilogue narration — typed line by line, centered low on screen */}
      {!epilogueDone && (
        <div className="absolute inset-0 z-20 flex items-end justify-center pb-24 sm:pb-32 pointer-events-none">
          <div className="max-w-2xl mx-auto px-6 text-center">
            {epilogue.map((line, i) => (
              <p
                key={i}
                className="text-amber-100/90 text-base sm:text-xl leading-relaxed font-serif italic"
                style={{
                  textShadow: "0 2px 8px rgba(0,0,0,0.95), 0 0 18px rgba(180,30,10,0.5)",
                  marginBottom: "0.4rem",
                  opacity: i === epilogue.length - 1 ? 1 : 0.7,
                }}
              >
                {line}
                {i === epilogue.length - 1 && line.length < EPILOGUE_LINES[i].length && (
                  <span className="animate-pulse">▌</span>
                )}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* THE WORLD BURNS — title types out after epilogue */}
      {epilogueDone && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
          <h1
            className="font-black tracking-tight text-center px-4"
            style={{
              fontSize: "clamp(2.5rem, 10vw, 7rem)",
              color: "#fef3c7",
              textShadow:
                "0 0 40px rgba(220,40,10,0.9), 0 0 80px rgba(180,30,10,0.7), 0 4px 16px rgba(0,0,0,0.9)",
            }}
          >
            {titleText}
            {titleText.length < TITLE_TEXT.length && (
              <span className="animate-pulse">▌</span>
            )}
          </h1>
          <p
            className="mt-4 text-rose-300/80 text-sm sm:text-base tracking-[0.3em] uppercase"
            style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
          >
            The Shadow Reigns Supreme
          </p>
          {maxCombo > 0 && (
            <p className="mt-3 text-amber-400/70 text-xs tracking-wide">
              Largest combo: {maxCombo} hits
            </p>
          )}

          {/* buttons fade in after the title settles */}
          {showButtons && (
            <div className="mt-10 flex flex-wrap gap-4 justify-center pointer-events-auto">
              <button
                type="button"
                onClick={onRestart}
                className="px-8 py-3 rounded-full bg-gradient-to-r from-rose-700 via-red-600 to-rose-900 text-white font-black tracking-widest text-lg hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-rose-900/60 border border-rose-500/30"
              >
                REIGN AGAIN
              </button>
              <button
                type="button"
                onClick={onMenu}
                className="px-7 py-3 rounded-full border border-white/20 text-white font-bold tracking-wide hover:bg-white/10 active:scale-95 transition"
              >
                RETURN
              </button>
            </div>
          )}
        </div>
      )}

      {/* skip button — let the player jump straight to the title/buttons */}
      {!showButtons && (
        <button
          type="button"
          onClick={() => setTime(EPILOGUE_DURATION + TITLE_DURATION)}
          className="absolute bottom-4 right-4 z-30 text-[10px] tracking-[0.3em] text-white/40 hover:text-white/80 transition-colors"
        >
          SKIP ▶
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apocalypse canvas: blood-red sky, crumbling mountains, burning villages in
// the midground, the shadow standing triumphant in the foreground. Embers
// drift up continuously; lightning flashes occasionally.
// ---------------------------------------------------------------------------

function drawApocalypse(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  // ---- sky: deep blood-red gradient darkening to black at the top ----
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#1a0202");
  sky.addColorStop(0.35, "#3d0606");
  sky.addColorStop(0.6, "#7a0e0a");
  sky.addColorStop(0.85, "#c2410c");
  sky.addColorStop(1, "#fbbf24");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // ---- flickering sun: a bleeding red orb low on the horizon ----
  const sunY = H * 0.62 + Math.sin(t * 1.2) * 2;
  const sunR = 90;
  const sunGrad = ctx.createRadialGradient(W * 0.5, sunY, 4, W * 0.5, sunY, sunR * 2.4);
  sunGrad.addColorStop(0, "rgba(255,180,80,0.95)");
  sunGrad.addColorStop(0.3, "rgba(220,60,20,0.85)");
  sunGrad.addColorStop(1, "rgba(80,0,0,0)");
  ctx.fillStyle = sunGrad;
  ctx.beginPath();
  ctx.arc(W * 0.5, sunY, sunR * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // ---- occasional lightning flashes ----
  const flashSeed = Math.sin(t * 0.7) + Math.sin(t * 2.3);
  if (flashSeed > 1.7) {
    ctx.fillStyle = `rgba(255,210,180,${Math.min(0.3, (flashSeed - 1.7) * 0.5)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- distant crumbling mountains (silhouettes with broken peaks) ----
  drawCrumblingMountains(ctx, t, W, H);

  // ---- midground: burning villages (silhouettes with window-glow + flames) ----
  drawBurningVillages(ctx, t, W, H);

  // ---- ground: scorched earth with ember glow at the horizon ----
  const ground = ctx.createLinearGradient(0, H * 0.78, 0, H);
  ground.addColorStop(0, "#2a0606");
  ground.addColorStop(0.4, "#1a0303");
  ground.addColorStop(1, "#000000");
  ctx.fillStyle = ground;
  ctx.fillRect(0, H * 0.78, W, H * 0.22);

  // ---- the shadow: standing triumphant in the foreground ----
  drawTriumphantShadow(ctx, t, W, H);

  // ---- rising embers (continuous particle field) ----
  drawEmbers(ctx, t, W, H);

  // ---- smoke plumes drifting across the sky ----
  drawSmoke(ctx, t, W, H);

  // ---- vignette ----
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

function drawCrumblingMountains(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  // Two layers of jagged mountains with broken peaks. Slight parallax sway.
  const layers = [
    { y: H * 0.55, color: "#1a0a08", amp: 70, seed: 1.0, sway: 1.5 },
    { y: H * 0.62, color: "#0d0403", amp: 50, seed: 2.3, sway: 1.0 },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, L.y);
    const segments = 14;
    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * W;
      // pseudo-random peak height with occasional broken/notched peaks
      const h = Math.sin(i * L.seed * 1.7) * L.amp + Math.cos(i * L.seed * 2.3) * L.amp * 0.5;
      const broken = (i * 7 + Math.floor(L.seed * 10)) % 5 === 0;
      const y = L.y - Math.abs(h) * (broken ? 0.45 : 1) + Math.sin(t * 0.1 + i) * L.sway;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBurningVillages(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  // Several small silhouetted huts with glowing windows and licking flames.
  const baseline = H * 0.78;
  const huts = [
    { x: 90, w: 50, h: 32 },
    { x: 175, w: 60, h: 38 },
    { x: 280, w: 45, h: 28 },
    { x: 700, w: 55, h: 34 },
    { x: 800, w: 65, h: 42 },
    { x: 880, w: 48, h: 30 },
  ];
  for (const hut of huts) {
    // hut silhouette
    ctx.fillStyle = "#080201";
    ctx.fillRect(hut.x, baseline - hut.h, hut.w, hut.h);
    // pitched roof
    ctx.beginPath();
    ctx.moveTo(hut.x - 4, baseline - hut.h);
    ctx.lineTo(hut.x + hut.w / 2, baseline - hut.h - 18);
    ctx.lineTo(hut.x + hut.w + 4, baseline - hut.h);
    ctx.closePath();
    ctx.fill();
    // glowing window (flicker)
    const flicker = 0.6 + Math.sin(t * 12 + hut.x) * 0.2 + Math.random() * 0.2;
    ctx.fillStyle = `rgba(255,${Math.floor(140 + 60 * flicker)},40,${0.7 * flicker})`;
    ctx.fillRect(hut.x + hut.w * 0.35, baseline - hut.h * 0.6, hut.w * 0.3, hut.h * 0.35);
    // licking flames above the roof
    for (let i = 0; i < 3; i++) {
      const fx = hut.x + hut.w * (0.25 + i * 0.25);
      const fh = 14 + Math.sin(t * 8 + hut.x + i) * 6 + Math.random() * 4;
      const fg = ctx.createLinearGradient(fx, baseline - hut.h - 18, fx, baseline - hut.h - 18 - fh);
      fg.addColorStop(0, "rgba(255,180,40,0.85)");
      fg.addColorStop(1, "rgba(180,20,10,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(fx - 5, baseline - hut.h - 18);
      ctx.quadraticCurveTo(fx, baseline - hut.h - 18 - fh, fx + 5, baseline - hut.h - 18);
      ctx.closePath();
      ctx.fill();
    }
  }
  // smoke columns rising from the village band
  for (let i = 0; i < 4; i++) {
    const x = 100 + i * 220 + Math.sin(t * 0.3 + i) * 20;
    const sg = ctx.createLinearGradient(x, baseline - 60, x, baseline - 200);
    sg.addColorStop(0, "rgba(40,20,15,0.6)");
    sg.addColorStop(1, "rgba(20,10,8,0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(x, baseline - 130, 22, 70, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTriumphantShadow(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  // A tall black silhouette standing center-foreground, shoulders back, head
  // high. A faint dark-red rim light pulses along its outline.
  const cx = W * 0.5;
  const groundY = H * 0.95;
  const headR = 14;
  const torsoTop = groundY - 150;
  const torsoBot = groundY - 60;
  const shoulderW = 38;

  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 4, 60, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // pulsing aura behind the shadow
  const auraPulse = 0.6 + Math.sin(t * 2) * 0.15;
  const aura = ctx.createRadialGradient(cx, (torsoTop + groundY) / 2, 10, cx, (torsoTop + groundY) / 2, 120);
  aura.addColorStop(0, `rgba(180,30,20,${0.35 * auraPulse})`);
  aura.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.ellipse(cx, (torsoTop + groundY) / 2, 80, 130, 0, 0, Math.PI * 2);
  ctx.fill();

  // body (pure black)
  ctx.fillStyle = "#000";
  // legs
  ctx.fillRect(cx - 12, torsoBot, 10, groundY - torsoBot);
  ctx.fillRect(cx + 2, torsoBot, 10, groundY - torsoBot);
  // torso (tapered)
  ctx.beginPath();
  ctx.moveTo(cx - shoulderW, torsoTop + 6);
  ctx.lineTo(cx + shoulderW, torsoTop + 6);
  ctx.lineTo(cx + 14, torsoBot);
  ctx.lineTo(cx - 14, torsoBot);
  ctx.closePath();
  ctx.fill();
  // shoulders
  ctx.beginPath();
  ctx.arc(cx - shoulderW, torsoTop + 8, 8, 0, Math.PI * 2);
  ctx.arc(cx + shoulderW, torsoTop + 8, 8, 0, Math.PI * 2);
  ctx.fill();
  // arms — slightly raised, hands outward (triumphant)
  ctx.lineWidth = 9;
  ctx.strokeStyle = "#000";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - shoulderW + 2, torsoTop + 10);
  ctx.lineTo(cx - shoulderW - 18, torsoTop + 30);
  ctx.lineTo(cx - shoulderW - 24, torsoTop + 60);
  ctx.moveTo(cx + shoulderW - 2, torsoTop + 10);
  ctx.lineTo(cx + shoulderW + 18, torsoTop + 30);
  ctx.lineTo(cx + shoulderW + 24, torsoTop + 60);
  ctx.stroke();
  // head
  ctx.beginPath();
  ctx.arc(cx, torsoTop - headR + 2, headR, 0, Math.PI * 2);
  ctx.fill();

  // crimson rim light along the right edge
  ctx.strokeStyle = `rgba(220,40,30,${0.6 + Math.sin(t * 2) * 0.15})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx + shoulderW + 4, torsoTop + 10);
  ctx.lineTo(cx + 16, torsoBot);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, torsoTop - headR + 2, headR + 1, -Math.PI * 0.3, Math.PI * 0.3);
  ctx.stroke();
}

// --- ember particle field -------------------------------------------------
const EMBERS: { x: number; y: number; vy: number; vx: number; size: number; life: number }[] = [];
function drawEmbers(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  // spawn a few new embers each frame
  if (EMBERS.length < 180) {
    for (let i = 0; i < 3; i++) {
      EMBERS.push({
        x: Math.random() * W,
        y: H * 0.78 + Math.random() * 20,
        vy: -20 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 12,
        size: 1 + Math.random() * 2,
        life: 0,
      });
    }
  }
  for (let i = EMBERS.length - 1; i >= 0; i--) {
    const e = EMBERS[i];
    e.life += 0.016;
    e.x += e.vx * 0.016 + Math.sin(t + e.y * 0.01) * 0.3;
    e.y += e.vy * 0.016;
    e.vy *= 0.995;
    if (e.y < 0 || e.life > 6) {
      EMBERS.splice(i, 1);
      continue;
    }
    const fade = Math.max(0, 1 - e.life / 6);
    ctx.fillStyle = `rgba(255,${120 + Math.floor(80 * fade)},20,${0.85 * fade})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSmoke(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  // broad drifting smoke bands across the upper sky
  for (let i = 0; i < 3; i++) {
    const y = H * 0.25 + i * 40 + Math.sin(t * 0.2 + i) * 8;
    const x = ((t * 18 + i * 320) % (W + 400)) - 200;
    const g = ctx.createRadialGradient(x, y, 10, x, y, 180);
    g.addColorStop(0, "rgba(30,15,12,0.55)");
    g.addColorStop(1, "rgba(20,10,8,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, 180, 36, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
