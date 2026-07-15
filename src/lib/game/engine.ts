// Game engine: match/round flow, collision resolution, particles, effects.

import { Fighter } from "./fighter";
import { EnemyAI } from "./ai";
import { OPPONENTS } from "./config/opponents";
import { GROUND_Y, STAGE_LEFT, STAGE_RIGHT } from "./config/physics";
import {
  HIT_VFX,
  HEAVY_HIT_ZOOM,
  HEAVY_HIT_CHROM_AB,
  HEAVY_HIT_SLOWMO,
  KO_VFX,
  DECAY,
  COMBO_TIMER,
} from "./config/vfx";
import { HAZARDS } from "./config/hazards";
import type {
  BackgroundId,
  FloatingText,
  InputState,
  OpponentDef,
  Particle,
  Phase,
} from "./types";
import {
  buildDirectorState,
  applyAIIntent,
  applyDirectorCombatIntent,
  type RuntimeIntentOutput,
  type DirectorRuntimeState,
} from "./director/DirectorRuntime";

// Re-export the roster + round config so existing imports from "./engine"
// (e.g. `import { OPPONENTS, ROUNDS_TO_WIN } from "./engine"`) keep working.
export { OPPONENTS };

export const ROUND_TIME = 60;
export const ROUNDS_TO_WIN = 2;

export interface Announcement {
  main: string;
  sub?: string;
  timer: number;
  big?: boolean;
}

export interface Shockwave {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

export type VFXEventKind = "hit" | "heavy" | "block" | "ko";
export interface VFXEvent {
  kind: VFXEventKind;
  x: number;
  y: number;
  hitType: "punch" | "kick" | "roundhouse" | "super" | "throw" | null;
}

export class GameEngine {
  player: Fighter;
  enemy: Fighter;
  ai: EnemyAI;

  opponentIndex = 0;
  sceneOverride: BackgroundId | null = null;
  phase: Phase = "menu";
  roundNo = 1;
  playerWins = 0;
  enemyWins = 0;
  roundTimer = ROUND_TIME;

  particles: Particle[] = [];
  texts: FloatingText[] = [];
  shockwaves: Shockwave[] = [];
  shake = 0;
  hitstop = 0;
  time = 0; // global elapsed (for bg effects)
  flash = 0;
  flashColor = "#ffffff";
  slowmo = 0;
  zoom = 0; // punch-zoom impulse (0..1)
  chromAb = 0;

  playerCombo = 0;
  playerComboTimer = 0;
  maxCombo = 0;

  announce: Announcement | null = null;
  phaseTimer = 0;

  // VFX/audio events drained by the component each frame
  events: VFXEvent[] = [];

  // Director runtime state — drives weather, lighting, camera, hazards,
  // for the current match. Built from the DirectorRuntime
  // intent table. Read by the renderer; the engine consumes hazards
  // (slip / chip / darkness) directly.
  directorState: DirectorRuntimeState = buildDirectorState(0);

  // Accumulates the base camera shake from the Director so it can be
  // mixed with combat hit-shake in the renderer.
  directorBaseShake = 0;
  directorBaseZoomBoost = 0;

  // ---- GA champion genome ----
  // The champion is the AI brain produced by the offline Genetic
  // Algorithm. When the toggle is on, the engine overlays the
  // champion's genes onto the current opponent's AI definition.
  useChampionGenome = false;
  championOverride: {
    id: string | null;
    source: string;
    generation: number;
    version: string | null;
    // `genes` is optional — when the API returns an error envelope, or
    // before the genome file has been generated, this stays undefined
    // and the engine falls back to baseline instead of crashing.
    genes?: Record<string, number>;
    fitnessHistory: number[];
  } | null = null;

