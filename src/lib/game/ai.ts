// Enemy AI controller — dynamic, escalating difficulty. Each opponent has a
// capability profile (aggression, reaction, whiffPunish, antiAir, pressure,
// mixup, adaptive, rage, perfection) that scales with level. The AI:
//  - zones to its optimal spacing
//  - reacts to the player's attacks (block / roll-dodge) scaled by `reaction`
//  - whiff-punishes missed player attacks (whiffPunish)
//  - anti-airs jumping players (antiAir)
//  - runs pressure strings with frame-tight follow-ups (pressure, combo)
//  - mixes high/low/fast/slow attacks to break blocking (mixup)
//  - adapts to repeated player habits: if the player spams one move the AI
//    learns to pre-empt it (adaptive)
//  - rages when low on HP: faster, more aggressive (rage)
//  - frame-perfectly blocks unreactable strings at high levels (perfection)
//
// All tuning lives in config/ai.ts.

import type { InputState, OpponentDef } from "./types";
import type { Fighter } from "./fighter";
import {
  AI_RANGES,
  AI_SPACING,
  AI_TIMING,
  AI_REACTION,
  AI_WINDOWS,
  AI_JUMP,
  AI_PRESSURE,
  AI_HABITS,
  AI_RAGE,
} from "./config/ai";

type Mode = "approach" | "retreat" | "block" | "wait" | "zone";
type AttackKind = "punch" | "kick" | "roundhouse";

// player-habit tracker for the adaptive system
interface HabitTracker {
  punchCount: number;
  kickCount: number;
  rhCount: number;
  jumpCount: number;
  blockCount: number;
  lastMove: AttackKind | "jump" | "block" | null;
  // how often the player opens with each move (for pre-empt reads)
  openings: Record<string, number>;
  totalOpens: number;
}

export class EnemyAI {
  decision = 0;
  mode: Mode = "approach";
  retreatTimer = 0;
  blockTimer = 0;
  comboLeft = 0;
  nextAttack: AttackKind | null = null;
  recoverTimer = 0;

  oppWasAttacking = false;
  oppWasAirborne = false;
  oppAttackMissed = false; // player whiffed — punish window
  oppAttackMissedTimer = 0;
  pendingBlock = false;
  pendingRoll = false;
  pendingRollDir: 1 | -1 = 1;
  pendingAntiAir = false;
  reactTimer = 0;

  jumpCooldown = 1.5;
  blockStringCount = 0; // consecutive blocks — used to trigger mixups

  // adaptive habit memory
  private habit: HabitTracker = {
    punchCount: 0,
    kickCount: 0,
    rhCount: 0,
    jumpCount: 0,
    blockCount: 0,
    lastMove: null,
    openings: {},
    totalOpens: 0,
  };

  constructor(public def: OpponentDef) {}

  reset() {
    this.decision = 0.5 + Math.random() * 0.3;
    this.mode = "approach";
    this.retreatTimer = 0;
    this.blockTimer = 0;
    this.comboLeft = 0;
    this.nextAttack = null;
    this.recoverTimer = 0;
    this.oppWasAttacking = false;
    this.oppWasAirborne = false;
    this.oppAttackMissed = false;
    this.oppAttackMissedTimer = 0;
    this.pendingBlock = false;
    this.pendingRoll = false;
    this.pendingAntiAir = false;
    this.reactTimer = 0;
    this.jumpCooldown = 1.5;
    this.blockStringCount = 0;
    this.habit = {
      punchCount: 0,
      kickCount: 0,
      rhCount: 0,
      jumpCount: 0,
      blockCount: 0,
      lastMove: null,
      openings: {},
      totalOpens: 0,
    };
  }

  // Snapshot of the AI's live state for the transparency HUDs
  // (DirectorPanel, DirectorNarration, AIGenomeHud, AIDecisionTicker).
  // Read once per RAF tick from React components.
  getState() {
    return {
      mode: this.mode,
      nextAttack: this.nextAttack,
      selfHpFrac: this.selfHpFrac,
      comboLeft: this.comboLeft,
      rageActive: this.selfHpFrac > 0 && this.selfHpFrac < 0.3,
      inPunishWindow: this.oppAttackMissed && this.oppAttackMissedTimer > 0,
      habit: { ...this.habit },
    };
  }

