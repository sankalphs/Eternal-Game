// Rendering: themed arena backgrounds, articulated shadow fighters with
// ground shadows / motion blur / blade glints, particles, floating text.
// Draws in a virtual 960x540 space; the component sets the transform to fit.

import { Fighter, GROUND_Y, STAGE_LEFT, STAGE_RIGHT } from "./fighter";
import type { GameEngine } from "./engine";
import type { BackgroundId } from "./types";
import { ACTIVE_WINDOW } from "./poses";
import { ridge } from "./canvas-utils";

export const VIRTUAL_W = 960;
export const VIRTUAL_H = 540;

// limb dimensions — base Da Vinci proportions, scaled per body type
const BASE = { headR: 12.5, neck: 9, torso: 46, uarm: 27, farm: 25, thigh: 40, shin: 38 };

interface BodyProps {
  headR: number; neck: number; torso: number;
  uarm: number; farm: number; thigh: number; shin: number;
  wTorso: number; wArm: number; wLeg: number; extraLean: number;
}

function getBodyProps(bodyType: string): BodyProps {
  const b = BASE;
  switch (bodyType) {
    case "bulky":
      return { ...b, headR: b.headR * 1.15, torso: b.torso * 0.9, thigh: b.thigh * 0.85, shin: b.shin * 0.85,
        wTorso: 1.35, wArm: 1.3, wLeg: 1.25, extraLean: 0.05 };
    case "tall":
      return { ...b, headR: b.headR * 0.95, torso: b.torso * 1.12, thigh: b.thigh * 1.2, shin: b.shin * 1.18,
        uarm: b.uarm * 1.1, farm: b.farm * 1.1, wTorso: 0.85, wArm: 0.85, wLeg: 0.9, extraLean: 0 };
    case "hunched":
      return { ...b, torso: b.torso * 0.88, thigh: b.thigh * 0.92, shin: b.shin * 0.9,
        wTorso: 1.1, wArm: 0.95, wLeg: 0.95, extraLean: 0.2 };
    default:
      return { ...b, wTorso: 1.0, wArm: 1.0, wLeg: 1.0, extraLean: 0 };
  }
}

function polar(len: number, a: number): [number, number] {
  return [len * Math.sin(a), len * Math.cos(a)];
}

interface Joints {
  hip: [number, number];
  chest: [number, number];
  head: [number, number];
  bShoulder: [number, number];
  fShoulder: [number, number];
  bElbow: [number, number];
  bHand: [number, number];
  fElbow: [number, number];
  fHand: [number, number];
  bKnee: [number, number];
  bFoot: [number, number];
  fKnee: [number, number];
  fFoot: [number, number];
  props: BodyProps;
}

function computeJoints(f: Fighter): Joints {
  const p = f.pose();
  const props = getBodyProps(f.bodyType);
  const lean = p.torsoLean + props.extraLean;
  const LEG = props.thigh + props.shin;
  const hipY = f.y - LEG + p.hipDrop;
  const hip: [number, number] = [0, hipY];
  const chest = [hip[0] + polar(props.torso, Math.PI - lean)[0], hip[1] + polar(props.torso, Math.PI - lean)[1]];
  const headAng = Math.PI - lean - p.headTilt;
  const head = [
    chest[0] + polar(props.neck + props.headR, headAng)[0],
    chest[1] + polar(props.neck + props.headR, headAng)[1],
  ];
  const sw = 6 * props.wTorso;
  const bShoulder: [number, number] = [chest[0] - sw, chest[1] + 2];
  const fShoulder: [number, number] = [chest[0] + sw, chest[1] + 2];
  const bElbow = [bShoulder[0] + polar(props.uarm, p.bArm)[0], bShoulder[1] + polar(props.uarm, p.bArm)[1]];
  const bHand = [bElbow[0] + polar(props.farm, p.bFore)[0], bElbow[1] + polar(props.farm, p.bFore)[1]];
  const fElbow = [fShoulder[0] + polar(props.uarm, p.fArm)[0], fShoulder[1] + polar(props.uarm, p.fArm)[1]];
  const fHand = [fElbow[0] + polar(props.farm, p.fFore)[0], fElbow[1] + polar(props.farm, p.fFore)[1]];
  const bKnee = [hip[0] + polar(props.thigh, p.bThigh)[0], hip[1] + polar(props.thigh, p.bThigh)[1]];
  const bFoot = [bKnee[0] + polar(props.shin, p.bShin)[0], bKnee[1] + polar(props.shin, p.bShin)[1]];
  const fKnee = [hip[0] + polar(props.thigh, p.fThigh)[0], hip[1] + polar(props.thigh, p.fThigh)[1]];
  const fFoot = [fKnee[0] + polar(props.shin, p.fShin)[0], fKnee[1] + polar(props.shin, p.fShin)[1]];
  return { hip, chest, head, bShoulder, fShoulder, bElbow, bHand, fElbow, fHand, bKnee, bFoot, fKnee, fFoot, props };
}