  input: InputState = {
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

  // second-player input (used when twoPlayer mode is active)
  p2Input: InputState = {
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

  // when true, `enemy` is human-controlled via p2Input instead of by the AI
  twoPlayer = false;

  // Practice mode: offline Director, no tournament progression; optional infinite HP.
  practiceMode = false;
  practiceInfiniteHp = false;

  // Photosensitivity: scales flash / chromatic aberration (set from UI settings).
  photosensitive = false;

  // for edge-triggered player attacks we mirror into fighter; fighter handles edges.
  constructor() {
    this.player = new Fighter({
      x: 360,
      isPlayer: true,
      facing: 1,
      maxHp: 120,
      rim: "#e2e8f0",
      name: "The Shadow",
      damageMul: 1.15,
      blade: true,
    });
    this.enemy = this.makeEnemy(0);
    this.ai = new EnemyAI(OPPONENTS[0]);
  }

  private makeEnemy(index: number): Fighter {
    const def = OPPONENTS[index];
    return new Fighter({
      x: 600,
      isPlayer: false,
      facing: -1,
      maxHp: def.hp,
      rim: def.rim,
      name: def.name,
      damageMul: def.damageMul,
      speedMul: def.speedMul,
      blade: def.blade,
      bodyType: def.bodyType,
    });
  }

  get opponent() {
    return OPPONENTS[this.opponentIndex];
  }

  get scene(): BackgroundId {
    return this.sceneOverride ?? this.opponent.bg;
  }

  // ---- Flow control ----
  // Tournament: start from the first opponent and progress through all eight.
  startMatch() {
    this.practiceMode = false;
    this.practiceInfiniteHp = false;
    this.startMatchWith(0);
  }

  // Build a fresh Director runtime plan for the current opponent and
  // stage it on the engine. Called by every match-start path
  // (startMatchWith, nextOpponent, retryMatch, startTwoPlayer). The
  // renderer reads directorState; the engine consumes
  // directorState.hazards (slip / chip / darkness) inside updateHazards().
  applyDirectorPlan() {
    this.directorState = buildDirectorState(this.opponentIndex);
    this.directorBaseShake = this.directorState.camera.baseShake;
    this.directorBaseZoomBoost = this.directorState.camera.baseZoomBoost;
  }

  setDirectorThinking() {
    // Qwen is the sole Director. Keep the stage neutral until its plan arrives
    // instead of displaying the deterministic bootstrap as an AI decision.
    this.directorState.weather = { ...this.directorState.weather, type: "none", rate: 0 };
    this.directorState.lighting = { ...this.directorState.lighting, intensity: 0 };
    this.directorState.camera = { baseShake: 0, baseZoomBoost: 0 };
    this.directorState.hazards = { slipFactor: 0, chipDamage: 0, darkness: 0 };
    this.directorBaseShake = 0;
    this.directorBaseZoomBoost = 0;
    this.applyCombatPlanToCurrentAI(false);
    this.setAnnounce("QWEN DIRECTOR", "Preparing the live plan before the fight begins", 999, true);
    this.directorState.ai = {
      ...this.directorState.ai,
      status: "thinking",
      model: "Qwen 2.5 1.5B · fine-tuned · Modal",
      intent: "Qwen is thinking…",
      reasoning: "Cold-starting the model and analysing the player, chapter, and encounter context.",
      expectedPlayerReaction: "Pending Qwen's prediction.",
      highLevelPlan: "No Director plan has been applied yet.",
      confidence: 0,
      latencyMs: null,
      requestedAt: Date.now(),
      error: undefined,
    };
  }

  applyAIIntent(output: RuntimeIntentOutput, model: string, latencyMs: number) {
    this.directorState = applyAIIntent(this.directorState, output, { model, latencyMs });
    this.directorBaseShake = this.directorState.camera.baseShake;
    this.directorBaseZoomBoost = this.directorState.camera.baseZoomBoost;
    this.applyCombatPlanToCurrentAI(true);
    if (this.phase === "intro") {
      this.setAnnounce("DIRECTOR READY", "Qwen plan applied to weather, hazards, camera, and opponent AI", 1.2, true);
    }
  }

  /**
   * Prefer live Qwen; when it fails or times out, unlock the fight with a
   * deterministic Classic Director plan. Never soft-lock single-player intro.
   * Status stays "fallback" so UI never pretends this is live Qwen.
   */
  setDirectorFallback(error: string) {
    const offline = buildDirectorState(this.opponentIndex);
    this.directorState = {
      ...offline,
      ai: {
        status: "fallback",
        model: "Classic Director · offline",
        intent: offline.intent,
        reasoning: `Live Qwen unavailable (${error}). Using the chapter's deterministic Director plan for weather, lighting, camera, hazards, and baseline AI.`,
        expectedPlayerReaction: offline.ai.expectedPlayerReaction,
        highLevelPlan: offline.ai.highLevelPlan,
        confidence: 0.55,
        latencyMs: null,
        error,
      },
    };
    this.directorBaseShake = this.directorState.camera.baseShake;
    this.directorBaseZoomBoost = this.directorState.camera.baseZoomBoost;
    // Mild theme blend so offline fights still feel directed, without claiming live AI.
    this.applyCombatPlanToCurrentAI(true);
    if (this.phase === "intro") {
      this.setAnnounce(
        "CLASSIC DIRECTOR",
        "Offline plan applied — the fight begins",
        1.4,
        true,
      );
      // Ensure intro can advance immediately after the announce window.
      this.phaseTimer = Math.min(this.phaseTimer, 1.4);
    }
  }

  /** Instant offline Director for practice / tutorial (no Qwen wait). */
  applyOfflineDirector(reason = "Practice mode uses the Classic Director.") {
    this.setDirectorFallback(reason);
  }

  // ---- GA champion methods ----
  // Build a champion opponent def by overlaying the GA-evolved genes
  // onto the current opponent's body stats. The visual / health
  // parameters stay unchanged; only AI behaviour genes change.
  private buildChampionDef(): OpponentDef | null {
    if (!this.championOverride) return null;
    const base = OPPONENTS[this.opponentIndex];
    // genes may be missing if a malformed payload was loaded — fall
    // back to baseline in that case rather than crashing.
    const g = this.championOverride.genes ?? {};
    const num = (k: keyof OpponentDef, fallback: number): number =>
      typeof g[k as unknown as string] === "number"
        ? (g[k as unknown as string] as number)
        : fallback;
    return {
      ...base,
      name: `${base.name}·GA`,
      title: "The GA-Tuned Shadow",
      aggression: num("aggression", base.aggression),
      blockChance: num("blockChance", base.blockChance),
      reaction: num("reaction", base.reaction),
      combo: Math.round(num("combo", base.combo)),
      whiffPunish: num("whiffPunish", base.whiffPunish ?? 0),
      antiAir: num("antiAir", base.antiAir ?? 0),
      pressure: num("pressure", base.pressure ?? 0),
      mixup: num("mixup", base.mixup ?? 0),
      adaptive: num("adaptive", base.adaptive ?? 0),
      rage: num("rage", base.rage ?? 0),
      perfection: num("perfection", base.perfection ?? 0),
      readDelay: num("readDelay", base.readDelay ?? 0),
    };
  }

  // True when the live AI is currently running on champion (GA) genes.
  get isChampionMode(): boolean {
    return this.useChampionGenome && !!this.championOverride;
  }

  // Apply the champion override to the current AI in place — preserves
  // the adaptive habit memory. If no champion is loaded, falls back
  // to baseline.
  applyChampionToCurrentAI() {
    if (this.useChampionGenome && this.championOverride) {
      const def = this.buildChampionDef();
      if (def) {
        this.ai.def = this.directorCombatActive()
          ? applyDirectorCombatIntent(def, this.directorState.intent, this.directorState.ai.confidence)
          : def;
        this.ai.reset();
        return;
      }
    }
    const base = OPPONENTS[this.opponentIndex];
    this.ai.def = this.directorCombatActive()
      ? applyDirectorCombatIntent(base, this.directorState.intent, this.directorState.ai.confidence)
      : base;
    this.ai.reset();
  }

  /** Live Qwen or Classic (fallback) Director — both may apply combat themes. */
  private directorCombatActive(): boolean {
    const s = this.directorState.ai.status;
    return s === "live" || s === "fallback";
  }

  private applyCombatPlanToCurrentAI(live: boolean) {
    if (this.twoPlayer || !this.ai) return;
    const base = this.useChampionGenome ? this.buildChampionDef() : OPPONENTS[this.opponentIndex];
    if (!base) return;
    this.ai.def = live
      ? applyDirectorCombatIntent(base, this.directorState.intent, this.directorState.ai.confidence)
      : base;
    // Do not reset here: a plan can arrive mid-round and the opponent should
    // retain what it has already learned about the player's habits.
  }

  private shouldHoldIntroForDirector(): boolean {
    // Only hold while Qwen is thinking. live and fallback both unlock the fight.
    // Practice / two-player never hold.
    if (this.twoPlayer || this.practiceMode) return false;
    return this.directorState.ai.status === "thinking";
  }

  // Load the champion genome payload (called once from the UI on mount).
  // If the payload is missing the .genes record (e.g. an API error
  // envelope was passed in), fall back to disabling GA so the toggle
  // can't crash the engine.
  setChampionOverride(payload: GameEngine["championOverride"]) {
    if (!payload || !payload.genes || typeof payload.genes !== "object") {
      this.championOverride = null;
      this.useChampionGenome = false;
      return;
    }
    this.championOverride = payload;
    if (this.useChampionGenome) this.applyChampionToCurrentAI();
  }

  // Toggle GA champion mode. When a match is in progress, hot-swaps the AI.
  // Only enables when a champion payload with actual genes has been
  // loaded — otherwise the button is silently disabled.
  setUseChampionGenome(on: boolean) {
    const hasGenes =
      !!this.championOverride &&
      !!this.championOverride.genes &&
      typeof this.championOverride.genes === "object";
    const wasOn = this.useChampionGenome;
    this.useChampionGenome = !!on && hasGenes;
    if (wasOn !== this.useChampionGenome) {
      this.applyChampionToCurrentAI();
    }
  }

  // Free select: jump straight to a chosen opponent (and optional scene).
  startMatchWith(index: number, bg?: BackgroundId | null) {
    this.opponentIndex = Math.max(0, Math.min(OPPONENTS.length - 1, index));
    this.sceneOverride = bg ?? null;
    this.twoPlayer = false;
    this.practiceMode = false;
    this.practiceInfiniteHp = false;
    this.applyDirectorPlan();
    this.ai = new EnemyAI(OPPONENTS[this.opponentIndex]);
    this.applyChampionToCurrentAI();
    this.enemy = this.makeEnemy(this.opponentIndex);
    this.playerWins = 0;
    this.enemyWins = 0;
    this.roundNo = 1;
    this.maxCombo = 0;
    this.startRound();
  }

  /**
   * Practice mode: offline Classic Director immediately, no Qwen wait.
   * Dummy AI still fights; optional infinite player HP.
   */
  startPractice(index = 0, infiniteHp = true) {
    this.opponentIndex = Math.max(0, Math.min(OPPONENTS.length - 1, index));
    this.sceneOverride = null;
    this.twoPlayer = false;
    this.practiceMode = true;
    this.practiceInfiniteHp = infiniteHp;
    this.applyOfflineDirector("Practice mode — Classic Director (no live Qwen).");
    this.ai = new EnemyAI(OPPONENTS[this.opponentIndex]);
    this.applyChampionToCurrentAI();
    this.enemy = this.makeEnemy(this.opponentIndex);
    this.playerWins = 0;
    this.enemyWins = 0;
    this.roundNo = 1;
    this.maxCombo = 0;
    this.startRound();
  }

  // Two-player versus: spawn a second human-controlled shadow fighter
  // (mirrored stats) instead of an AI opponent. Plays on the current scene.
  startTwoPlayer() {
    this.twoPlayer = true;
    this.practiceMode = false;
    this.practiceInfiniteHp = false;
    this.sceneOverride = this.sceneOverride ?? "sunset";
    this.enemy = new Fighter({
      x: 600,
      isPlayer: false,
      facing: -1,
      maxHp: this.player.maxHp,
      rim: "#f87171",
      name: "Player 2",
      damageMul: 1.15,
      blade: true,
      bodyType: "lean",
    });
    this.applyDirectorPlan();
    this.playerWins = 0;
    this.enemyWins = 0;
    this.roundNo = 1;
    this.maxCombo = 0;
    this.startRound();
  }

  // Skip straight to the destruction ending: jump to the final opponent,
  // then immediately advance to the champion phase (bypasses the tournament).
  skipToChampion() {
    this.opponentIndex = OPPONENTS.length - 1;
    this.nextOpponent();
  }

  // Return to the menu (abandon current match).
  toMenu() {
    this.phase = "menu";
    this.announce = null;
    this.practiceMode = false;
    this.practiceInfiniteHp = false;
    this.player.reset(360, 1);
    this.enemy.reset(600, -1);
    this.particles = [];
    this.texts = [];
    this.shockwaves = [];
    this.events = [];
  }

  nextOpponent() {
    this.opponentIndex += 1;
    if (this.opponentIndex >= OPPONENTS.length) {
      this.phase = "champion";
      this.phaseTimer = 0;
      this.setAnnounce("CHAMPION", "You are the Shadow Lord", 999, true);
      return;
    }
    this.twoPlayer = false;
    this.applyDirectorPlan();
    this.ai = new EnemyAI(OPPONENTS[this.opponentIndex]);
    this.applyChampionToCurrentAI();
    this.enemy = this.makeEnemy(this.opponentIndex);
    this.playerWins = 0;
    this.enemyWins = 0;
    this.roundNo = 1;
    this.startRound();
  }

  // Retry the current opponent from round 1 (after a game over).
  retryMatch() {
    this.twoPlayer = false;
    this.applyDirectorPlan();
    this.ai = new EnemyAI(OPPONENTS[this.opponentIndex]);
    this.applyChampionToCurrentAI();
    this.enemy = this.makeEnemy(this.opponentIndex);
    this.playerWins = 0;
    this.enemyWins = 0;
    this.roundNo = 1;
    this.maxCombo = 0;
    this.startRound();
  }

  startRound() {
    this.player.reset(360, 1);
    this.enemy.reset(600, -1);
    if (!this.twoPlayer) this.ai.reset();
    this.roundTimer = ROUND_TIME;
    this.particles = [];
    this.texts = [];
    this.shockwaves = [];
    this.shake = 0;
    this.hitstop = 0;
    this.slowmo = 0;
    this.zoom = 0;
    this.chromAb = 0;
    this.flash = 0;
    this.phase = "intro";
    this.phaseTimer = 2.2;
    // Round 1 of a fresh match: a boss-intro beat — announce the opponent
    // by name + title and snap the camera into a slow zoom-out + flash.
    if (this.roundNo === 1 && !this.twoPlayer) {
      const ann = this.opponent;
      this.setAnnounce(
        ann.name.toUpperCase(),
        ann.title,
        2.4,
        true,
      );
      this.zoom = 0.3;
      this.flash = 0.5;
      this.flashColor = this.opponent.rim;
    } else {
      this.setAnnounce(`ROUND ${this.roundNo}`, this.vsText(), 2.2, true);
    }
  }

  private vsText() {
    return `The Shadow vs ${this.opponent.name} — ${this.opponent.title}`;
  }

  private setAnnounce(
    main: string,
    sub?: string,
    timer = 1.4,
    big = false,
  ) {
    this.announce = { main, sub, timer, big };
  }

  // Called by component each frame.
  update(dtRaw: number) {
    const dt = Math.min(dtRaw, 1 / 30); // clamp big steps
    this.time += dt;
    if (this.flash > 0) this.flash -= dt * DECAY.flash;
    // Director base shake is a constant ambient level set by the
    // intent. The combat hit-shake is additive on top.
    if (this.directorBaseShake > 0) {
      this.shake = Math.max(this.shake, this.directorBaseShake * 4);
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * DECAY.shake);
    // Director base zoom boost — applied as a floor under the punch-zoom
    // impulse so the intent's "zoom in" stays visible during calm beats.
    if (this.directorBaseZoomBoost > 0) {
      this.zoom = Math.max(this.zoom, this.directorBaseZoomBoost);
    }
    if (this.zoom > 0) this.zoom = Math.max(0, this.zoom - dt * DECAY.zoom);
    if (this.chromAb > 0) this.chromAb = Math.max(0, this.chromAb - dt * DECAY.chromAb);
    if (this.slowmo > 0) this.slowmo = Math.max(0, this.slowmo - dt);
    if (this.announce) {
      this.announce.timer -= dt;
      if (this.announce.timer <= 0) this.announce = null;
    }

    this.updateParticles(dt);
    this.updateTexts(dt);
    this.updateShockwaves(dt);
    this.updateDirectorWeather(dt);

    // combo decay
    if (this.playerComboTimer > 0) {
      this.playerComboTimer -= dt;
      if (this.playerComboTimer <= 0) {
        this.playerCombo = 0;
      }
    }

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return; // freeze fighters during impact
    }

    // slow-motion scales fighter simulation only (VFX keep real time)
    const simDt = this.slowmo > 0 ? dt * 0.3 : dt;

    switch (this.phase) {
      case "menu":
        // idle pose on menu
        this.player.update(simDt, null, this.enemy);
        this.enemy.update(simDt, null, this.player);
        break;
      case "intro":
        if (this.shouldHoldIntroForDirector()) {
          this.player.update(simDt, null, this.enemy);
          this.enemy.update(simDt, null, this.player);
          this.phaseTimer = Math.max(this.phaseTimer, 0.25);
          break;
        }
        this.player.update(simDt, null, this.enemy);
        this.enemy.update(simDt, null, this.player);
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.phase = "fight";
          this.setAnnounce("FIGHT!", undefined, 0.9, true);
        }
        break;
      case "fight":
        this.updateFight(dt, simDt);
        break;
      case "round_end":
        this.player.update(simDt, null, this.enemy);
        this.enemy.update(simDt, null, this.player);
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.afterRoundEnd();
        break;
      case "match_end":
        this.player.update(simDt, null, this.enemy);
        this.enemy.update(simDt, null, this.player);
        break;
      case "game_over":
      case "champion":
        this.player.update(simDt, null, this.enemy);
        this.enemy.update(simDt, null, this.player);
        break;
    }
  }