  // effective stats, modified by rage (low HP → faster, more aggressive)
  private eff(key: "aggression" | "blockChance" | "speedMul"): number {
    const base = this.def[key];
    if (key === "aggression") {
      const rageBoost =
        this.selfHpFrac < 0.3 ? this.def.rage * 0.25 : 0;
      return Math.min(0.98, base + rageBoost);
    }
    if (key === "speedMul") {
      const rageBoost =
        this.selfHpFrac < 0.3 ? this.def.rage * 0.12 : 0;
      return base + rageBoost;
    }
    return base;
  }

  private selfHpFrac = 1; // updated each frame

  update(dt: number, self: Fighter, opp: Fighter): InputState {
    const input: InputState = {
      left: false,
      right: false,
      up: false,
      down: false,
      punch: false,
      kick: false,
      roundhouse: false,
      roll: false,
      block: false,
      super: false,
      throw: false,
    };

    this.selfHpFrac = self.hp / self.maxHp;

    // track player habits (adaptive memory)
    this.trackHabit(opp);

    // Can't do anything while committed.
    if (!self.canAct()) {
      this.oppWasAttacking = opp.isAttacking();
      this.oppWasAirborne = !opp.onGround;
      return input;
    }

    const dist = opp.x - self.x;
    const adist = Math.abs(dist);
    const dirToOpp = dist >= 0 ? 1 : -1;

    // ---- super move: if the rage meter is full and we're in range, let it
    // rip. The fighter handles edge-triggering + meter drain, so just set
    // the flag once we decide it's worth using. ----
    if (self.rageMeter >= self.RAGE_MAX && adist < 120) {
      input.super = true;
      return input;
    }

    // ---- throw: break pure turtling at grab range ----
    const throwChance =
      ((this.def.mixup ?? 0) * 0.35 + (this.def.pressure ?? 0) * 0.25) *
      (this.blockStringCount >= 2 ? 1.6 : 1);
    if (
      adist < 52 &&
      opp.isThrowable() &&
      (opp.isBlocking() || this.blockStringCount >= 2) &&
      Math.random() < Math.min(0.55, 0.12 + throwChance)
    ) {
      input.throw = true;
      this.blockStringCount = 0;
      this.decision = 0.4 + Math.random() * 0.25;
      return input;
    }

    // ---- whiff-punish window: if the player's attack just ended without
    // hitting us, dash in and punish. ----
    if (this.oppAttackMissedTimer > 0) {
      this.oppAttackMissedTimer -= dt;
      if (
        this.oppAttackMissed &&
        Math.random() < (this.def.whiffPunish ?? 0) &&
        adist < 130
      ) {
        // close distance fast and counter-attack
        if (adist > 56) {
          if (dirToOpp === 1) input.right = true;
          else input.left = true;
        } else {
          input.kick = true; // punish with a kick
        }
        this.oppAttackMissed = false;
        return input;
      }
    }

    // ---- anti-air: if the player jumps near us, meet them with a kick. ----
    const oppAirborne = !opp.onGround;
    if (
      oppAirborne &&
      !this.oppWasAirborne &&
      adist < 150 &&
      Math.random() < (this.def.antiAir ?? 0)
    ) {
      this.pendingAntiAir = true;
      this.reactTimer = Math.max(0.05, this.def.reaction * 0.6);
    }
    this.oppWasAirborne = oppAirborne;
    if (this.pendingAntiAir) {
      this.reactTimer -= dt;
      if (this.reactTimer <= 0) {
        // jump-kick toward the airborne player
        input.up = true;
        if (dirToOpp === 1) input.right = true;
        else input.left = true;
        input.kick = true;
        this.pendingAntiAir = false;
        return input;
      }
    }

    // ---- defensive reaction to a new player attack ----
    const oppAttacking = opp.isAttacking();
    if (oppAttacking && !this.oppWasAttacking) {
      if (adist < 170) {
        const blockC = this.eff("blockChance");
        // frame-perfect block chance on top of normal reaction
        const perfect = Math.random() < (this.def.perfection ?? 0);
        const r = Math.random();
        if (perfect || r < blockC * 0.5) {
          // block
          this.pendingBlock = true;
          this.reactTimer = perfect ? 0 : this.def.reaction;
        } else if (r < blockC) {
          // roll-dodge away
          const away = dirToOpp === 1 ? -1 : 1;
          this.pendingRollDir = away;
          this.pendingRoll = true;
          this.reactTimer = this.def.reaction;
        }
      }
    }
    this.oppWasAttacking = oppAttacking;

    if (this.pendingRoll) {
      this.reactTimer -= dt;
      if (this.reactTimer <= 0) {
        input.roll = true;
        if (this.pendingRollDir === 1) input.right = true;
        else input.left = true;
        this.pendingRoll = false;
        this.recoverTimer = 0.3;
        return input;
      }
    }
    if (this.pendingBlock) {
      this.reactTimer -= dt;
      if (this.reactTimer <= 0) {
        this.mode = "block";
        this.blockTimer = 0.35 + Math.random() * 0.25;
        this.pendingBlock = false;
      }
    }

    // ---- active block ----
    if (this.blockTimer > 0) {
      this.blockTimer -= dt;
      input.block = true;
      // high-pressure opponents release the block early to punish
      if (
        this.blockTimer < 0.15 &&
        Math.random() < (this.def.pressure ?? 0) * 0.4 &&
        adist < 100
      ) {
        // interrupt block into a counter
        input.block = false;
        input.punch = true;
        this.blockTimer = 0;
        this.blockStringCount++;
        return input;
      }
      return input;
    }
    if (this.mode === "block" && this.blockTimer <= 0) this.mode = "approach";

    // ---- retreat (kiting / zoning) ----
    this.retreatTimer -= dt;
    if (this.retreatTimer > 0) {
      if (dirToOpp === 1) input.left = true;
      else input.right = true;
      return input;
    }

    // ---- continue an in-progress combo string ----
    const inPunch = adist < 66;
    const inKick = adist < 100;
    const inRound = adist < 106;
    if (this.comboLeft > 0 && (inPunch || inKick)) {
      const choice = this.nextAttack ?? (inPunch ? "punch" : "kick");
      if (choice === "punch") input.punch = true;
      else if (choice === "kick") input.kick = true;
      else input.roundhouse = true;
      this.comboLeft -= 1;
      this.nextAttack = null;
      // recovery gap — high-pressure opponents keep it tight; weak ones pause
      const pressureGap = (1 - (this.def.pressure ?? 0)) * (0.55 + Math.random() * 0.5);
      this.decision = pressureGap;
      this.recoverTimer = pressureGap * 0.5;
      // choose the next hit in the string with mixup logic
      if (this.comboLeft > 0) {
        this.nextAttack = this.pickMixup(inPunch, inKick, inRound);
      }
      return input;
    }

    this.decision -= dt;
    this.jumpCooldown -= dt;
    if (this.recoverTimer > 0) this.recoverTimer -= dt;

    if (this.decision <= 0) {
      // decision cadence: higher pressure → shorter gaps
      this.decision =
        (0.45 - (this.def.pressure ?? 0) * 0.25) + Math.random() * 0.35;

      const aggr = this.eff("aggression");

      if ((inKick || inPunch) && this.recoverTimer <= 0) {
        const r = Math.random();
        if (r < aggr) {
          // open a combo string
          this.comboLeft = 1 + Math.floor(Math.random() * this.def.combo);
          this.nextAttack = this.pickOpener(inPunch, inKick, inRound);
          return input;
        } else if (r < aggr + (1 - (this.def.pressure ?? 0)) * 0.2) {
          // back-step (zoning reset)
          this.retreatTimer = 0.18 + Math.random() * 0.28;
          return input;
        } else {
          // stand & maybe bait with a guard
          if (Math.random() < this.eff("blockChance") * 1.3) {
            this.mode = "block";
            this.blockTimer = 0.25 + Math.random() * 0.3;
          }
          this.decision = 0.3 + Math.random() * 0.3;
          return input;
        }
      } else {
        // out of range: approach (or jump-in for aggressive AIs)
        this.mode = "approach";
        if (
          adist > 230 &&
          this.jumpCooldown <= 0 &&
          Math.random() < 0.25 + (this.def.pressure ?? 0) * 0.3
        ) {
          input.up = true;
          this.jumpCooldown = 1.2 + Math.random();
        }
      }
    }

    // ---- default movement: approach or zone to optimal range ----
    if (this.recoverTimer <= 0) {
      // strong opponents hold their optimal spacing instead of always rushing in
      const optimal = this.def.mixup && this.def.mixup > 0.45 ? 92 : 60;
      if (adist > optimal + 8) {
        if (dirToOpp === 1) input.right = true;
        else input.left = true;
      } else if (adist < optimal - 14) {
        // too close — back off slightly (spacing)
        if (dirToOpp === 1) input.left = true;
        else input.right = true;
      }
    }
    return input;
  }