export function render(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  const bg: BackgroundId = eng.scene;
  drawScene(ctx, eng, bg);
  drawDirectorAtmosphere(ctx, eng);

  // ground contact shadows (drawn on the ground, behind fighters)
  drawGroundShadow(ctx, eng.player);
  drawGroundShadow(ctx, eng.enemy);

  // energy auras behind fighters (attacking / low HP glow)
  drawAura(ctx, eng.player);
  drawAura(ctx, eng.enemy);

  // draw fighters back-to-front
  const order = [eng.player, eng.enemy].sort((a, b) => a.x - b.x);
  for (const f of order) drawFighter(ctx, f);

  drawShockwaves(ctx, eng);
  drawParticles(ctx, eng);
  drawFloatingText(ctx, eng);
  drawVignette(ctx);

  // Director lighting overlay: a multiplicative tint applied AFTER the
  // scene so it colors the whole fight without re-rendering anything.
  // The tint and intensity are sourced from eng.directorState.lighting.
  const lighting = eng.directorState?.lighting;
  if (lighting && lighting.tint && lighting.intensity > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    // `intensity` means strength of the chosen lighting, not remaining
    // brightness. The old inverse made the strongest plans invisible.
    ctx.globalAlpha = 0.12 + Math.max(0, Math.min(1, lighting.intensity)) * 0.2;
    ctx.fillStyle = lighting.tint;
    ctx.fillRect(-2000, -2000, VIRTUAL_W + 4000, VIRTUAL_H + 4000);
    ctx.restore();
  }

  // Director darkness overlay: an extra radial vignette proportional
  // to hazards.darkness. Adds claustrophobia to the defiance intent.
  const darkness = eng.directorState?.hazards?.darkness ?? 0;
  if (darkness > 0) {
    const cx = VIRTUAL_W / 2;
    const cy = VIRTUAL_H / 2;
    const grad = ctx.createRadialGradient(
      cx, cy, 60,
      cx, cy, 720,
    );
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, darkness)})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(-2000, -2000, VIRTUAL_W + 4000, VIRTUAL_H + 4000);
    ctx.restore();
  }
}

function drawDirectorAtmosphere(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  const w = eng.directorState?.weather;
  if (!w || w.type === "none") return;
  const t = eng.time;
  ctx.save();
  if (w.type === "rain") {
    ctx.strokeStyle = w.color; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.75;
    for (let i = 0; i < 65; i++) {
      const x = (i * 83 + t * 130) % (VIRTUAL_W + 100) - 50;
      const y = (i * 47 + t * 420) % (VIRTUAL_H + 100) - 50;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 8, y + 24); ctx.stroke();
    }
  } else if (w.type === "fog" || w.type === "shadow") {
    ctx.globalAlpha = w.type === "shadow" ? 0.28 : 0.2;
    for (let i = 0; i < 4; i++) {
      const x = ((i * 290 + t * (12 + i * 3)) % 1250) - 160;
      const g = ctx.createRadialGradient(x, 330, 15, x, 330, 210);
      g.addColorStop(0, w.color); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(x - 230, 100, 460, 380);
    }
  } else {
    // A subtle full-stage atmosphere makes ash/embers/dust/petals legible
    // even before enough particles have accumulated.
    const g = ctx.createLinearGradient(0, 0, 0, VIRTUAL_H);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, w.color);
    ctx.globalAlpha = 0.1; ctx.fillStyle = g; ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- backgrounds