  private updateFight(dt: number, simDt: number) {
    // Enemy input source depends on mode:
    //  - two-player: second human's p2Input
    //  - default: rule-based EnemyAI
    let enemyInput: InputState;
    if (this.twoPlayer) {
      enemyInput = this.p2Input;
    } else {
      enemyInput = this.ai.update(simDt, this.enemy, this.player);
    }
    this.player.update(simDt, this.input, this.enemy);
    this.enemy.update(simDt, enemyInput, this.player);

    if (this.practiceInfiniteHp) {
      this.player.hp = this.player.maxHp;
    }

    this.player.separateFrom(this.enemy);

    this.resolveAttack(this.player, this.enemy);
    this.resolveAttack(this.enemy, this.player);

    // environmental hazards (volcano / snow / temple)
    this.updateHazards(dt);

    // round timer (real time)
    this.roundTimer -= dt;
    if (this.roundTimer <= 0) {
      this.roundTimer = 0;
      this.endRoundByTime();
      return;
    }
    if (this.player.hp <= 0 || this.enemy.hp <= 0) {
      this.endRoundByKO();
    }
  }

  // Per-arena environmental hazards: volcano scorches fighters near the edges,
  // snow reduces traction (friction), temple drops debris from above.
  // All tuning lives in config/hazards.ts.
  // Director-planned hazards (chip damage / slip / darkness) are layered
  // on top of the per-arena effects so every intent has measurable
  // environmental consequences.
  private updateHazards(dt: number) {
    const scene = this.scene;
    const dh = this.directorState?.hazards;
    if (scene === "volcano") {
      const cfg = HAZARDS.volcano;
      // burning edges — chip damage when standing on the stage apron
      for (const f of [this.player, this.enemy]) {
        const nearEdge =
          f.x <= STAGE_LEFT + cfg.edgeThreshold ||
          f.x >= STAGE_RIGHT - cfg.edgeThreshold;
        if (nearEdge && f.onGround && f.invuln <= 0 && f.hp > 0) {
          f.hp = Math.max(0, f.hp - cfg.chipDamage * dt);
          // ember sparks at the feet
          if (Math.random() < dt * cfg.emberRate) {
            this.particles.push({
              x: f.x + (Math.random() - 0.5) * 18,
              y: GROUND_Y - 2,
              vx: (Math.random() - 0.5) * 50,
              vy: -cfg.emberUpMin - Math.random() * cfg.emberUpRange,
              life: cfg.emberLife,
              maxLife: 0.5,
              size: 2 + Math.random() * 2,
              color:
                Math.random() < 0.5
                  ? cfg.emberColors[0]
                  : cfg.emberColors[1],
              kind: "spark",
              grav: cfg.emberGrav,
            });
          }
        }
      }
    } else if (scene === "snow") {
      const cfg = HAZARDS.snow;
      // reduced traction: bleed off horizontal velocity more slowly so fighters
      // slide further on stops and turns (apply a soft damping instead of the
      // normal ground friction handled inside the fighter).
      for (const f of [this.player, this.enemy]) {
        if (f.onGround && Math.abs(f.vx) > cfg.dustMinSpeed) {
          // tiny slip — preserves a fraction of momentum each frame
          f.vx *= 1 - cfg.slipFactor * dt;
        }
      }
      // gentle snow dust at the fighters' feet
      if (Math.random() < dt * cfg.dustRate) {
        for (const f of [this.player, this.enemy]) {
          if (!f.onGround) continue;
          this.particles.push({
            x: f.x + (Math.random() - 0.5) * 24,
            y: GROUND_Y - 1,
            vx: (Math.random() - 0.5) * 20,
            vy: -cfg.dustUpMin - Math.random() * cfg.dustUpRange,
            life: cfg.dustLife,
            maxLife: 0.8,
            size: 2 + Math.random() * 2,
            color: cfg.dustColor,
            kind: "dust",
            grav: cfg.dustGrav,
          });
        }
      }
    } else if (scene === "temple") {
      const cfg = HAZARDS.temple;
      // falling debris from the ceiling — a chip hazard for whoever it lands on
      if (Math.random() < dt * cfg.debrisRate) {
        const x = 120 + Math.random() * (STAGE_RIGHT - STAGE_LEFT - 80);
        this.particles.push({
          x,
          y: 40,
          vx: (Math.random() - 0.5) * cfg.debrisDrift,
          vy: cfg.debrisFallSpeed,
          life: cfg.debrisLife,
          maxLife: 1.8,
          size: cfg.debrisSize + Math.random() * cfg.debrisSizeRange,
          color: cfg.debrisColor,
          kind: "dust",
          grav: cfg.debrisGrav,
        });
        // schedule a hit check ~debrisDelay ms later when the debris reaches the floor
        const target = Math.abs(this.player.x - x) < 28 ? this.player
          : Math.abs(this.enemy.x - x) < 28 ? this.enemy
          : null;
        if (target && target.invuln <= 0 && target.hp > 0) {
          // small chip + flinch if the fighter is still there when it lands
          window.setTimeout(() => {
            if (
              this.phase !== "fight" ||
              target.hp <= 0
            )
              return;
            if (Math.abs(target.x - x) < cfg.debrisHitRadius && target.onGround) {
              target.hp = Math.max(0, target.hp - cfg.debrisDamage);
              target.hitstun = Math.max(target.hitstun, cfg.debrisHitstun);
              this.spawnSpark(x, GROUND_Y - 10, false, "roundhouse");
              this.shake = Math.max(this.shake, cfg.debrisShake);
            }
          }, cfg.debrisDelay);
        }
      }
    }

    // Director-planned hazards (layered on top of per-arena effects).
    // Chip damage = passive HP drain from environmental pressure.
    // Slip factor = bleed horizontal velocity slower (slippery ground).
    // Darkness = driven by the renderer as a screen overlay.
    if (dh && dh.chipDamage > 0) {
      for (const f of [this.player, this.enemy]) {
        if (f.onGround && f.invuln <= 0 && f.hp > 0) {
          f.hp = Math.max(0, f.hp - dh.chipDamage * dt);
        }
      }
    }
    if (dh && dh.slipFactor > 0) {
      // 0 = normal grip, 1 = no friction. Translate to a velocity
      // damping factor applied while grounded.
      const slipK = 1 - dh.slipFactor;
      for (const f of [this.player, this.enemy]) {
        if (f.onGround) {
          f.vx *= Math.max(0, Math.min(1, slipK + (1 - slipK) * 0.5));
        }
      }
    }
  }

