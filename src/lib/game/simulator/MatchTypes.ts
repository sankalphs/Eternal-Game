// ============================================================================
// SIMULATOR — MATCH TYPES
//
// PHASE 4 of the research framework. Seven canonical match types, each
// implemented as a thin adapter over the SimulationRunner. Reuses
// existing genomes, agents, and opponents.
//
//   1. ga_vs_ga              — GA genome vs GA genome
//   2. ga_vs_archetype       — GA genome vs the 15 player archetypes
//   3. student_vs_ga         — Student (frozen champion) vs GA genome
//   4. student_vs_teacher    — Student (frozen champion) vs Teacher (distilled)
//   5. student_vs_baseline   — Student vs Frozen Baseline
//   6. director_v3_vs_v4     — Director V3 vs Director V4 (campaign-level)
//   7. campaign_vs_campaign  — Two full campaigns side by side
//
// The director adapters are intentionally simple — they generate
// chapters procedurally without depending on the heavy
// CampaignPlanner / WorldState pipeline (which has its own input
// requirements). They satisfy the CampaignDirector interface so
// SimulationRunner.runCampaign() can drive them.
// ============================================================================

import { OPPONENTS } from "../config/opponents";
import type { OpponentDef } from "../types";
import type { IGenome, IPlayerAgent } from "../evolution/types";
import { genomeToOpponentDef, opponentDefToGenome } from "../evolution/GenomeSerializer";
import { createAllAgents, createAgentById } from "../evolution/agents";
import { SimulationRunner, type CampaignDirector, type RunFightParams } from "./SimulationRunner";
import type { FightResult, SeriesResult } from "./MatchResult";
import { defaultOpponent, HeadlessEngine } from "./HeadlessEngine";

// ----------------------------------------------------------------------------
// 1. GA Genome vs GA Genome
// ----------------------------------------------------------------------------

export interface GaVsGaParams {
  genomeA: IGenome;
  genomeB: IGenome;
  baseOpponent?: OpponentDef;
  matches: number;
  seed: number;
}

/** Run genome A vs genome B in N matches. */
export function matchGaVsGa(runner: SimulationRunner, params: GaVsGaParams): SeriesResult {
  return runner.runSeries({
    sideA: params.genomeA,
    sideB: params.genomeB,
    seed: params.seed,
    n: params.matches,
    matchType: "ga_vs_ga",
    config: {
      baseOpponentIndex: 0,
      fastRoundTransitions: true,
      drainVfx: true,
      deterministic: true,
    },
  });
}

// ----------------------------------------------------------------------------
// 2. GA Genome vs the 15 Player Archetypes
// ----------------------------------------------------------------------------

export interface GaVsArchetypesParams {
  genome: IGenome;
  matchesPerArchetype?: number;
  seed: number;
  baseOpponent?: OpponentDef;
  /** Restrict to a subset of archetype ids. */
  archetypes?: string[];
}

/** Standard 15-archetype list (matches createAllAgents). */
export const STANDARD_ARCHETYPES = [
  "aggressive", "defensive", "counter", "combo", "risky", "passive",
  "jumper", "roll_spam", "beginner", "speedrunner", "turtle", "random",
  "super_saver", "footsies", "whiff_punisher",
] as const;

/** Run a genome against every standard archetype. */
export function matchGaVsArchetypes(runner: SimulationRunner, params: GaVsArchetypesParams): SeriesResult {
  const archetypeIds = params.archetypes ?? [...STANDARD_ARCHETYPES];
  const matchesPerArchetype = params.matchesPerArchetype ?? 1;
  const matches: RunFightParams[] = [];
  for (let i = 0; i < archetypeIds.length; i++) {
    const id = archetypeIds[i]!;
    for (let m = 0; m < matchesPerArchetype; m++) {
      matches.push({
        sideA: params.genome,
        sideB: defaultOpponent(0),
        sideAAgent: undefined,
        sideBAgent: createAgentById(id),
        seed: (params.seed + i * 1009 + m) >>> 0,
        matchType: "ga_vs_archetype",
        meta: { archetypeId: id, genomeId: params.genome.id },
      });
    }
  }
  return runner.runBatch({ matches });
}