function drawScene(ctx: CanvasRenderingContext2D, eng: GameEngine, bg: BackgroundId) {
  switch (bg) {
    case "sunset":
      drawSunset(ctx, eng);
      break;
    case "desert":
      drawDesert(ctx, eng);
      break;
    case "temple":
      drawTemple(ctx, eng);
      break;
    case "bamboo":
      drawBamboo(ctx, eng);
      break;
    case "moon":
      drawMoon(ctx, eng);
      break;
    case "volcano":
      drawVolcano(ctx, eng);
      break;
    case "snow":
      drawSnow(ctx, eng);
      break;
    default:
      drawSunset(ctx, eng);
  }
}

// shared ground drawer with theme colors
function drawGround(ctx: CanvasRenderingContext2D, top: string, bottom: string, horizon: string) {
  const g = ctx.createLinearGradient(0, GROUND_Y, 0, VIRTUAL_H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND_Y, VIRTUAL_W, VIRTUAL_H - GROUND_Y);

  ctx.strokeStyle = horizon;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(VIRTUAL_W, GROUND_Y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = STAGE_LEFT; x <= STAGE_RIGHT; x += 44) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y + 2);
    ctx.lineTo(x, GROUND_Y + 9);
    ctx.stroke();
  }
}

// silhouette ridge lives in canvas-utils.ts (imported above) — call sites
// use the shared ridge(ctx, pts, baseY, color) signature.

function drawSunset(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#1a1030");
  sky.addColorStop(0.4, "#3b1d4f");
  sky.addColorStop(0.7, "#8a2f4a");
  sky.addColorStop(0.88, "#e0673a");
  sky.addColorStop(1, "#f5b942");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

  const sunX = VIRTUAL_W * 0.5;
  const sunY = GROUND_Y - 36;
  const glow = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 230);
  glow.addColorStop(0, "rgba(255,236,170,0.95)");
  glow.addColorStop(0.3, "rgba(255,180,90,0.5)");
  glow.addColorStop(1, "rgba(255,120,60,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  ctx.fillStyle = "rgba(255,247,214,0.98)";
  ctx.beginPath();
  ctx.arc(sunX, sunY, 48, 0, Math.PI * 2);
  ctx.fill();

  ridge(ctx, [0, 70, 150, 110, 300, 70, 460, 120, 620, 80, 780, 120, 960, 90], GROUND_Y, "rgba(40,20,50,0.5)");
  ridge(ctx, [0, 40, 120, 80, 260, 45, 420, 90, 560, 50, 720, 95, 880, 55, 960, 70], GROUND_Y, "rgba(18,9,26,0.8)");
  embers(ctx, eng, "rgba(255,200,120,", 24);
  drawGround(ctx, "#0a0608", "#000", "rgba(255,160,90,0.8)");
}

function drawDesert(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#3a2410");
  sky.addColorStop(0.45, "#7a4a1c");
  sky.addColorStop(0.8, "#d98a3a");
  sky.addColorStop(1, "#f2c878");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

  // low sun
  const sx = VIRTUAL_W * 0.62;
  const sy = GROUND_Y - 60;
  const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 240);
  glow.addColorStop(0, "rgba(255,240,200,0.9)");
  glow.addColorStop(0.4, "rgba(255,180,80,0.4)");
  glow.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  ctx.fillStyle = "rgba(255,235,180,0.95)";
  ctx.beginPath();
  ctx.arc(sx, sy, 40, 0, Math.PI * 2);
  ctx.fill();

  // distant ruined pillars
  ctx.fillStyle = "rgba(60,38,20,0.5)";
  for (const px of [120, 250, 720, 850]) {
    ctx.fillRect(px, GROUND_Y - 120, 16, 120);
    ctx.fillRect(px - 4, GROUND_Y - 128, 24, 8);
  }
  // dunes
  ridge(ctx, [0, 30, 200, 70, 420, 30, 640, 80, 860, 40, 960, 60], GROUND_Y, "rgba(80,50,24,0.55)");
  ridge(ctx, [0, 20, 160, 50, 380, 24, 600, 60, 820, 30, 960, 44], GROUND_Y, "rgba(40,24,12,0.8)");
  embers(ctx, eng, "rgba(255,220,150,", 16, "sand");
  drawGround(ctx, "#1c1206", "#000", "rgba(255,170,80,0.7)");
}