  private resolveAttack(attacker: Fighter, defender: Fighter) {
    if (attacker.attackHasHit) return;
    const ab = attacker.attackBox();
    if (!ab) return;
    // Throws only connect at grab range against throwable defenders.
    if (ab.spec.type === "throw") {
      if (!defender.isThrowable()) return;
      const dist = Math.abs(attacker.x - defender.x);
      if (dist > ab.spec.range + 8) return;
    }
    const bb = defender.bodyBox();
    if (ab.spec.type !== "throw" && !rectsOverlap(ab.rect, bb)) return;
    if (ab.spec.type === "throw" && !rectsOverlap(ab.rect, bb) && Math.abs(attacker.x - defender.x) > ab.spec.range + 8) {
      return;
    }
    const hitX = defender.x - attacker.facing * 8;
    const hitY = GROUND_Y + ab.spec.height;
    const result = defender.takeHit(ab.spec, attacker.facing, attacker, (x, y, blocked) =>
      this.spawnSpark(x, y, blocked, ab.spec.type),
    );
    if (result.hit) {
      attacker.attackHasHit = true;
      const heavy =
        !result.blocked &&
        (ab.spec.type === "kick" ||
          ab.spec.type === "roundhouse" ||
          ab.spec.type === "super" ||
          ab.spec.type === "throw" ||
          result.dmg >= 16);
      // VFX — pick the right tuning row for the outcome / weight class
      const vfx = result.blocked
        ? HIT_VFX.blocked
        : heavy
          ? HIT_VFX.heavy
          : HIT_VFX.light;
      this.hitstop = vfx.hitstop;
      this.shake = Math.max(this.shake, vfx.shake);
      this.flash = vfx.flash;
      this.flashColor = result.blocked
        ? "#93c5fd"
        : attacker.rim;
      if (heavy) {
        this.zoom = HEAVY_HIT_ZOOM;
        this.chromAb = this.photosensitive ? HEAVY_HIT_CHROM_AB * 0.2 : HEAVY_HIT_CHROM_AB;
        if (this.photosensitive) this.flash *= 0.35;
        this.slowmo = HEAVY_HIT_SLOWMO;
      }
      const label = result.blocked
        ? "BLOCK"
        : ab.spec.type === "throw"
          ? "THROW"
          : `-${result.dmg}`;
      this.spawnDamageText(
        defender.x,
        bb.y - 10,
        label,
        result.blocked ? "#93c5fd" : heavy ? "#fde047" : "#fca5a5",
        heavy,
      );
      if (!result.blocked) {
        this.spawnRing(hitX, hitY);
        this.spawnShockwave(hitX, hitY, heavy ? 120 : 70, attacker.rim, heavy ? 5 : 3);
        if (heavy) this.spawnStreakBurst(hitX, hitY, 22, attacker.rim);
      }
      // audio/VFX event
      this.events.push({
        kind: result.blocked ? "block" : heavy ? "heavy" : "hit",
        x: hitX,
        y: hitY,
        hitType: ab.spec.type,
      });
      // combo tracking
      if (!result.blocked) {
        if (attacker === this.player) {
          this.playerCombo += 1;
          this.playerComboTimer = COMBO_TIMER;
          this.maxCombo = Math.max(this.maxCombo, this.playerCombo);
        } else if (defender === this.player) {
          this.playerCombo = 0;
          this.playerComboTimer = 0;
        }
      }
    }
  }

