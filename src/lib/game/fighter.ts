// Fighter entity: physics, state machine, actions, hitboxes, damage.

import type { AttackSpec, BodyType, Facing, InputState, Pose, Rect } from "./types";
import {
  ATTACK_SPECS,
  ACTIVE_WINDOW,
  BASE,
  STATE_DUR,
  clamp,
  poseFor,
} from "./poses";
import {
  GROUND_Y,
  WALK_SPEED,
  JUMP_VEL,
  GRAVITY,
  STAGE_LEFT,
  STAGE_RIGHT,
  ROLL_SPEED,
  ACCEL,
  AIR_ACCEL,
  FRICTION,
  JUMP_CUT,
  ROLL_DURATION,
  ROLL_ARC_HEIGHT,
  JUMP_MOMENTUM_BLEND,
  BLOCK_DAMAGE_REDUCTION,
  HEAVY_HIT_THRESHOLD,
  KICK_KNOCKDOWN_CHANCE,
  ROUNDHOUSE_KNOCKDOWN_CHANCE,
  KNOCKDOWN_INVULN,
  HIT_INVULN,
  BLOCK_HITSTUN,
  TRADE_INVULN,
  BLOCK_DAMPING,
  CROUCH_DAMPING,
  WALK_PHASE_SPEED,
  IDLE_PHASE_SPEED,
  BODY_SEPARATION_DIST,
} from "./config/physics";

// Re-export the stage/physics constants so existing imports
// (`import { GROUND_Y, STAGE_LEFT, STAGE_RIGHT } from "./fighter"`) keep working.
// New code should import these from "./config/physics" directly.
export {
  GROUND_Y,
  STAGE_LEFT,
  STAGE_RIGHT,
  WALK_SPEED,
  JUMP_VEL,
  GRAVITY,
  ROLL_SPEED,
  ACCEL,
  AIR_ACCEL,
  FRICTION,
  JUMP_CUT,
};

export interface FighterOpts {
  x: number;
  isPlayer: boolean;
  facing: Facing;
  maxHp: number;
  rim: string;
  name: string;
  damageMul?: number;
  speedMul?: number;
  blade?: boolean;
  bodyType?: BodyType;
}

export class Fighter {
  x: number;
  y = GROUND_Y;
  vx = 0;
  vy = 0;
  facing: Facing;
  isPlayer: boolean;
  maxHp: number;
  hp: number;
  rim: string;
  name: string;
  damageMul: number;
  speedMul: number;
  bodyType: BodyType;
  // rage resource — fills by dealing/taking damage, unlocks the super move
  rageMeter = 0;
  readonly RAGE_MAX = 100;

  state: import("./types").FighterState = "idle";
  stateTime = 0;
  walkPhase = 0;
  crouchAmt = 0;
  onGround = true;

  attackHasHit = false;
  currentAttack: import("./types").AttackType | null = null;
  hitstun = 0;
  blockHeld = false;
  invuln = 0;
  blade: boolean;
  spin = 0;
  rollDir: 1 | -1 = 1;
  private jumpHeld = false; // tracks if up is still held (variable jump height)

  // buffered input edge
  private prevPunch = false;
  private prevKick = false;
  private prevRoundhouse = false;
  private prevRoll = false;
  private prevSuper = false;
  private prevThrow = false;

  // knockdown get-up
  downTimer = 0;

  constructor(o: FighterOpts) {
    this.x = o.x;
    this.facing = o.facing;
    this.isPlayer = o.isPlayer;
    this.maxHp = o.maxHp;
    this.hp = o.maxHp;
    this.rim = o.rim;
    this.name = o.name;
    this.damageMul = o.damageMul ?? 1;
    this.speedMul = o.speedMul ?? 1;
    this.blade = o.blade ?? false;
    this.bodyType = o.bodyType ?? "lean";
  }

