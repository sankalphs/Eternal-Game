// ============================================================================
// Physics configuration — all combat physics constants in one place.
// fighter.ts imports from here instead of hardcoding.
// ============================================================================

export const PHYSICS = {
  // Stage geometry
  groundY: 470,
  stageLeft: 80,
  stageRight: 880,

  // Movement
  walkSpeed: 182,
  accel: 1400,
  airAccel: 700,
  friction: 1600,

  // Jump
  jumpVel: 640,
  gravity: 1180,
  jumpCut: 0.35, // velocity multiplier on early release
  jumpMomentumBlend: 0.5, // how much air momentum is applied on launch

  // Roll
  rollSpeed: 400,
  rollDuration: 0.5,
  rollArcHeight: 22,

  // Block
  blockDamageReduction: 0.18, // defender takes 18% of damage when blocking
  blockDamping: 0.6, // vx multiplier while blocking
  blockHitstun: 0.12,

  // Crouch
  crouchDamping: 0.5,

  // Hit resolution
  heavyHitThreshold: 22, // dmg >= this → knockdown
  kickKnockdownChance: 0.22,
  roundhouseKnockdownChance: 0.5,
  knockdownInvuln: 1.4,
  hitInvuln: 0.46,
  knockdownDuration: 0.65,
  knockdownDownTimer: 0.9,
  getupDuration: 0.5,
  hitstunDuration: 0.26,

  // Walk animation
  walkPhaseSpeed: 9,
  idlePhaseSpeed: 1.5,

  // Body separation
  bodySeparationDist: 40,

  // Rage
  rageMax: 100,
  rageGainDealtClean: 0.4,
  rageGainDealtBlocked: 0.4,
  rageGainTakenClean: 0.8,
  rageGainTakenBlocked: 0.3,
} as const;

// Convenience re-exports for backward compatibility with existing imports
export const GROUND_Y = PHYSICS.groundY;
export const STAGE_LEFT = PHYSICS.stageLeft;
export const STAGE_RIGHT = PHYSICS.stageRight;
export const WALK_SPEED = PHYSICS.walkSpeed;
export const JUMP_VEL = PHYSICS.jumpVel;
export const GRAVITY = PHYSICS.gravity;
export const ROLL_SPEED = PHYSICS.rollSpeed;
export const ACCEL = PHYSICS.accel;
export const AIR_ACCEL = PHYSICS.airAccel;
export const FRICTION = PHYSICS.friction;
export const JUMP_CUT = PHYSICS.jumpCut;
export const ROLL_DURATION = PHYSICS.rollDuration;
export const ROLL_ARC_HEIGHT = PHYSICS.rollArcHeight;
export const JUMP_MOMENTUM_BLEND = PHYSICS.jumpMomentumBlend;
export const BLOCK_DAMAGE_REDUCTION = PHYSICS.blockDamageReduction;
export const HEAVY_HIT_THRESHOLD = PHYSICS.heavyHitThreshold;
export const KICK_KNOCKDOWN_CHANCE = PHYSICS.kickKnockdownChance;
export const ROUNDHOUSE_KNOCKDOWN_CHANCE = PHYSICS.roundhouseKnockdownChance;
export const KNOCKDOWN_INVULN = PHYSICS.knockdownInvuln;
export const HIT_INVULN = PHYSICS.hitInvuln;
export const BLOCK_HITSTUN = PHYSICS.blockHitstun;
export const TRADE_INVULN = 0.12; // active-frame trade armor i-frames
export const BLOCK_DAMPING = PHYSICS.blockDamping;
export const CROUCH_DAMPING = PHYSICS.crouchDamping;
export const WALK_PHASE_SPEED = PHYSICS.walkPhaseSpeed;
export const IDLE_PHASE_SPEED = PHYSICS.idlePhaseSpeed;
export const BODY_SEPARATION_DIST = PHYSICS.bodySeparationDist;