  private endRoundByKO() {
    const playerWon = this.enemy.hp <= 0;
    if (playerWon) this.playerWins += 1;
    else this.enemyWins += 1;
    this.phase = "round_end";
    this.phaseTimer = 3.5;
    // enhanced dramatic KO VFX — long hitstop, hard shake, big flash,
    // punch-zoom, sustained slow-motion and chromatic aberration.
    // All tuning lives in config/vfx.ts (KO_VFX).
    this.hitstop = KO_VFX.hitstop;
    this.shake = KO_VFX.shake;
    this.flash = KO_VFX.flash;
    this.flashColor = playerWon ? "#fde047" : "#f87171";
    this.zoom = KO_VFX.zoom;
    this.slowmo = KO_VFX.slowmo;
    this.chromAb = KO_VFX.chromAb;
    const koX = (this.player.x + this.enemy.x) / 2;
    const koColor = playerWon ? "#fde047" : "#f87171";
    const koFade = playerWon ? "#fef3c7" : "#fecaca";
    // double shockwave: a fast bright ring then a slower dark follow-up
    this.spawnShockwave(
      koX,
      GROUND_Y - 90,
      KO_VFX.shockwave1Radius,
      koColor,
      5,
    );
    this.spawnShockwave(
      koX,
      GROUND_Y - 90,
      KO_VFX.shockwave2Radius,
      koFade,
      3,
    );
    this.spawnStreakBurst(koX, GROUND_Y - 90, KO_VFX.streakCount, koColor);
    this.events.push({ kind: "ko", x: koX, y: GROUND_Y - 90, hitType: null });
    this.setAnnounce("K.O.", playerWon ? "You won the round" : "You lost the round", 3.0, true);
    if (playerWon) this.player.setState("victory");
    else this.enemy.setState("victory");
  }