  reset(x: number, facing: Facing) {
    this.x = x;
    this.y = GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.state = "idle";
    this.stateTime = 0;
    this.walkPhase = 0;
    this.crouchAmt = 0;
    this.onGround = true;
    this.attackHasHit = false;
    this.currentAttack = null;
    this.hitstun = 0;
    this.blockHeld = false;
    this.invuln = 0;
    this.downTimer = 0;
    this.spin = 0;
    this.rollDir = 1;
    this.hp = this.maxHp;
    this.rageMeter = 0;
    this.prevSuper = false;
    this.prevThrow = false;
    this.jumpHeld = false;
  }

  get dur(): number {
    return STATE_DUR[this.state] ?? 0;
  }

  get progress(): number {
    return this.dur > 0 ? clamp(this.stateTime / this.dur, 0, 1) : 0;
  }

  // Normalized air progress for the flip jump: 0 at launch, 0.5 at apex,
  // 1 at landing. Driven by vertical velocity so the tuck & spin always
  // track the actual arc (and reset to 0 the instant the fighter lands).
  get airProgress(): number {
    if (this.onGround) return 1;
    const ap = (JUMP_VEL + this.vy) / (2 * JUMP_VEL);
    return clamp(ap, 0, 1);
  }

  canAct(): boolean {
    if (!this.onGround) return false;
    if (this.state === "hit" || this.state === "knockdown") return false;
    if (this.state === "getup") return false;
    if (
      this.state === "punch" ||
      this.state === "kick" ||
      this.state === "roundhouse" ||
      this.state === "super" ||
      this.state === "throw"
    )
      return false;
    if (this.state === "roll") return false;
    if (this.state === "victory" || this.state === "defeated") return false;
    return true;
  }

  isAttacking(): boolean {
    return (
      this.state === "punch" ||
      this.state === "kick" ||
      this.state === "roundhouse" ||
      this.state === "super" ||
      this.state === "throw"
    );
  }

  isBlocking(): boolean {
    return this.state === "block";
  }

  /** Grounded, not invulnerable — eligible to be thrown. */
  isThrowable(): boolean {
    if (!this.onGround) return false;
    if (this.invuln > 0) return false;
    if (
      this.state === "knockdown" ||
      this.state === "getup" ||
      this.state === "roll" ||
      this.state === "defeated" ||
      this.state === "victory" ||
      this.state === "throw"
    )
      return false;
    return true;
  }

  /** Public so the engine can force victory / defeated poses on round end. */
  setState(s: import("./types").FighterState) {
    if (this.state !== s) {
      this.state = s;
      this.stateTime = 0;
      if (
        s === "punch" ||
        s === "kick" ||
        s === "roundhouse" ||
        s === "super" ||
        s === "throw"
      ) {
        this.attackHasHit = false;
        this.currentAttack = s;
      } else if (s !== "hit") {
        this.currentAttack = null;
      }
      if (s === "jump" || s === "roll") this.spin = 0;
    }
  }

  startAttack(type: import("./types").AttackType) {
    if (!this.canAct()) return;
    if (this.crouchAmt > 0.5) return; // can't attack while crouching low
    this.setState(type);
  }

  // Rolling dodge: a quick tucked dash with i-frames (evades all hits).
  roll(dir: 1 | -1) {
    if (!this.canAct()) return;
    if (!this.onGround) return;
    this.rollDir = dir;
    this.vx = dir * ROLL_SPEED * this.speedMul;
    this.setState("roll");
    // invulnerable for the whole roll so it reliably evades attacks.
    // ROLL_DURATION must match poses.STATE_DUR.roll (kept in sync via config).
    this.invuln = Math.max(this.invuln, ROLL_DURATION);
  }

  startBlock() {
    if (!this.canAct()) return;
    if (this.state !== "block") this.setState("block");
  }

