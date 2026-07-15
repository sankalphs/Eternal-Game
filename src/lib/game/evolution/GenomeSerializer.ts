// ============================================================================
// GENOME SERIALIZER
//
// Converts a genome to/from the runtime OpponentDef consumed by EnemyAI.
// The exported ChampionGenome.json is a pure IGenome so the middleware can
// load it directly and apply it without runtime mutation.
// ============================================================================

import type { GameEngine } from "../engine";
import { Fighter } from "../fighter";
import { EnemyAI } from "../ai";
import type { OpponentDef } from "../types";
import type { IGenome } from "./types";
import { GENOME_VERSION, clampGenome, createDefaultGenome, validateGenome } from "./Genome";

/** Name used for the champion opponent when applied to the engine. */
export const CHAMPION_OPPONENT_NAME = "Eternal Champion";

/**
 * Converts a behaviour genome into an OpponentDef usable by EnemyAI.
 * Body stats (hp, damageMul, speedMul, rim, bg, bodyType) are copied from
 * the supplied base opponent so the genome only changes AI parameters.
 */
export function genomeToOpponentDef(genome: IGenome, base: OpponentDef): OpponentDef {
  const clamped = clampGenome(genome);
  return {
    ...base,
    name: CHAMPION_OPPONENT_NAME,
    title: `${base.title} (Evolved)`,

    // ---- AI behaviour parameters (the only things the genome changes) ----
    aggression: clamped.aggression,
    blockChance: clamped.blockChance,
    reaction: clamped.reaction,
    combo: clamped.combo,
    whiffPunish: clamped.whiffPunish,
    antiAir: clamped.antiAir,
    pressure: clamped.pressure,
    mixup: clamped.mixup,
    adaptive: clamped.adaptive,
    rage: clamped.rage,
    perfection: clamped.perfection,
    readDelay: clamped.readDelay,
  };
}

/**
 * Builds a Genome from an OpponentDef. Useful when importing a hand-tuned
 * opponent as the starting point for evolution.
 */
export function opponentDefToGenome(def: OpponentDef, generation = 0): IGenome {
  return createDefaultGenome({
    id: `genome_${Date.now().toString(36)}`,
    generation,
    source: "import",
    aggression: def.aggression,
    blockChance: def.blockChance,
    reaction: def.reaction,
    combo: def.combo,
    whiffPunish: def.whiffPunish ?? 0,
    antiAir: def.antiAir ?? 0,
    pressure: def.pressure ?? 0,
    mixup: def.mixup ?? 0,
    adaptive: def.adaptive ?? 0,
    rage: def.rage ?? 0,
    perfection: def.perfection ?? 0,
    readDelay: def.readDelay ?? 0,
  });
}

/** Serializes a genome to a JSON string. */
export function serializeGenome(genome: IGenome): string {
  return JSON.stringify(genome, null, 2);
}

/** Parses a genome from a JSON string. */
export function deserializeGenome(json: string): IGenome {
  const parsed = JSON.parse(json) as IGenome;
  const { valid, errors } = validateGenome(parsed);
  if (!valid) {
    throw new Error(`Invalid genome: ${errors.join("; ")}`);
  }
  return parsed;
}

/**
 * Loads the champion genome from an arbitrary JSON payload.
 * This is the runtime integration point: the middleware calls this function
 * with the contents of ChampionGenome.json and receives an OpponentDef ready
 * for `new EnemyAI(def)`.
 */
export function loadChampionGenome(json: string | Record<string, unknown>, baseOpponent: OpponentDef): OpponentDef {
  const raw = typeof json === "string" ? (JSON.parse(json) as Record<string, unknown>) : json;

  if (raw.version && raw.version !== GENOME_VERSION) {
    // In a real product this would run a migration. Here we simply warn and continue.
    console.warn(`[GenomeSerializer] Genome version mismatch: ${String(raw.version)} vs ${GENOME_VERSION}`);
  }

  const genome = raw as IGenome;
  return genomeToOpponentDef(genome, baseOpponent);
}

/**
 * Applies an OpponentDef to an existing GameEngine without modifying engine.ts.
 * Replaces the enemy AI and fighter with the supplied behaviour definition.
 */
export function applyOpponentDefToEngine(engine: GameEngine, def: OpponentDef): void {
  engine.ai = new EnemyAI(def);
  engine.enemy = new Fighter({
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
  engine.twoPlayer = false;
  engine.sceneOverride = def.bg;
  engine.playerWins = 0;
  engine.enemyWins = 0;
  engine.roundNo = 1;
  engine.startRound();
}

/**
 * Applies a genome to an existing GameEngine without modifying engine.ts.
 * Replaces the enemy AI and fighter with genome-derived behaviour.
 */
export function applyGenomeToEngine(engine: GameEngine, genome: IGenome, baseOpponent: OpponentDef): void {
  applyOpponentDefToEngine(engine, genomeToOpponentDef(genome, baseOpponent));
}

/** Default filename used when exporting the champion genome. */
export const CHAMPION_GENOME_FILENAME = "ChampionGenome.json";