  // ---- choose the opening attack of a string (with adaptive reads) ----
  private pickOpener(inPunch: boolean, inKick: boolean, inRound: boolean): AttackKind {
    const adapt = this.def.adaptive ?? 0;
    // if the player has been blocking a lot, open with a mixup (kick/roundhouse)
    const playerBlocksALot =
      this.habit.totalOpens > 4 &&
      (this.habit.openings["block"] ?? 0) / this.habit.totalOpens > 0.4;
    if (playerBlocksALot && Math.random() < adapt * 0.6) {
      // Low kick under stand block, or roundhouse as slower mixup
      if (inKick && Math.random() < 0.55) return "kick";
      if (inRound) return "roundhouse";
      if (inKick) return "kick";
    }
    // if the player tends to jump, pre-empt with a kick (anti-air-ish opener)
    const playerJumpsALot =
      this.habit.totalOpens > 4 &&
      (this.habit.openings["jump"] ?? 0) / this.habit.totalOpens > 0.3;
    if (playerJumpsALot && Math.random() < adapt * 0.5 && inKick) {
      return "kick";
    }
    // otherwise pick based on range + mixup tendency
    return this.pickMixup(inPunch, inKick, inRound);
  }

  // ---- choose a follow-up hit with mixup (high/low/fast/slow) ----
  private pickMixup(inPunch: boolean, inKick: boolean, inRound: boolean): AttackKind {
    const mix = this.def.mixup ?? 0;
    // strong opponents throw roundhouses as mixup finishers
    if (inRound && this.def.aggression > 0.6 && Math.random() < mix * 0.4) {
      return "roundhouse";
    }
    // alternate fast/slow: if last was a punch, tend to kick and vice versa
    const last = this.habit.lastMove;
    if (Math.random() < 0.5 + mix * 0.3) {
      if (last === "punch" && inKick) return "kick";
      if ((last === "kick" || last === "roundhouse") && inPunch) return "punch";
    }
    if (inPunch && Math.random() < 0.6) return "punch";
    if (inKick) return "kick";
    return inPunch ? "punch" : "kick";
  }