  private endRoundByTime() {
    let playerWon: boolean;
    if (this.player.hp > this.enemy.hp) playerWon = true;
    else if (this.enemy.hp > this.player.hp) playerWon = false;
    else playerWon = true; // draw -> player
    if (playerWon) this.playerWins += 1;
    else this.enemyWins += 1;
    this.phase = "round_end";
    this.phaseTimer = 2.6;
    this.setAnnounce("TIME UP", playerWon ? "You won the round" : "You lost the round", 2.6, true);
    if (playerWon) this.player.setState("victory");
    else this.enemy.setState("victory");
  }

  private afterRoundEnd() {
    // Practice: reset scores and restart — no tournament / game-over flow.
    if (this.practiceMode) {
      this.playerWins = 0;
      this.enemyWins = 0;
      this.roundNo = 1;
      this.startRound();
      return;
    }
    if (this.playerWins >= ROUNDS_TO_WIN) {
      // player wins the match -> next opponent or champion
      if (this.opponentIndex >= OPPONENTS.length - 1) {
        this.phase = "champion";
        this.phaseTimer = 0;
        this.setAnnounce("CHAMPION", "You are the Shadow Lord", 999, true);
      } else {
        this.phase = "match_end";
        this.phaseTimer = 0;
        this.setAnnounce("VICTORY", `${this.opponent.name} defeated`, 999, true);
      }
    } else if (this.enemyWins >= ROUNDS_TO_WIN) {
      this.phase = "game_over";
      this.phaseTimer = 0;
      this.setAnnounce("DEFEATED", `${this.opponent.name} bested you`, 999, true);
    } else {
      this.roundNo += 1;
      this.startRound();
    }
  }

