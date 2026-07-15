// Pose definitions and keyframe animation for shadow fighters.
// All angles in radians. Convention: 0 = straight down, positive = toward
// the fighter's front. Local space always faces right (mirrored at draw).

import type { Pose } from "./types";

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

// Base fighting guard — realistic martial-arts stance: weight slightly back,
// hands up guarding the face, knees bent, slight forward lean, feet staggered.
export const BASE: Pose = {
  torsoLean: 0.11, // slight forward lean from the hips (engaged core)
  headTilt: 0.06, // chin tucked slightly
  hipDrop: 4, // knees bent (athletic, not locked)
  bArm: -0.42, // back hand up guarding
  bFore: 2.35,
  fArm: 0.46, // lead hand up, slightly forward
  fFore: 2.25,
  bThigh: -0.2, // back leg stance
  bShin: -0.14,
  fThigh: 0.2, // lead leg forward
  fShin: 0.14,
};

function withBase(partial: Partial<Pose>): Pose {
  return { ...BASE, ...partial };
}

// smoothstep easing for natural acceleration/deceleration (ease-in/out)
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

// Keyframe interpolation over a list of [progress, partialPose].
// Uses smoothstep easing between frames for organic motion.
function kf(
  frames: [number, Partial<Pose>][],
  p: number,
  base: Pose = BASE,
): Pose {
  if (p <= frames[0][0]) return withBase(frames[0][1]);
  for (let i = 0; i < frames.length - 1; i++) {
    const [p0, f0] = frames[i];
    const [p1, f1] = frames[i + 1];
    if (p <= p1) {
      const t = ease((p - p0) / (p1 - p0 || 1));
      const poseA = withBase(f0);
      const poseB = withBase(f1);
      const out: Pose = { ...poseA };
      (Object.keys(poseB) as (keyof Pose)[]).forEach((k) => {
        out[k] = lerp(poseA[k], poseB[k], t);
      });
      return out;
    }
  }
  return withBase(frames[frames.length - 1][1]);
}

export interface PoseCtx {
  state: string;
  p: number; // normalized progress 0..1 for finite states
  time: number; // seconds in state (for procedural loops)
  walkPhase: number;
  crouchAmt: number; // 0..1 how crouched
  airTuck: number; // 0..1 flip-jump tuck (peaks at apex)
}