function drawTemple(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#1a1430");
  sky.addColorStop(0.5, "#3a2a55");
  sky.addColorStop(0.85, "#6b3f6a");
  sky.addColorStop(1, "#a04a64");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

  // hanging lanterns glow
  for (const lx of [180, 480, 780]) {
    const ly = GROUND_Y - 230 + Math.sin(eng.time * 0.8 + lx) * 4;
    const g = ctx.createRadialGradient(lx, ly, 4, lx, ly, 60);
    g.addColorStop(0, "rgba(255,180,80,0.85)");
    g.addColorStop(1, "rgba(255,140,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    ctx.fillStyle = "rgba(255,210,140,0.95)";
    ctx.beginPath();
    ctx.arc(lx, ly, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // pagoda silhouettes
  ctx.fillStyle = "rgba(20,12,28,0.85)";
  pagoda(ctx, 130, GROUND_Y, 70);
  pagoda(ctx, 820, GROUND_Y, 80);
  ridge(ctx, [0, 30, 300, 60, 600, 30, 960, 55], GROUND_Y, "rgba(12,8,20,0.9)");
  petals(ctx, eng, "rgba(255,170,200,");
  drawGround(ctx, "#0c0814", "#000", "rgba(180,120,200,0.5)");
}

function pagoda(ctx: CanvasRenderingContext2D, x: number, baseY: number, h: number) {
  ctx.save();
  ctx.translate(x, baseY);
  // tiers
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const ty = -h + (i * h) / tiers;
    const tw = 26 - i * 5;
    ctx.fillRect(-tw, ty, tw * 2, h / tiers - 4);
    // roof
    ctx.beginPath();
    ctx.moveTo(-tw - 8, ty);
    ctx.lineTo(0, ty - 14);
    ctx.lineTo(tw + 8, ty);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBamboo(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#0c1a14");
  sky.addColorStop(0.5, "#143026");
  sky.addColorStop(0.85, "#1f4a36");
  sky.addColorStop(1, "#3a6b4a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

  // soft mist
  const mist = ctx.createLinearGradient(0, GROUND_Y - 160, 0, GROUND_Y);
  mist.addColorStop(0, "rgba(120,180,150,0)");
  mist.addColorStop(1, "rgba(120,180,150,0.18)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, GROUND_Y - 160, VIRTUAL_W, 160);

  // bamboo stalks (foreground)
  ctx.strokeStyle = "rgba(8,18,12,0.92)";
  ctx.lineCap = "round";
  for (const bx of [60, 130, 880, 920]) {
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(bx, GROUND_Y);
    ctx.lineTo(bx + Math.sin(bx) * 8, GROUND_Y - 320);
    ctx.stroke();
    // nodes
    for (let n = 1; n < 7; n++) {
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(bx - 6, GROUND_Y - n * 44);
      ctx.lineTo(bx + 6, GROUND_Y - n * 44);
      ctx.stroke();
    }
  }
  // distant ridges
  ridge(ctx, [0, 40, 220, 90, 460, 50, 700, 100, 960, 60], GROUND_Y, "rgba(10,28,20,0.7)");
  fireflies(ctx, eng);
  drawGround(ctx, "#08120c", "#000", "rgba(120,200,150,0.5)");
}

function drawMoon(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#060814");
  sky.addColorStop(0.5, "#0c1430");
  sky.addColorStop(0.85, "#1a2a50");
  sky.addColorStop(1, "#2a3a66");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

  // stars
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (let i = 0; i < 60; i++) {
    const sx = (i * 71.3) % VIRTUAL_W;
    const sy = (i * 53.7) % (GROUND_Y - 120);
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(eng.time * 2 + i));
    ctx.globalAlpha = tw;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  // moon
  const mx = VIRTUAL_W * 0.74;
  const my = 120;
  const mg = ctx.createRadialGradient(mx, my, 10, mx, my, 120);
  mg.addColorStop(0, "rgba(220,230,255,0.9)");
  mg.addColorStop(0.4, "rgba(180,200,240,0.35)");
  mg.addColorStop(1, "rgba(140,160,220,0)");
  ctx.fillStyle = mg;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  ctx.fillStyle = "rgba(235,240,255,0.97)";
  ctx.beginPath();
  ctx.arc(mx, my, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(180,195,230,0.5)";
  ctx.beginPath();
  ctx.arc(mx - 12, my - 6, 7, 0, Math.PI * 2);
  ctx.arc(mx + 10, my + 12, 5, 0, Math.PI * 2);
  ctx.fill();

  ridge(ctx, [0, 60, 200, 120, 380, 70, 560, 140, 760, 80, 960, 110], GROUND_Y, "rgba(10,16,36,0.6)");
  ridge(ctx, [0, 36, 180, 80, 360, 44, 540, 90, 740, 50, 960, 70], GROUND_Y, "rgba(6,10,24,0.85)");
  petals(ctx, eng, "rgba(230,210,255,");
  drawGround(ctx, "#05080f", "#000", "rgba(150,170,230,0.5)");
}

function drawVolcano(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#1a0606");
  sky.addColorStop(0.4, "#3a0d0a");
  sky.addColorStop(0.8, "#7a1e10");
  sky.addColorStop(1, "#c0421a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

  // lava glow at horizon
  const lava = ctx.createLinearGradient(0, GROUND_Y - 120, 0, GROUND_Y);
  lava.addColorStop(0, "rgba(255,80,20,0)");
  lava.addColorStop(1, "rgba(255,120,30,0.6)");
  ctx.fillStyle = lava;
  ctx.fillRect(0, GROUND_Y - 120, VIRTUAL_W, 120);

  // jagged peaks
  ctx.fillStyle = "rgba(20,6,6,0.8)";
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  const pts = [0, 60, 120, 180, 240, 90, 360, 200, 460, 110, 580, 220, 700, 120, 820, 180, 960, 90];
  for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], GROUND_Y - pts[i + 1]);
  ctx.lineTo(VIRTUAL_W, GROUND_Y);
  ctx.closePath();
  ctx.fill();
  // crater glow
  for (const cx of [360, 580]) {
    const g = ctx.createRadialGradient(cx, GROUND_Y - 200, 4, cx, GROUND_Y - 200, 70);
    g.addColorStop(0, "rgba(255,140,40,0.8)");
    g.addColorStop(1, "rgba(255,80,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  }
  embers(ctx, eng, "rgba(255,120,40,", 34, "ember");
  drawGround(ctx, "#160404", "#000", "rgba(255,90,30,0.85)");
}

function drawSnow(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#0a1422");
  sky.addColorStop(0.5, "#1c2c44");
  sky.addColorStop(0.85, "#3a4a66");
  sky.addColorStop(1, "#6a7a96");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

  // pale sun
  const sx = VIRTUAL_W * 0.3;
  const sy = 110;
  const g = ctx.createRadialGradient(sx, sy, 6, sx, sy, 130);
  g.addColorStop(0, "rgba(220,235,255,0.7)");
  g.addColorStop(1, "rgba(200,220,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

  // pine silhouettes
  ctx.fillStyle = "rgba(10,18,30,0.85)";
  for (const px of [90, 230, 720, 870]) {
    pine(ctx, px, GROUND_Y, 90 + (px % 3) * 16);
  }
  ridge(ctx, [0, 50, 200, 110, 420, 60, 640, 130, 860, 70, 960, 90], GROUND_Y, "rgba(14,24,40,0.7)");
  snow(ctx, eng);
  drawGround(ctx, "#101a2a", "#000", "rgba(200,220,255,0.6)");
}

function pine(ctx: CanvasRenderingContext2D, x: number, baseY: number, h: number) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const ty = -h + (i * h) / 4;
    const tw = 22 - i * 4;
    ctx.moveTo(-tw, ty);
    ctx.lineTo(0, ty - h / 4);
    ctx.lineTo(tw, ty);
    ctx.closePath();
  }
  ctx.fill();
  ctx.fillRect(-3, -h, 6, h);
  ctx.restore();
}

// ambient particle systems
function embers(ctx: CanvasRenderingContext2D, eng: GameEngine, rgb: string, n: number, kind = "ember") {
  ctx.fillStyle = "#fff";
  for (let i = 0; i < n; i++) {
    const seed = i * 37.7;
    const x = (seed * 1.3 + eng.time * (10 + (i % 5) * 4)) % VIRTUAL_W;
    let y = GROUND_Y - ((seed * 0.7) % 360) - (eng.time * (8 + (i % 4) * 3)) % 70;
    y = ((y % 400) + 400) % 400;
    ctx.globalAlpha = 0.3 + 0.4 * Math.abs(Math.sin(eng.time * 1.5 + i));
    ctx.fillStyle = rgb + (kind === "sand" ? "0.5)" : "0.8)");
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function fireflies(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  for (let i = 0; i < 18; i++) {
    const seed = i * 51.7;
    const x = (seed * 1.7 + eng.time * (6 + (i % 3) * 3)) % VIRTUAL_W;
    const y = 120 + ((seed * 0.9) % 300) + Math.sin(eng.time * 1.2 + i) * 16;
    const a = 0.3 + 0.6 * Math.abs(Math.sin(eng.time * 2 + i));
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(190,255,170,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function petals(ctx: CanvasRenderingContext2D, eng: GameEngine, rgb: string) {
  for (let i = 0; i < 22; i++) {
    const seed = i * 43.1;
    const x = (seed * 1.5 + eng.time * (16 + (i % 4) * 6)) % (VIRTUAL_W + 40) - 20;
    const y = ((seed * 0.8 + eng.time * (20 + (i % 3) * 8)) % 460);
    const sw = Math.sin(eng.time * 3 + i) * 12;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = rgb + "0.6)";
    ctx.beginPath();
    ctx.ellipse(x + sw, y, 3, 1.6, eng.time + i, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function snow(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (let i = 0; i < 60; i++) {
    const seed = i * 29.3;
    const x = (seed * 1.7 + Math.sin(eng.time * 0.8 + i) * 22) % VIRTUAL_W;
    const y = ((seed * 0.6 + eng.time * (26 + (i % 4) * 10)) % 480);
    const s = 1 + (i % 3);
    ctx.globalAlpha = 0.4 + 0.5 * ((i % 5) / 5);
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- fighters

function drawGroundShadow(ctx: CanvasRenderingContext2D, f: Fighter) {
  const air = (GROUND_Y - f.y) / 200; // 0 on ground, >0 in air
  const w = 30 * (1 - Math.min(0.6, air));
  const a = 0.45 * (1 - Math.min(0.7, air));
  ctx.save();
  ctx.translate(f.x, GROUND_Y + 2);
  ctx.scale(1, 0.32);
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath();
  ctx.arc(0, 0, w, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// pulsing energy aura: strong when attacking, faint + reddish when low HP.
function drawAura(ctx: CanvasRenderingContext2D, f: Fighter) {
  const attacking = f.isAttacking();
  const lowHp = f.hp > 0 && f.hp / f.maxHp < 0.3;
  if (!attacking && !lowHp) return;
  const cx = f.x;
  const cy = f.y - 95;
  let alpha = 0;
  let color = f.rim;
  if (attacking) {
    alpha = 0.5;
  }
  if (lowHp) {
    alpha = Math.max(alpha, 0.35 + 0.2 * Math.sin(f.stateTime * 8));
    color = "#ef4444";
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(cx, cy, 6, cx, cy, 70);
  g.addColorStop(0, hexA(color, alpha));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// hex color (#rrggbb) -> rgba string with given alpha
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) || 255;
  const g = parseInt(h.substring(2, 4), 16) || 255;
  const b = parseInt(h.substring(4, 6), 16) || 255;
  return `rgba(${r},${g},${b},${a})`;
}

function drawFighter(ctx: CanvasRenderingContext2D, f: Fighter) {
  const j = computeJoints(f);
  const rim = f.rim;
  const fill = "#060606";

  ctx.save();
  ctx.translate(f.x, 0);
  if (f.facing === -1) ctx.scale(-1, 1);
  // acrobatic body rotation (flip jump / roll) around the hip
  if (f.spin) {
    ctx.translate(0, j.hip[1]);
    ctx.rotate(f.spin);
    ctx.translate(0, -j.hip[1]);
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // draw body solid first (no shadow, so segments blend seamlessly)
  ctx.shadowBlur = 0;

  // Tapered limb: a filled capsule that's thicker at the proximal joint (a)
  // and thinner at the distal end (b), giving anatomically correct limbs.
  const taperedLimb = (
    a: [number, number],
    b: [number, number],
    wa: number,
    wb: number,
  ) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len; // perpendicular
    const ny = dx / len;
    ctx.fillStyle = fill;
    ctx.beginPath();
    // start at the side of a, go around a's cap, to the side of b, around b's cap
    ctx.moveTo(a[0] + nx * wa, a[1] + ny * wa);
    ctx.lineTo(b[0] + nx * wb, b[1] + ny * wb);
    ctx.arc(b[0], b[1], wb, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
    ctx.lineTo(a[0] - nx * wa, a[1] - ny * wa);
    ctx.arc(a[0], a[1], wa, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
    ctx.closePath();
    ctx.fill();
  };
  const joint = (p: [number, number], r: number) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fill();
  };

  // body-type-scaled widths
  const wt = j.props.wTorso, wa = j.props.wArm, wl = j.props.wLeg;
  const hr = j.props.headR;

  // back leg
  taperedLimb(j.hip, j.bKnee, 16 * wl, 13 * wl);
  taperedLimb(j.bKnee, j.bFoot, 13 * wl, 9 * wl);
  joint(j.bKnee, 13 * wl);
  foot(ctx, j.bFoot, 10 * wl);
  // back arm
  taperedLimb(j.bShoulder, j.bElbow, 11 * wa, 8 * wa);
  taperedLimb(j.bElbow, j.bHand, 8 * wa, 6 * wa);
  joint(j.bElbow, 8 * wa);
  fist(ctx, j.bHand, 9 * wa);
  // torso
  taperedLimb(j.hip, j.chest, 20 * wt, 14 * wt);
  joint(j.hip, 20 * wt);
  joint(j.chest, 14 * wt);
  // neck
  taperedLimb(j.chest, [j.head[0], j.head[1] + hr - 2], 9, 7);
  // head
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(j.head[0], j.head[1], hr, 0, Math.PI * 2);
  ctx.fill();

  // motion blur on attacking limb during active frames
  const atk = f.currentAttack;
  const [a0, a1] = atk ? ACTIVE_WINDOW[atk] : [0, 0];
  const inActive = f.isAttacking() && atk && f.progress >= a0 && f.progress <= a1;

  // front leg
  if (inActive && (atk === "kick" || atk === "roundhouse")) {
    motionFan(ctx, j.fKnee, j.fFoot, 12, rim);
  }
  taperedLimb(j.hip, j.fKnee, 16 * wl, 13 * wl);
  taperedLimb(j.fKnee, j.fFoot, 13 * wl, 9 * wl);
  joint(j.fKnee, 13 * wl);
  foot(ctx, j.fFoot, 10 * wl);

  // front arm
  if (inActive && atk === "punch") {
    motionFan(ctx, j.fElbow, j.fHand, 8, rim);
  }
  taperedLimb(j.fShoulder, j.fElbow, 11 * wa, 8 * wa);
  taperedLimb(j.fElbow, j.fHand, 8 * wa, 6 * wa);
  joint(j.fElbow, 8 * wa);
  fist(ctx, j.fHand, 9 * wa);

  // blade glint along the striking limb
  if (f.blade && inActive) {
    let a: [number, number];
    let b: [number, number];
    if (atk === "punch") {
      a = j.fElbow;
      b = [j.fHand[0] + 6, j.fHand[1]];
    } else {
      a = j.fKnee;
      b = [j.fFoot[0] + 8, j.fFoot[1] - 2];
    }
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#eaf6ff";
    ctx.strokeStyle = "rgba(230,245,255,0.95)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // rim light: soft glow on the head's back-top edge only
  // — no per-segment strokes (those created fake internal "gaps" at joints).
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(j.head[0] - 1.5, j.head[1] - 1.5, j.props.headR - 1, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

// draw a translucent "fan" of motion copies of a limb segment
function motionFan(
  ctx: CanvasRenderingContext2D,
  a: [number, number],
  b: [number, number],
  w: number,
  rim: string,
) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  ctx.shadowBlur = 0;
  ctx.strokeStyle = rim;
  ctx.lineCap = "round";
  for (let i = 1; i <= 3; i++) {
    const ang = (i * 0.13) * (dx >= 0 ? 1 : -1);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    ctx.globalAlpha = 0.16 - i * 0.03;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(a[0] + rx, a[1] + ry);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function foot(ctx: CanvasRenderingContext2D, foot: [number, number], w: number) {
  ctx.fillStyle = "#060606";
  ctx.beginPath();
  ctx.ellipse(foot[0] + 5, foot[1] - 1, w * 0.85, w * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

// filled fist — a solid circle slightly larger than the forearm taper end so
// the hand reads as a knuckle/fist (no notch where the forearm meets the hand).
function fist(ctx: CanvasRenderingContext2D, p: [number, number], r: number) {
  ctx.fillStyle = "#060606";
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fill();
}

function drawShockwaves(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const s of eng.shockwaves) {
    const t = s.life / s.maxLife;
    const a = t * 0.9;
    // outer glow ring
    ctx.strokeStyle = hexA(s.color, a);
    ctx.lineWidth = s.width * t + 1;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.stroke();
    // inner thin bright ring
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.8})`;
    ctx.lineWidth = Math.max(1, s.width * 0.4 * t);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.shadowBlur = 0;
}

function drawParticles(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  // additive pass for bright energy particles (sparks, streaks, rings)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of eng.particles) {
    const t = p.life / p.maxLife;
    if (p.kind === "ring") {
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = t;
      ctx.lineWidth = 3 * t + 1;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (1 - t) * 40 + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (p.kind === "streak") {
      // elongated energy streak pointing along its velocity
      const len = p.size;
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const ux = p.vx / sp;
      const uy = p.vy / sp;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = t;
      ctx.lineWidth = 2.4 * t + 0.6;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - ux * len, p.y - uy * len);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (p.kind === "spark") {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = t;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.shadowBlur = 0;
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // dust (normal blend, soft)
  for (const p of eng.particles) {
    if (p.kind !== "dust") continue;
    const t = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = t;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFloatingText(ctx: CanvasRenderingContext2D, eng: GameEngine) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const t of eng.texts) {
    const a = Math.min(1, t.life / 0.3);
    ctx.globalAlpha = a;
    ctx.font = `900 ${t.size}px Geist, system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function drawVignette(ctx: CanvasRenderingContext2D) {
  const v = ctx.createRadialGradient(
    VIRTUAL_W / 2,
    VIRTUAL_H / 2,
    200,
    VIRTUAL_W / 2,
    VIRTUAL_H / 2,
    620,
  );
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
}