  // Apply a hit from an attacker. Returns true if it landed.
  // Blocking reduces damage for all strike types (punch/kick/RH/super).
  // Throws ignore block (resolved only if throwable + in range).
  // Do not let kicks beat stand-block — genomes were balanced against classic block.
  takeHit(
    spec: AttackSpec,
    fromFacing: Facing,
    attacker: Fighter,
    onSpark: (x: number, y: number, blocked: boolean) => void,
  ): { hit: boolean; blocked: boolean; dmg: number } {
    if (this.invuln > 0) return { hit: false, blocked: false, dmg: 0 };
    if (
      this.state === "knockdown" ||
      this.state === "defeated" ||
      this.state === "getup" ||
      this.state === "roll" ||
      this.state === "throw"
    )
      return { hit: false, blocked: false, dmg: 0 };

    const facingOk = this.facing === -fromFacing && this.onGround;
    // Throws ignore block; all other strikes are blocked when facing correctly.
    const blocked =
      spec.type !== "throw" &&
      this.isBlocking() &&
      facingOk;

    let dmg = spec.damage * attacker.damageMul;
    if (blocked) dmg *= BLOCK_DAMAGE_REDUCTION;
    dmg = Math.round(dmg);

    this.hp = Math.max(0, this.hp - dmg);

    // rage: defender gains a chunk on a clean hit (and a little even when
    // blocking); attacker gains a smaller amount (offense builds rage too).
    if (!blocked) this.rageMeter = Math.min(this.RAGE_MAX, this.rageMeter + dmg * 0.8);
    else this.rageMeter = Math.min(this.RAGE_MAX, this.rageMeter + dmg * 0.3);
    attacker.rageMeter = Math.min(attacker.RAGE_MAX, attacker.rageMeter + dmg * 0.4);

    const hitX = this.x - fromFacing * 10;
    const hitY = GROUND_Y + spec.height;
    onSpark(hitX, hitY, blocked);

    if (blocked) {
      // small pushback, stay in block
      this.vx = -fromFacing * spec.knockback * 0.25;
      this.hitstun = Math.max(this.hitstun, BLOCK_HITSTUN);
      return { hit: true, blocked: true, dmg };
    }

    // Throws never trade through active armor — always lock the defender.
    if (spec.type !== "throw" && this.attackBox()) {
      this.invuln = TRADE_INVULN;
      return { hit: true, blocked: false, dmg };
    }

    // heavy hit / low hp -> knockdown. Lethal blows always knock down;
    // kicks have a chance to sweep the opponent; very heavy hits too.
    // Throws always knockdown for readability.
    const lethal = this.hp <= 0;
    const heavy =
      lethal ||
      spec.type === "throw" ||
      (spec.type === "kick" && Math.random() < KICK_KNOCKDOWN_CHANCE) ||
      (spec.type === "roundhouse" && Math.random() < ROUNDHOUSE_KNOCKDOWN_CHANCE) ||
      dmg >= HEAVY_HIT_THRESHOLD;
    if (heavy) {
      this.vx = -fromFacing * spec.knockback;
      this.setState("knockdown");
      this.downTimer = lethal ? 99 : 0.9;
      if (spec.launch) this.vy = -spec.launch;
      this.hitstun = 0.9;
      // invulnerable through knockdown + getup so they always recover
      this.invuln = KNOCKDOWN_INVULN;
    } else {
      this.vx = -fromFacing * spec.knockback * 0.7;
      this.setState("hit");
      this.hitstun = spec.hitstun;
      // Recovery window: invulnerable long enough to act after hitstun ends,
      // preventing lock-down loops while still allowing short strings.
      this.invuln = HIT_INVULN;
    }
    return { hit: true, blocked: false, dmg };
  }

  // Compute current pose.
  pose(): Pose {
    return poseFor({
      state: this.state,
      p: this.progress,
      time: this.stateTime,
      walkPhase: this.walkPhase,
      crouchAmt: this.crouchAmt,
      airTuck: this.state === "jump" ? Math.sin(this.airProgress * Math.PI) : 0,
    });
  }