// ----------------------------------------------------------------------------
// 3. Student (frozen champion) vs GA Genome
// ----------------------------------------------------------------------------

export interface StudentVsGaParams {
  studentGenome: IGenome;
  gaGenome: IGenome;
  matches: number;
  seed: number;
  baseOpponent?: OpponentDef;
}

/** The frozen champion (student) faces a GA-evolved genome. */
export function matchStudentVsGa(runner: SimulationRunner, params: StudentVsGaParams): SeriesResult {
  return runner.runSeries({
    sideA: params.studentGenome,
    sideB: params.gaGenome,
    seed: params.seed,
    n: params.matches,
    matchType: "student_vs_ga",
    config: { baseOpponentIndex: 0, fastRoundTransitions: true, drainVfx: true, deterministic: true },
    meta: { studentVersion: params.studentGenome.id, genomeId: params.gaGenome.id },
  });
}

// ----------------------------------------------------------------------------
// 4. Student vs Teacher (Distilled)
// ----------------------------------------------------------------------------

export interface StudentVsTeacherParams {
  studentGenome: IGenome;
  teacherGenome: IGenome;
  matches: number;
  seed: number;
  baseOpponent?: OpponentDef;
}

/** Compare the student and the teacher (offline-distilled champion). */
export function matchStudentVsTeacher(runner: SimulationRunner, params: StudentVsTeacherParams): SeriesResult {
  return runner.runSeries({
    sideA: params.studentGenome,
    sideB: params.teacherGenome,
    seed: params.seed,
    n: params.matches,
    matchType: "student_vs_teacher",
    meta: {
      studentVersion: params.studentGenome.id,
      teacherVersion: params.teacherGenome.id,
    },
  });
}

// ----------------------------------------------------------------------------
// 5. Student vs Frozen Baseline
// ----------------------------------------------------------------------------

export interface StudentVsBaselineParams {
  studentGenome: IGenome;
  baselineOpponentIndex?: number;
  matches: number;
  seed: number;
}

/** Student vs a frozen story-mode opponent. Used for regression checks. */
export function matchStudentVsBaseline(runner: SimulationRunner, params: StudentVsBaselineParams): SeriesResult {
  const baseline = OPPONENTS[params.baselineOpponentIndex ?? 0] ?? OPPONENTS[0]!;
  return runner.runSeries({
    sideA: params.studentGenome,
    sideB: baseline,
    seed: params.seed,
    n: params.matches,
    matchType: "student_vs_baseline",
    meta: { baseOpponent: baseline.name, studentVersion: params.studentGenome.id },
  });
}

// ----------------------------------------------------------------------------
// 6. Director V3 vs Director V4 (campaign comparison)
// ----------------------------------------------------------------------------

export interface DirectorComparisonParams {
  chapters: number;
  seed: number;
  roundsToWin?: number;
}

/** Run two campaigns in parallel — V3 vs V4 — and return both. */
export function matchDirectorV3VsV4(
  runner: SimulationRunner,
  params: DirectorComparisonParams,
): {
  v3: { id: string; chapters: number; fights: FightResult[] };
  v4: { id: string; chapters: number; fights: FightResult[] };
} {
  const v3Director: CampaignDirector = new V3DirectorAdapter(params.chapters, params.seed);
  const v4Director: CampaignDirector = new V4DirectorAdapter(params.chapters, params.seed);
  const v3Result = runner.runCampaign({
    director: v3Director,
    seed: params.seed,
    roundsToWin: params.roundsToWin ?? 2,
    onProgress: undefined,
  });
  const v4Result = runner.runCampaign({
    director: v4Director,
    seed: params.seed,
    roundsToWin: params.roundsToWin ?? 2,
    onProgress: undefined,
  });
  return {
    v3: { id: v3Result.id, chapters: v3Result.chapters.length, fights: v3Result.chapters.map(c => c.result) },
    v4: { id: v4Result.id, chapters: v4Result.chapters.length, fights: v4Result.chapters.map(c => c.result) },
  };
}