  // ---- track player behaviour for the adaptive system ----
  private trackHabit(opp: Fighter) {
    const attacking = opp.isAttacking();
    const airborne = !opp.onGround;
    const blocking = opp.isBlocking();

    // detect a new player action (opening)
    const justAttacked = attacking && !this.oppWasAttacking;
    if (justAttacked) {
      const kind = opp.currentAttack ?? "punch";
      // super is tracked as a heavy roundhouse for the habit memory
      const tracked: AttackKind = kind === "kick" ? "kick" : kind === "punch" ? "punch" : "roundhouse";
      if (tracked === "punch") this.habit.punchCount++;
      else if (tracked === "kick") this.habit.kickCount++;
      else this.habit.rhCount++;
      this.habit.openings[tracked] = (this.habit.openings[tracked] ?? 0) + 1;
      this.habit.totalOpens++;
      this.habit.lastMove = tracked;
    }
    if (airborne && !this.oppWasAirborne) {
      this.habit.jumpCount++;
      this.habit.openings["jump"] = (this.habit.openings["jump"] ?? 0) + 1;
      this.habit.totalOpens++;
      this.habit.lastMove = "jump";
    }
    if (blocking && this.habit.lastMove !== "block") {
      this.habit.blockCount++;
      this.habit.openings["block"] = (this.habit.openings["block"] ?? 0) + 1;
      this.habit.totalOpens++;
      this.habit.lastMove = "block";
    }

    // detect whiff: player was attacking, now isn't, and we didn't get hit
    // (approximated: attack ended → mark a punish window)
    if (this.oppWasAttacking && !attacking) {
      this.oppAttackMissed = true;
      this.oppAttackMissedTimer = 0.22;
    }
  }
}