  // Body collision box (world space).
  bodyBox(): Rect {
    const p = this.pose();
    // match render proportions: leg = 78, torso = 46, neck+head ≈ 34
    const hipY = this.y - 78 + p.hipDrop;
    const headTop = hipY - 46 - 34;
    const top =
      this.state === "knockdown" || this.state === "defeated"
        ? this.y - 44
        : headTop;
    const bottom = this.y;
    return { x: this.x - 16, y: top, w: 32, h: bottom - top };
  }

  // Active attack hitbox (world space), or null if not in active frames.
  attackBox(): { rect: Rect; spec: AttackSpec } | null {
    if (!this.isAttacking() || !this.currentAttack) return null;
    const spec = ATTACK_SPECS[this.currentAttack];
    const [a0, a1] = ACTIVE_WINDOW[this.currentAttack];
    const p = this.progress;
    if (p < a0 || p > a1) return null;
    const frontX = this.x + this.facing * 14;
    const cy = GROUND_Y + spec.height;
    const rx =
      this.facing === 1 ? frontX : frontX - this.facing * spec.range;
    // facing left -> range extends left
    const x = this.facing === 1 ? frontX : frontX - spec.range;
    return {
      rect: { x, y: cy - spec.hitH / 2, w: spec.range, h: spec.hitH },
      spec,
    };
  }

  update(dt: number, input: InputState | null, opp: Fighter) {
    this.stateTime += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitstun > 0) this.hitstun -= dt;

    // Auto-face opponent when free on ground.
    if (
      this.onGround &&
      this.state !== "punch" &&
      this.state !== "kick" &&
      this.state !== "roundhouse" &&
      this.state !== "super" &&
      this.state !== "throw" &&
      this.state !== "roll" &&
      this.state !== "hit" &&
      this.state !== "knockdown" &&
      this.state !== "getup" &&
      this.state !== "victory" &&
      this.state !== "defeated"
    ) {
      this.facing = opp.x >= this.x ? 1 : -1;
    }

    // body rotation for acrobatic states — driven by progress so it always
    // snaps back to 0 the instant the state ends (no stale "bent" pose).
    if (this.state === "jump") {
      // one clean forward flip over the whole arc
      this.spin = this.airProgress * Math.PI * 2 * this.facing;
    } else if (this.state === "roll") {
      // exactly one revolution over the roll
      this.spin = this.progress * Math.PI * 2 * this.rollDir;
    } else {
      this.spin = 0;
    }

    // Knockdown / getup handling.
    if (this.state === "knockdown") {
      if (this.progress >= 1) {
        // Lethal blow -> stay down (defeated). Otherwise get back up.
        if (this.hp <= 0) {
          this.state = "defeated";
          this.stateTime = 0;
        } else {
          this.setState("getup");
        }
      }
      this.applyPhysics(dt);
      return;
    }
    if (this.state === "defeated") {
      this.downTimer -= dt;
      // stays down
      this.applyPhysics(dt);
      return;
    }

    // Hit state: no input, physics applies, returns to idle after dur.
    if (this.state === "hit") {
      if (this.progress >= 1 && this.hitstun <= 0) {
        this.setState("idle");
      }
      this.applyPhysics(dt);
      return;
    }
    if (this.state === "getup") {
      if (this.progress >= 1) this.setState("idle");
      this.applyPhysics(dt);
      return;
    }
    // Roll: locked tucked dash, i-frames, slight arc (lifts off ground
    // mid-roll like a dive roll), ends into idle.
    if (this.state === "roll") {
      this.vx = this.rollDir * ROLL_SPEED * this.speedMul;
      // arc: rise to ~ROLL_ARC_HEIGHT px at mid-roll, settle back by the end
      const arc = Math.sin(this.progress * Math.PI) * ROLL_ARC_HEIGHT;
      this.y = GROUND_Y - arc;
      this.onGround = arc < 1;
      if (this.progress >= 1) {
        this.y = GROUND_Y;
        this.onGround = true;
        this.setState("idle");
        this.spin = 0;
      }
      // still apply horizontal physics (but skip gravity/ground logic)
      this.x += this.vx * dt;
      this.x = clamp(this.x, STAGE_LEFT, STAGE_RIGHT);
      return;
    }

