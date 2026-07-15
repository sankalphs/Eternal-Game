// Shared types for the Eternal game engine.

export type Facing = 1 | -1;

export type BackgroundId =
  | "sunset"
  | "desert"
  | "temple"
  | "bamboo"
  | "moon"
  | "volcano"
  | "snow";

// A pose describes all joint angles (radians) for an articulated silhouette.
// Convention: angle measured from "straight down", positive rotates toward
// the fighter's front (+x in local space). Local space always faces right;
// left-facing fighters are mirrored at draw time.
export interface Pose {
  torsoLean: number; // lean of torso from vertical, + = forward
  headTilt: number; // head tilt from torso, + = forward
  hipDrop: number; // lower hip by this many px (crouch)
  bArm: number; // back upper arm
  bFore: number; // back forearm
  fArm: number; // front upper arm
  fFore: number; // front forearm
  bThigh: number; // back thigh
  bShin: number; // back shin
  fThigh: number; // front thigh
  fShin: number; // front shin
}

export type FighterState =
  | "idle"
  | "walk_fwd"
  | "walk_back"
  | "jump"
  | "roll"
  | "crouch"
  | "punch"
  | "kick"
  | "roundhouse"
  | "super"
  | "throw"
  | "block"
  | "hit"
  | "knockdown"
  | "getup"
  | "victory"
  | "defeated";

export type AttackType = "punch" | "kick" | "roundhouse" | "super" | "throw";

export interface AttackSpec {
  type: AttackType;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  range: number;
  height: number; // y of hitbox center relative to ground (0)
  hitH: number;
  knockback: number;
  hitstun: number;
  launch: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: "spark" | "dust" | "ring" | "streak";
  grav?: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
}

export type BodyType = "lean" | "bulky" | "tall" | "hunched";

export interface OpponentDef {
  name: string;
  title: string;
  rim: string;
  hp: number;
  damageMul: number;
  speedMul: number;
  aggression: number; // base attack tendency 0..1
  blockChance: number; // base block/dodge probability 0..1
  reaction: number; // seconds to react to player attacks
  combo: number; // max consecutive attacks in a string
  blade?: boolean;
  bg: BackgroundId;
  bodyType?: BodyType;
  // ---- dynamic / advanced AI capabilities (scale with level) ----
  whiffPunish?: number; // 0..1 chance to punish a missed player attack
  antiAir?: number; // 0..1 chance to anti-air a jumping player
  pressure?: number; // 0..1 tendency to maintain offensive pressure
  mixup?: number; // 0..1 tendency to mix high/low/slow attacks
  readDelay?: number; // extra reaction delay when reading player habits (s)
  adaptive?: number; // 0..1 how much the AI adapts to repeated player patterns
  rage?: number; // 0..1 how much aggression rises when low on HP
  perfection?: number; // 0..1 chance to frame-perfectly block an unreactable string
  story?: string; // narrative beat shown when facing this opponent
}

export type Phase =
  | "menu"
  | "intro"
  | "fight"
  | "round_end"
  | "match_end"
  | "game_over"
  | "champion";

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  punch: boolean;
  kick: boolean;
  roundhouse: boolean;
  roll: boolean;
  block: boolean;
  super: boolean;
  throw: boolean;
}