// Returns the pose for the current state. Procedural for idle/walk/crouch;
// keyframed for attacks/block/hit/knockdown.
export function poseFor(c: PoseCtx): Pose {
  switch (c.state) {
    case "idle": {
      // subtle weight shift + breathing: hips bob, shoulders counter-rotate
      const breathe = Math.sin(c.time * 2.0);
      const shift = Math.sin(c.time * 0.7) * 0.5; // slow weight transfer
      return {
        ...BASE,
        hipDrop: BASE.hipDrop + breathe * 0.8,
        torsoLean: BASE.torsoLean + breathe * 0.015,
        headTilt: BASE.headTilt + breathe * 0.01,
        // weight shifts between feet → slight leg angle change
        bThigh: BASE.bThigh + shift * 0.05,
        fThigh: BASE.fThigh - shift * 0.05,
        // guard hands drift with breathing
        fFore: BASE.fFore + breathe * 0.03,
        bFore: BASE.bFore + breathe * 0.03,
        fArm: BASE.fArm + breathe * 0.02,
      };
    }
    case "walk_fwd":
    case "walk_back": {
      // natural walk cycle: hip sway, weight transfer, counter-rotating torso
      // and arms, vertical bob peaking at foot-plants (double-pendulum feel).
      const ph = c.walkPhase;
      const swing = 0.5;
      const sin = Math.sin(ph);
      const cos = Math.cos(ph);
      // bob: dips when a foot plants (sin near 0), rises mid-step
      const bob = (1 - Math.abs(cos)) * 3.5;
      // hip sway side-to-side (weight transfer)
      const hipSway = sin * 0.06;
      return {
        ...BASE,
        hipDrop: BASE.hipDrop + bob,
        torsoLean: BASE.torsoLean + cos * 0.05, // torso counter-leans
        headTilt: BASE.headTilt - cos * 0.04,
        // legs swing + hip sway (weight transfer)
        bThigh: BASE.bThigh + sin * swing + hipSway,
        fThigh: BASE.fThigh - sin * swing - hipSway,
        // shins bend back when that leg lifts (heel up), plant when down
        bShin: BASE.bShin + Math.max(0, sin) * 0.55,
        fShin: BASE.fShin + Math.max(0, -sin) * 0.55,
        // arms swing opposite to legs (counter-rotation), elbows flex
        fArm: BASE.fArm - sin * 0.4,
        bArm: BASE.bArm + sin * 0.4,
        fFore: 1.95 + Math.abs(sin) * 0.1,
        bFore: 1.95 + Math.abs(sin) * 0.1,
      };
    }
    case "crouch": {
      const amt = c.crouchAmt;
      const target: Partial<Pose> = {
        hipDrop: 34 * amt,
        bThigh: lerp(-0.17, 1.15, amt),
        bShin: lerp(-0.12, -0.85, amt),
        fThigh: lerp(0.17, 1.25, amt),
        fShin: lerp(0.12, -0.7, amt),
        torsoLean: lerp(BASE.torsoLean, 0.28, amt),
        fArm: lerp(BASE.fArm, 0.7, amt),
        fFore: lerp(BASE.fFore, 1.9, amt),
        bArm: lerp(BASE.bArm, 0.3, amt),
        bFore: lerp(BASE.bFore, 1.95, amt),
      };
      return withBase(target);
    }
    case "jump": {
      // Acrobatic forward flip. The tuck is driven by air progress (peaks at
      // the apex via vertical velocity) so it builds, holds, then releases —
      // the body rotation (spin) is applied by the renderer.
      const tuck = c.airTuck;
      return {
        ...BASE,
        hipDrop: -3 - 9 * tuck,
        torsoLean: 0.18 + 0.4 * tuck,
        headTilt: 0.3 * tuck,
        bThigh: -0.1 + 1.8 * tuck,
        bShin: -0.1 + 2.1 * tuck,
        fThigh: 0.2 + 1.9 * tuck,
        fShin: 0.2 + 2.2 * tuck,
        fArm: BASE.fArm - 1.3 * tuck,
        bArm: BASE.bArm - 1.3 * tuck,
        fFore: 1.4 + 0.5 * tuck,
        bFore: 1.5 + 0.5 * tuck,
      };
    }
    case "roll": {
      // Tucked ball low to the ground; one clean revolution (spin in renderer).
      const tuck = Math.sin(Math.min(c.p, 1) * Math.PI);
      return {
        ...BASE,
        hipDrop: 38 - 8 * tuck,
        torsoLean: 0.65 + 0.4 * tuck,
        headTilt: 0.55 + 0.3 * tuck,
        bThigh: 1.8 + 0.2 * tuck,
        bShin: 2.55,
        fThigh: 2.0 + 0.2 * tuck,
        fShin: 2.65,
        fArm: 1.45,
        fFore: 1.35,
        bArm: 1.15,
        bFore: 1.25,
      };
    }
    case "punch": {
      // Lead-hand straight with realistic biomechanics: anticipation (coil
      // back, hips load), strike (hips rotate through, weight transfers
      // forward, arm extends), follow-through (slight overshoot), recover.
      return kf(
        [
          // anticipation: coil back, drop hips slightly
          [
            0,
            {
              torsoLean: 0.04,
              headTilt: 0.0,
              fArm: 0.35,
              fFore: 1.45,
              bArm: -0.55,
              bFore: 2.5,
              hipDrop: 8,
              bThigh: -0.28,
              fThigh: 0.24,
            },
          ],
          // strike: hips rotate, weight transfers forward, arm extends fast
          [
            0.16,
            {
              torsoLean: 0.2,
              headTilt: 0.08,
              fArm: 1.6,
              fFore: 1.6,
              bArm: -0.7,
              bFore: 2.75,
              hipDrop: 2,
              bThigh: -0.12,
              fThigh: 0.12,
            },
          ],
          // active hold (snap)
          [
            0.36,
            {
              torsoLean: 0.2,
              headTilt: 0.08,
              fArm: 1.6,
              fFore: 1.6,
              bArm: -0.7,
              bFore: 2.75,
              hipDrop: 2,
              bThigh: -0.12,
              fThigh: 0.12,
            },
          ],
          // follow-through: slight recoil, arm returns
          [
            0.6,
            {
              torsoLean: 0.13,
              fArm: 1.1,
              fFore: 1.9,
              bArm: -0.5,
              bFore: 2.4,
              hipDrop: 4,
            },
          ],
          // recover to guard
          [
            1,
            {
              torsoLean: BASE.torsoLean,
              headTilt: BASE.headTilt,
              fArm: BASE.fArm,
              fFore: BASE.fFore,
              bArm: BASE.bArm,
              bFore: BASE.bFore,
              hipDrop: BASE.hipDrop,
              bThigh: BASE.bThigh,
              fThigh: BASE.fThigh,
            },
          ],
        ],
        c.p,
      );
    }
    case "kick": {
      // Lead-leg front kick. Chamber -> extend -> recover.
      return kf(
        [
          [
            0,
            {
              torsoLean: -0.02,
              fThigh: 1.25,
              fShin: 2.55,
              bThigh: -0.3,
              bShin: -0.05,
              hipDrop: 4,
              fArm: 0.6,
              bArm: -0.9,
              bFore: 1.4,
            },
          ],
          [
            0.4,
            {
              torsoLean: 0.2,
              fThigh: 1.5,
              fShin: 1.5,
              bThigh: -0.35,
              bShin: -0.05,
              hipDrop: 0,
              fArm: 0.9,
              bArm: -1.1,
              bFore: 1.2,
            },
          ],
          [
            0.58,
            {
              torsoLean: 0.2,
              fThigh: 1.5,
              fShin: 1.5,
              bThigh: -0.35,
              bShin: -0.05,
              hipDrop: 0,
              fArm: 0.9,
              bArm: -1.1,
              bFore: 1.2,
            },
          ],
          [
            1,
            {
              torsoLean: BASE.torsoLean,
              fThigh: BASE.fThigh,
              fShin: BASE.fShin,
              bThigh: BASE.bThigh,
              bShin: BASE.bShin,
              hipDrop: 0,
              fArm: BASE.fArm,
              bArm: BASE.bArm,
              bFore: BASE.bFore,
            },
          ],
        ],
        c.p,
      );
    }
    case "roundhouse": {
      // Spinning heel kick: chamber high, then sweep the lead leg out
      // horizontally at torso/head height with full body rotation.
      return kf(
        [
          [
            0,
            {
              torsoLean: -0.1,
              headTilt: -0.12,
              fThigh: 1.6,
              fShin: 2.45,
              bThigh: -0.42,
              bShin: -0.1,
              hipDrop: 6,
              fArm: 0.35,
              fFore: 1.5,
              bArm: -1.0,
              bFore: 1.2,
            },
          ],
          [
            0.42,
            {
              torsoLean: 0.3,
              headTilt: 0.18,
              fThigh: 1.5,
              fShin: 1.5,
              bThigh: -0.5,
              bShin: -0.05,
              hipDrop: 0,
              fArm: 1.25,
              fFore: 1.1,
              bArm: -1.45,
              bFore: 0.9,
            },
          ],
          [
            0.62,
            {
              torsoLean: 0.3,
              headTilt: 0.18,
              fThigh: 1.5,
              fShin: 1.5,
              bThigh: -0.5,
              bShin: -0.05,
              hipDrop: 0,
              fArm: 1.25,
              fFore: 1.1,
              bArm: -1.45,
              bFore: 0.9,
            },
          ],
          [
            1,
            {
              torsoLean: BASE.torsoLean,
              headTilt: BASE.headTilt,
              fThigh: BASE.fThigh,
              fShin: BASE.fShin,
              bThigh: BASE.bThigh,
              bShin: BASE.bShin,
              hipDrop: 0,
              fArm: BASE.fArm,
              fFore: BASE.fFore,
              bArm: BASE.bArm,
              bFore: BASE.bFore,
            },
          ],
        ],
        c.p,
      );
    }
    case "super": {
      // Rising uppercut finisher: deep coil, erupt upward into a leaping
      // uppercut that lifts the whole body off the ground, then recover
      // back to guard. Long and dramatic — a super move should feel earned.
      return kf(
        [
          // anticipation: sink deep, coil every joint, draw arms way back
          [
            0,
            {
              torsoLean: -0.18,
              headTilt: -0.18,
              hipDrop: 26,
              bThigh: -0.55,
              bShin: -0.6,
              fThigh: 0.6,
              fShin: 0.7,
              fArm: -1.4,
              fFore: 2.6,
              bArm: -1.6,
              bFore: 2.8,
            },
          ],
          // eruption: hips drive up, lead arm fires upward in a jumping uppercut
          [
            0.28,
            {
              torsoLean: 0.45,
              headTilt: 0.3,
              hipDrop: -22,
              bThigh: 0.6,
              bShin: 1.2,
              fThigh: 1.1,
              fShin: 1.4,
              fArm: 2.6,
              fFore: 2.6,
              bArm: 2.2,
              bFore: 2.6,
            },
          ],
          // active hold: hang at the apex, fist to the sky
          [
            0.52,
            {
              torsoLean: 0.45,
              headTilt: 0.3,
              hipDrop: -22,
              bThigh: 0.6,
              bShin: 1.2,
              fThigh: 1.1,
              fShin: 1.4,
              fArm: 2.6,
              fFore: 2.6,
              bArm: 2.2,
              bFore: 2.6,
            },
          ],
          // recover: drop back down, recoil the arm, settle to guard
          [
            0.78,
            {
              torsoLean: 0.18,
              headTilt: 0.08,
              hipDrop: 4,
              bThigh: -0.18,
              bShin: -0.1,
              fThigh: 0.22,
              fShin: 0.18,
              fArm: 0.9,
              fFore: 1.6,
              bArm: -0.6,
              bFore: 2.2,
            },
          ],
          [
            1,
            {
              torsoLean: BASE.torsoLean,
              headTilt: BASE.headTilt,
              hipDrop: BASE.hipDrop,
              bThigh: BASE.bThigh,
              bShin: BASE.bShin,
              fThigh: BASE.fThigh,
              fShin: BASE.fShin,
              fArm: BASE.fArm,
              fFore: BASE.fFore,
              bArm: BASE.bArm,
              bFore: BASE.bFore,
            },
          ],
        ],
        c.p,
      );
    }
    case "block": {
      // Both forearms up in front, slight crouch.
      return {
        ...BASE,
        torsoLean: 0.12,
        hipDrop: 8,
        fArm: 0.85,
        fFore: 1.75,
        bArm: 0.55,
        bFore: 1.85,
        bThigh: -0.05,
        fThigh: 0.1,
      };
    }
    case "hit": {
      // Recoil backward, head back, arms flail.
      return kf(
        [
          [
            0,
            {
              torsoLean: -0.28,
              headTilt: -0.25,
              fArm: -0.9,
              fFore: 1.0,
              bArm: -1.1,
              bFore: -0.4,
              bThigh: -0.3,
              fThigh: 0.3,
              hipDrop: 2,
            },
          ],
          [
            1,
            {
              torsoLean: BASE.torsoLean,
              headTilt: BASE.headTilt,
              fArm: BASE.fArm,
              fFore: BASE.fFore,
              bArm: BASE.bArm,
              bFore: BASE.bFore,
              bThigh: BASE.bThigh,
              fThigh: BASE.fThigh,
              hipDrop: 0,
            },
          ],
        ],
        c.p,
      );
    }
    case "knockdown": {
      // Fall onto back: torso leans far back, hip drops near ground, limbs splay.
      return kf(
        [
          [
            0,
            {
              torsoLean: -0.3,
              hipDrop: 6,
              bThigh: -0.4,
              fThigh: 0.5,
              bShin: 0.2,
              fShin: 0.3,
              fArm: -1.0,
              bArm: -1.2,
              headTilt: -0.3,
            },
          ],
          [
            1,
            {
              torsoLean: -1.45,
              hipDrop: 44,
              bThigh: -0.9,
              fThigh: 0.9,
              bShin: 1.1,
              fShin: 1.2,
              fArm: -1.7,
              fFore: -1.6,
              bArm: -2.2,
              bFore: -2.0,
              headTilt: -0.5,
            },
          ],
        ],
        c.p,
      );
    }
    case "getup": {
      return kf(
        [
          [
            0,
            {
              torsoLean: -1.45,
              hipDrop: 44,
              bThigh: -0.9,
              fThigh: 0.9,
              bShin: 1.1,
              fShin: 1.2,
              fArm: -1.7,
              fFore: -1.6,
              bArm: -2.2,
              bFore: -2.0,
            },
          ],
          [
            1,
            {
              torsoLean: BASE.torsoLean,
              hipDrop: 0,
              bThigh: BASE.bThigh,
              fThigh: BASE.fThigh,
              bShin: BASE.bShin,
              fShin: BASE.fShin,
              fArm: BASE.fArm,
              fFore: BASE.fFore,
              bArm: BASE.bArm,
              bFore: BASE.bFore,
            },
          ],
        ],
        c.p,
      );
    }
    case "throw": {
      // Close clinch: reach, lock, hip-toss finish.
      return kf(
        [
          [0, { torsoLean: 0.08, fArm: 0.6, fFore: 1.8, bArm: -0.3, bFore: 2.0, hipDrop: 6 }],
          [0.25, { torsoLean: 0.35, fArm: 1.4, fFore: 2.1, bArm: 0.8, bFore: 1.6, hipDrop: 10 }],
          [0.5, { torsoLean: 0.55, fArm: 1.7, fFore: 2.3, bArm: 1.2, bFore: 1.8, hipDrop: 14, fThigh: 0.4, bThigh: -0.35 }],
          [0.75, { torsoLean: 0.25, fArm: 1.0, fFore: 1.9, bArm: 0.4, bFore: 2.0, hipDrop: 8 }],
          [1, { torsoLean: 0.1, fArm: 0.5, fFore: 2.1, bArm: -0.4, bFore: 2.2, hipDrop: 4 }],
        ],
        c.p,
      );
    }
    case "victory": {
      const w = Math.sin(c.time * 6) * 0.5 + 0.5;
      return {
        ...BASE,
        torsoLean: -0.05,
        hipDrop: -Math.abs(Math.sin(c.time * 4)) * 4,
        bArm: -2.4 - w * 0.2,
        bFore: -2.7,
        fArm: 2.4 + w * 0.2,
        fFore: 2.7,
        bThigh: -0.05,
        fThigh: 0.05,
      };
    }
    case "defeated": {
      return poseFor({ ...c, state: "knockdown", p: 1 });
    }
    default:
      return BASE;
  }
}