    // Victory / defeated freeze.
    if (this.state === "victory") {
      this.applyPhysics(dt);
      return;
    }

    // Player or AI input handling.
    if (input) {
      this.handleInput(dt, input, opp);
    }
    this.applyPhysics(dt);
  }

  private handleInput(dt: number, input: InputState, opp: Fighter) {
    this.blockHeld = input.block;

    // If currently attacking, let it play out (no cancel), but still physics.
    if (this.isAttacking()) {
      if (this.progress >= 1) this.setState("idle");
      return;
    }

    // Block (hold). Cancels movement.
    if (input.block && this.onGround) {
      this.startBlock();
      this.vx *= BLOCK_DAMPING;
      this.crouchAmt = lerpTo(this.crouchAmt, 0, dt, 8);
      return;
    }
    if (this.state === "block") this.setState("idle");

    // Attacks (edge-triggered).
    const punchEdge = input.punch && !this.prevPunch;
    const kickEdge = input.kick && !this.prevKick;
    const rhEdge = input.roundhouse && !this.prevRoundhouse;
    const superEdge = input.super && !this.prevSuper;
    this.prevPunch = input.punch;
    this.prevKick = input.kick;
    this.prevRoundhouse = input.roundhouse;
    this.prevSuper = input.super;

    // Super move — only when the rage meter is full. Drains the meter.
    if (superEdge && this.rageMeter >= this.RAGE_MAX) {
      this.startAttack("super");
      this.rageMeter = 0;
      return;
    }

    // Throw: dedicated key, or simultaneous punch+kick edge (grab break).
    const throwEdge = input.throw && !this.prevThrow;
    this.prevThrow = input.throw;
    const grabChord =
      punchEdge && kickEdge && !input.roundhouse && !input.super;
    if (throwEdge || grabChord) {
      this.startAttack("throw");
      return;
    }

    if (punchEdge) {
      this.startAttack("punch");
      return;
    }
    if (kickEdge) {
      this.startAttack("kick");
      return;
    }
    if (rhEdge) {
      this.startAttack("roundhouse");
      return;
    }

    // Acrobatic flip jump — variable height: hold up = higher, release = cut.
    if (input.up && this.onGround) {
      this.vy = -JUMP_VEL;
      this.onGround = false;
      this.jumpHeld = true;
      let move = 0;
      if (input.left) move -= 1;
      if (input.right) move += 1;
      if (move !== 0) {
        // give forward momentum but don't override existing velocity instantly
        const target = move * WALK_SPEED * 1.1 * this.speedMul;
        this.vx += (target - this.vx) * JUMP_MOMENTUM_BLEND;
        this.facing = move >= 0 ? 1 : -1;
      }
      this.setState("jump");
      return;
    }
    // variable jump height: if the player released up while still rising, cut velocity
    if (!input.up && this.jumpHeld && !this.onGround && this.vy < 0) {
      this.vy *= JUMP_CUT;
      this.jumpHeld = false;
    }
    if (this.onGround) this.jumpHeld = false;

    // Rolling dodge (SF2-style). Dedicated roll key rolls toward the opponent;
    // holding down + a direction rolls that way. Quick, i-framed, evades hits.
    const rollEdge = input.roll && !this.prevRoll;
    this.prevRoll = input.roll;
    const downHeld = input.down;
    const dirHeld = input.left ? -1 : input.right ? 1 : 0;
    if (this.onGround && (rollEdge || (downHeld && dirHeld !== 0))) {
      let dir: 1 | -1;
      if (dirHeld !== 0) {
        dir = dirHeld === 1 ? 1 : -1;
      } else {
        // roll toward opponent by default
        dir = opp.x >= this.x ? 1 : -1;
      }
      this.roll(dir);
      return;
    }

    // Crouch (down alone).
    if (input.down && this.onGround) {
      this.crouchAmt = lerpTo(this.crouchAmt, 1, dt, 10);
      if (this.state !== "crouch") this.setState("crouch");
      this.vx *= CROUCH_DAMPING;
      return;
    } else {
      this.crouchAmt = lerpTo(this.crouchAmt, 0, dt, 10);
      if (this.state === "crouch" && this.crouchAmt < 0.1)
        this.setState("idle");
    }

    // Movement — momentum-based: accelerate toward target velocity, decelerate with friction.
    if (this.onGround) {
      let move = 0;
      if (input.left) move -= 1;
      if (input.right) move += 1;
      if (move !== 0) {
        const target = move * WALK_SPEED * this.speedMul;
        // accelerate toward target velocity (not instant set)
        const dv = target - this.vx;
        const maxStep = ACCEL * dt;
        if (Math.abs(dv) <= maxStep) this.vx = target;
        else this.vx += Math.sign(dv) * maxStep;
        const toward = Math.sign(opp.x - this.x) === move ? 1 : -1;
        this.setState(toward === 1 ? "walk_fwd" : "walk_back");
        this.walkPhase += dt * WALK_PHASE_SPEED * Math.abs(move);
      } else {
        // friction: decelerate toward 0
        const maxStep = FRICTION * dt;
        if (Math.abs(this.vx) <= maxStep) this.vx = 0;
        else this.vx -= Math.sign(this.vx) * maxStep;
        if (this.state === "walk_fwd" || this.state === "walk_back")
          this.setState("idle");
      }
    } else {
      // air control — accelerate toward held direction (weighty, preserves momentum)
      let move = 0;
      if (input.left) move -= 1;
      if (input.right) move += 1;
      if (move !== 0) {
        const target = move * WALK_SPEED * 0.85 * this.speedMul;
        const dv = target - this.vx;
        const maxStep = AIR_ACCEL * dt;
        if (Math.abs(dv) <= maxStep) this.vx = target;
        else this.vx += Math.sign(dv) * maxStep;
      }
      // no direction held → keep horizontal momentum (realistic ballistic arc)
    }

    if (this.state === "idle") this.walkPhase += dt * IDLE_PHASE_SPEED;
  }

  private applyPhysics(dt: number) {
    // gravity
    if (!this.onGround) {
      this.vy += GRAVITY * dt;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // ground
    if (this.y >= GROUND_Y) {
      this.y = GROUND_Y;
      if (!this.onGround) {
        this.onGround = true;
        this.vy = 0;
        if (this.state === "jump") {
          this.setState("idle");
          this.spin = 0;
        }
      }
    } else {
      this.onGround = false;
    }

    // friction when grounded & not walking/rolling — proper deceleration
    if (this.onGround && !this.isWalkingInput() && this.state !== "roll") {
      const maxStep = FRICTION * 0.6 * dt;
      if (Math.abs(this.vx) <= maxStep) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * maxStep;
    }

    // stage bounds
    this.x = clamp(this.x, STAGE_LEFT, STAGE_RIGHT);
  }

  private isWalkingInput(): boolean {
    return this.state === "walk_fwd" || this.state === "walk_back";
  }

  // Called by engine to resolve overlap with opponent.
  separateFrom(opp: Fighter) {
    const minDist = BODY_SEPARATION_DIST;
    const dx = this.x - opp.x;
    const dist = Math.abs(dx);
    if (dist < minDist && this.onGround && opp.onGround) {
      const push = (minDist - dist) / 2;
      const dir = dx >= 0 ? 1 : -1;
      this.x += dir * push;
      opp.x -= dir * push;
      this.x = clamp(this.x, STAGE_LEFT, STAGE_RIGHT);
      opp.x = clamp(opp.x, STAGE_LEFT, STAGE_RIGHT);
    }
  }
}

function lerpTo(cur: number, target: number, dt: number, rate: number) {
  const t = Math.min(1, dt * rate);
  return cur + (target - cur) * t;
}