// ----------------------------------------------------------------------------
// 7. Campaign vs Campaign
// ----------------------------------------------------------------------------

export interface CampaignVsCampaignParams {
  directorA: CampaignDirector;
  directorB: CampaignDirector;
  seed: number;
}

/** Two full campaigns side by side. */
export function matchCampaignVsCampaign(
  runner: SimulationRunner,
  params: CampaignVsCampaignParams,
): { a: ReturnType<typeof runner.runCampaign>; b: ReturnType<typeof runner.runCampaign> } {
  const a = runner.runCampaign({ director: params.directorA, seed: params.seed });
  const b = runner.runCampaign({ director: params.directorB, seed: params.seed });
  return { a, b };
}

// ----------------------------------------------------------------------------
// Procedural director adapters (no CampaignPlanner / WorldState dependency)
// ----------------------------------------------------------------------------

const EMOTIONS = ["wonder", "confidence", "suspicion", "fear", "hopelessness"] as const;
const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/**
 * V3-style director. Procedural chapter planning that cycles through
 * the 8 story opponents, scaling difficulty and emotion.
 */
export class V3DirectorAdapter implements CampaignDirector {
  readonly id = "V3";
  chapterCount: number;
  private seed: number;

  constructor(chapterCount: number, seed: number) {
    this.chapterCount = Math.max(1, chapterCount);
    this.seed = seed;
  }

  planChapter(index: number, _prevResults: FightResult[]): import("./SimulationRunner").CampaignChapter {
    const opponent = OPPONENTS[index % OPPONENTS.length] ?? OPPONENTS[0]!;
    return {
      opponent,
      emotion: EMOTIONS[index % EMOTIONS.length]!,
      difficulty: DIFFICULTIES[Math.min(2, Math.floor(index / 3))]!,
      background: opponent.bg,
      directorNote: `V3 chapter ${index}: emotion=${EMOTIONS[index % EMOTIONS.length]}`,
    };
  }
}

/**
 * V4-style director. Same shape as V3 but uses a different chapter
 * selection algorithm (peak-trough alternation) so the two diverge.
 */
export class V4DirectorAdapter implements CampaignDirector {
  readonly id = "V4";
  chapterCount: number;
  private seed: number;

  constructor(chapterCount: number, seed: number) {
    this.chapterCount = Math.max(1, chapterCount);
    this.seed = seed;
  }

  planChapter(index: number, prevResults: FightResult[]): import("./SimulationRunner").CampaignChapter {
    // V4 alternates between easier and harder chapters.
    const isPeak = index % 2 === 0;
    const baseIdx = isPeak ? Math.min(OPPONENTS.length - 1, Math.floor(index / 2) + 4) : Math.max(0, index % OPPONENTS.length);
    const opponent = OPPONENTS[baseIdx] ?? OPPONENTS[0]!;
    const lastResult = prevResults[prevResults.length - 1];
    const won = lastResult ? lastResult.winnerSide === 0 : true;
    // V4 tightens or eases based on the last result
    const emotion = won ? "confidence" : EMOTIONS[index % EMOTIONS.length]!;
    return {
      opponent,
      emotion,
      difficulty: won ? DIFFICULTIES[2]! : DIFFICULTIES[0]!,
      background: opponent.bg,
      directorNote: `V4 chapter ${index}: adaptive (lastWon=${won})`,
    };
  }
}

// ----------------------------------------------------------------------------
// Re-exports of common building blocks
// ----------------------------------------------------------------------------

export { createAllAgents, createAgentById } from "../evolution/agents";
export { genomeToOpponentDef, opponentDefToGenome };
export { HeadlessEngine, defaultOpponent };