// State durations (seconds) for finite states.
export const STATE_DUR: Record<string, number> = {
  punch: 0.34,
  kick: 0.56,
  roundhouse: 0.82,
  super: 1.2,
  throw: 0.55,
  hit: 0.26,
  knockdown: 0.65,
  getup: 0.5,
  roll: 0.5,
};

// Attack active-frame windows (progress within the attack state).
export const ACTIVE_WINDOW: Record<"punch" | "kick" | "roundhouse" | "super" | "throw", [number, number]> = {
  punch: [0.15, 0.45],
  kick: [0.32, 0.6],
  roundhouse: [0.42, 0.62],
  super: [0.28, 0.52],
  throw: [0.18, 0.42],
};

export const ATTACK_SPECS = {
  punch: {
    type: "punch" as const,
    startup: 0.34 * 0.1,
    active: 0.34 * 0.3,
    recovery: 0.34 * 0.6,
    damage: 8,
    range: 66,
    height: -160,
    hitH: 30,
    knockback: 170,
    hitstun: 0.3,
    launch: 0,
  },
  kick: {
    type: "kick" as const,
    startup: 0.56 * 0.3,
    active: 0.56 * 0.28,
    recovery: 0.56 * 0.42,
    damage: 15,
    range: 86,
    height: -78,
    hitH: 44,
    knockback: 310,
    hitstun: 0.44,
    launch: 0,
  },
  roundhouse: {
    type: "roundhouse" as const,
    startup: 0.82 * 0.42,
    active: 0.82 * 0.2,
    recovery: 0.82 * 0.38,
    damage: 16,
    range: 94,
    height: -124,
    hitH: 48,
    knockback: 370,
    hitstun: 0.5,
    launch: 0,
  },
  super: {
    type: "super" as const,
    startup: 1.2 * 0.28,
    active: 1.2 * 0.24,
    recovery: 1.2 * 0.48,
    damage: 30,
    range: 110,
    height: -100,
    hitH: 80,
    knockback: 500,
    hitstun: 0.8,
    launch: 0,
  },
  throw: {
    type: "throw" as const,
    startup: 0.55 * 0.18,
    active: 0.55 * 0.24,
    recovery: 0.55 * 0.58,
    damage: 14,
    range: 48,
    height: -110,
    hitH: 50,
    knockback: 280,
    hitstun: 0.55,
    launch: 0,
  },
};