  // ---- Particles & VFX ----
  private spawnSpark(x: number, y: number, blocked: boolean, type: string) {
    const heavy = type === "kick" || type === "roundhouse" || type === "super";
    const n = blocked ? 10 : heavy ? 26 : 16;
    const color = blocked ? "#93c5fd" : heavy ? "#fde047" : "#fef08a";
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * (blocked ? 130 : heavy ? 360 : 280);
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 40,
        life: 0.3 + Math.random() * (heavy ? 0.4 : 0.3),
        maxLife: 0.7,
        size: 1.5 + Math.random() * (heavy ? 4 : 3),
        color,
        kind: "spark",
        grav: 560,
      });
    }
  }

  // big radial burst of elongated energy streaks (heavy hits / KO)
  private spawnStreakBurst(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 220 + Math.random() * 320;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 0.28 + Math.random() * 0.22,
        maxLife: 0.5,
        size: 10 + Math.random() * 14,
        color,
        kind: "streak",
        grav: 0,
      });
    }
  }

  private spawnShockwave(
    x: number,
    y: number,
    maxR: number,
    color: string,
    width: number,
  ) {
    this.shockwaves.push({
      x,
      y,
      r: 6,
      maxR,
      life: 0.45,
      maxLife: 0.45,
      color,
      width,
    });
  }

  private spawnRing(x: number, y: number) {
    this.particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.3,
      maxLife: 0.3,
      size: 8,
      color: "#fde68a",
      kind: "ring",
    });
  }

  private spawnDamageText(
    x: number,
    y: number,
    text: string,
    color: string,
    big = false,
  ) {
    this.texts.push({
      x,
      y,
      vy: -70,
      life: big ? 1.2 : 0.9,
      maxLife: big ? 1.2 : 0.9,
      text,
      color,
      size: text.startsWith("-") ? (big ? 30 : 22) : 16,
    });
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.kind !== "ring") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.grav) p.vy += p.grav * dt;
        // streaks fade velocity (drag) for a snap feel
        if (p.kind === "streak") {
          p.vx *= 0.9;
          p.vy *= 0.9;
        }
      }
    }
  }

  private updateShockwaves(dt: number) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      const t = 1 - s.life / s.maxLife;
      s.r = 6 + (s.maxR - 6) * (1 - Math.pow(1 - t, 3));
    }
  }

  // Spawns weather particles per the Director's current plan. Reuses
  // the engine's existing particle system so the renderer can paint
  // them with the same primitives (drawParticles already handles
  // spark / dust).
  private updateDirectorWeather(dt: number) {
    const w = this.directorState?.weather;
    if (!w || w.type === "none" || w.rate <= 0) return;
    // stochastic spawn based on rate (per second)
    const expected = w.rate * dt;
    const full = Math.floor(expected);
    const frac = expected - full;
    const count = full + (Math.random() < frac ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const x = STAGE_LEFT + Math.random() * (STAGE_RIGHT - STAGE_LEFT);
      let y: number;
      let vx: number;
      let vy: number;
      let size: number;
      let grav: number;
      let life: number;
      let color: string;
      switch (w.type) {
        case "rain":
          y = -20;
          vx = w.drift * 30;
          vy = w.speed;
          size = w.size;
          grav = 0;
          life = 1.6;
          color = w.color;
          break;
        case "snow":
          y = -10;
          vx = w.drift * 25 + Math.sin(this.time * 1.5 + x * 0.01) * 15;
          vy = w.speed * 0.6;
          size = w.size;
          grav = 8;
          life = 4.0;
          color = w.color;
          break;
        case "ash":
          y = -10;
          vx = w.drift * 40 + Math.sin(this.time + x * 0.02) * 12;
          vy = w.speed;
          size = w.size;
          grav = 12;
          life = 5.0;
          color = w.color;
          break;
        case "fog":
          y = GROUND_Y - 30 - Math.random() * 60;
          vx = w.drift * 25;
          vy = -w.speed * 0.2;
          size = w.size * 4;
          grav = 0;
          life = 3.0;
          color = w.color;
          break;
        case "ember":
          y = GROUND_Y - Math.random() * 60;
          vx = w.drift * 30 + (Math.random() - 0.5) * 20;
          vy = -w.speed - Math.random() * 40;
          size = w.size + Math.random() * 1.5;
          grav = -25; // floats up
          life = 1.4;
          color = w.color;
          break;
        case "dust":
          y = GROUND_Y - 10 - Math.random() * 80;
          vx = w.drift * 35;
          vy = -w.speed * 0.5;
          size = w.size;
          grav = 0;
          life = 3.5;
          color = w.color;
          break;
        case "fireflies":
          y = 100 + Math.random() * 320;
          vx = (Math.random() - 0.5) * 30;
          vy = (Math.random() - 0.5) * 12;
          size = w.size;
          grav = 0;
          life = 2.5;
          color = w.color;
          break;
        case "petals":
          y = -10;
          vx = w.drift * 30 + Math.sin(this.time * 2 + x * 0.02) * 20;
          vy = w.speed;
          size = w.size + Math.random() * 2;
          grav = 18;
          life = 4.5;
          color = w.color;
          break;
        case "shadow":
          y = -20 - Math.random() * 80;
          vx = w.drift * 20;
          vy = w.speed;
          size = w.size;
          grav = 0;
          life = 4.0;
          color = w.color;
          break;
        default:
          continue;
      }
      this.particles.push({
        x,
        y,
        vx,
        vy,
        life,
        maxLife: life,
        size,
        color,
        kind: w.type === "rain" ? "streak" : w.type === "ember" || w.type === "fireflies" ? "spark" : "dust",
        grav,
      });
    }
  }

  private updateTexts(dt: number) {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= 0.92;
    }
  }
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
