// ============================================================================
// SIMULATOR — RESEARCH SIMULATION RUNNER
//
// PHASE 2 of the research framework. The public API is:
//
//   runFight(params):  FightResult          — one match
//   runSeries(params): SeriesResult         — N matches, same matchup
//   runBatch(params):  SeriesResult         — N matches, configurable per-call
//   runTournament(params): TournamentResult — round-robin / swiss
//   runCampaign(params): CampaignResult     — multi-fight campaign
//
// Reuses:
//   - HeadlessEngine (this module) for execution
//   - Existing evolution types: IGenome, IPlayerAgent, etc.
//   - Existing scripted agents (AggressiveAgent, DefensiveAgent, ...)
//   - Existing opponent roster from config/opponents
//   - CampaignPlanner for runCampaign
//
// Does NOT modify any existing system. Wraps and orchestrates only.
// ============================================================================

import { OPPONENTS } from "../config/opponents";
import type { OpponentDef, InputState } from "../types";
import type { IGenome, IPlayerAgent, IMatchMetrics } from "../evolution/types";
import { genomeToOpponentDef } from "../evolution/GenomeSerializer";
import { createAgentById } from "../evolution/agents";
import {
  HeadlessEngine,
  defaultOpponent,
  type HeadlessEngineConfig,
  type SideController,
  EnemySideController,
  IdleSideController,
} from "./HeadlessEngine";
import { Rng } from "./Rng";
import {
  type FightResult,
  type FightMetadata,
  type MatchTypeId,
  type SeriesResult,
  type SeriesAggregate,
  type SideStats,
} from "./MatchResult";
import { shannonEntropy } from "./StatisticsEngine";

// ----------------------------------------------------------------------------
// Common run params
// ----------------------------------------------------------------------------

export interface RunFightParams {
  /** Side A opponent. Either an OpponentDef or a genome. */
  sideA: OpponentDef | IGenome;
  /** Side B opponent. Either an OpponentDef or a genome. */
  sideB: OpponentDef | IGenome;
  /** Optional: use a scripted agent to drive side A (instead of EnemyAI). */
  sideAAgent?: IPlayerAgent;
  /** Optional: use a scripted agent to drive side B. */
  sideBAgent?: IPlayerAgent;
  /** Master seed. */
  seed: number;
  /** Background arena. */
  background?: OpponentDef["bg"];
  /** Headless config overrides. */
  config?: Partial<HeadlessEngineConfig>;
  /** Free-form metadata. */
  meta?: FightMetadata;
  /** Match type id. */
  matchType?: MatchTypeId;
}

export interface RunSeriesParams extends RunFightParams {
  /** How many matches to run. */
  n: number;
  /** Per-fight seed stride (masterSeed + i * seedStride). */
  seedStride?: number;
  /** Progress callback. */
  onProgress?: (current: number, total: number, last: FightResult) => void;
  /** Hard cancellation signal. */
  signal?: { cancelled: boolean };
}

export interface RunBatchParams {
  /** Heterogeneous match descriptors. */
  matches: RunFightParams[];
  /** Run in parallel via microtask chunks. */
  parallel?: boolean;
  /** Progress callback. */
  onProgress?: (current: number, total: number) => void;
  /** Cancellation signal. */
  signal?: { cancelled: boolean };
}

export interface TournamentEntry {
  id: string;
  opponent: OpponentDef | IGenome;
  agent?: IPlayerAgent;
}

export interface RunTournamentParams {
  entries: TournamentEntry[];
  format: "round_robin" | "swiss" | "single_elim";
  /** Number of swiss rounds (only for "swiss"). */
  swissRounds?: number;
  /** How many matches per pairing. */
  matchesPerPairing?: number;
  seed: number;
  background?: OpponentDef["bg"];
  config?: Partial<HeadlessEngineConfig>;
  onProgress?: (current: number, total: number) => void;
  signal?: { cancelled: boolean };
}

export interface TournamentResult {
  id: string;
  format: "round_robin" | "swiss" | "single_elim";
  entries: { id: string; wins: number; losses: number; draws: number; score: number }[];
  pairings: { aId: string; bId: string; results: FightResult[] }[];
  fights: FightResult[];
}

export interface RunCampaignParams {
  /** "Director" that produces chapters. */
  director: CampaignDirector;
  /** Match executor. Defaults to runFight. */
  executor?: (params: RunFightParams) => FightResult;
  seed: number;
  /** Rounds to win per chapter. */
  roundsToWin?: number;
  /** Background per chapter. */
  backgrounds?: OpponentDef["bg"][];
  config?: Partial<HeadlessEngineConfig>;
  onProgress?: (chapterIndex: number, total: number, result: FightResult) => void;
  signal?: { cancelled: boolean };
}

export interface CampaignDirector {
  /** Stable id (e.g. "V3" or "V4"). */
  readonly id: string;
  /** Number of chapters to plan. */
  chapterCount: number;
  /** Plan one chapter. */
  planChapter(index: number, prevResults: FightResult[]): CampaignChapter;
}

export interface CampaignChapter {
  opponent: OpponentDef;
  agent?: IPlayerAgent;
  emotion?: string;
  difficulty?: string;
  background?: OpponentDef["bg"];
  /** Director decision text. */
  directorNote?: string;
}

export interface CampaignResult {
  id: string;
  directorId: string;
  chapters: { chapter: CampaignChapter; result: FightResult }[];
  /** Aggregate per-campaign metrics. */
  aggregate: SeriesAggregate;
  /** How many chapters were won by the player. */
  chaptersWon: number;
  /** Total chapters. */
  totalChapters: number;
}

// ----------------------------------------------------------------------------
// SimulationRunner
// ----------------------------------------------------------------------------

export class SimulationRunner {
  /** Optional logger for dataset sampling — set by the DatasetSink. */
  public datasetSink: ((result: FightResult) => void) | null = null;

  /**
   * Run a single fight. Sync.
   */
  runFight(params: RunFightParams): FightResult {
    const oppA = this.toOpponent(params.sideA);
    const oppB = this.toOpponent(params.sideB);
    const sideA = this.makeSideController(oppA, 0, params.sideAAgent);
    const sideB = this.makeSideController(oppB, 1, params.sideBAgent);
    const meta: FightMetadata = {
      ...(params.meta ?? {}),
      matchType: params.matchType ?? "ga_vs_archetype",
      baseOpponent: oppA.name,
    };
    if (params.sideA && typeof (params.sideA as IGenome).id === "string") {
      meta.genomeId = (params.sideA as IGenome).id;
    }
    if (params.sideB && typeof (params.sideB as IGenome).id === "string") {
      meta.genomeIds = [meta.genomeId ?? "", (params.sideB as IGenome).id];
    }
    const engine = new HeadlessEngine(sideA, sideB, oppA, oppB, params.seed, {
      ...(params.config ?? {}),
      meta,
    });
    if (params.background) engine.setBackground(params.background);
    const result = engine.run();
    if (this.datasetSink) this.datasetSink(result);
    return result;
  }

  /**
   * Run N fights of the same matchup, varying the seed.
   */
  runSeries(params: RunSeriesParams): SeriesResult {
    const startedAt = Date.now();
    const fights: FightResult[] = [];
    const stride = params.seedStride ?? 1;
    for (let i = 0; i < params.n; i++) {
      if (params.signal?.cancelled) break;
      const seed = (params.seed + i * stride) >>> 0;
      const fight = this.runFight({ ...params, seed, meta: { ...(params.meta ?? {}), tags: [...(params.meta?.tags ?? []), `series:${i}`] } });
      fights.push(fight);
      params.onProgress?.(i + 1, params.n, fight);
    }
    const aggregate = aggregateFights(fights, startedAt);
    return {
      id: `series_${params.seed}_${Date.now().toString(36)}`,
      matchType: params.matchType ?? "ga_vs_archetype",
      sideAId: this.idOf(params.sideA),
      sideBId: this.idOf(params.sideB),
      fights,
      aggregate,
    };
  }

  /**
   * Run a heterogeneous batch of fights.
   */
  runBatch(params: RunBatchParams): SeriesResult {
    const startedAt = Date.now();
    const fights: FightResult[] = [];
    for (let i = 0; i < params.matches.length; i++) {
      if (params.signal?.cancelled) break;
      const m = params.matches[i]!;
      const fight = this.runFight(m);
      fights.push(fight);
      params.onProgress?.(i + 1, params.matches.length);
    }
    const aggregate = aggregateFights(fights, startedAt);
    return {
      id: `batch_${Date.now().toString(36)}`,
      matchType: fights[0]?.matchType ?? "ga_vs_archetype",
      sideAId: fights[0]?.sideAId ?? "?",
      sideBId: fights[0]?.sideBId ?? "?",
      fights,
      aggregate,
    };
  }

  /**
   * Run a tournament.
   */
  runTournament(params: RunTournamentParams): TournamentResult {
    const startedAt = Date.now();
    void startedAt;
    const id = `tourney_${params.seed}_${Date.now().toString(36)}`;
    const entries = params.entries.map(e => ({ id: e.id, wins: 0, losses: 0, draws: 0, score: 0 }));
    const pairings: TournamentResult["pairings"] = [];
    const fights: FightResult[] = [];

    const allPairs: [number, number][] = [];
    if (params.format === "round_robin") {
      for (let i = 0; i < params.entries.length; i++) {
        for (let j = i + 1; j < params.entries.length; j++) {
          allPairs.push([i, j]);
        }
      }
    } else if (params.format === "swiss") {
      // Sort by score, pair adjacent, repeat
      const order = entries.map((_, i) => i);
      const rounds = params.swissRounds ?? Math.ceil(Math.log2(params.entries.length));
      for (let r = 0; r < rounds; r++) {
        order.sort((a, b) => entries[b]!.score - entries[a]!.score);
        for (let i = 0; i + 1 < order.length; i += 2) {
          allPairs.push([order[i]!, order[i + 1]!]);
        }
      }
    } else if (params.format === "single_elim") {
      const order = entries.map((_, i) => i);
      const shuffled = new Rng(params.seed).shuffle(order);
      for (let i = 0; i + 1 < shuffled.length; i += 2) {
        allPairs.push([shuffled[i]!, shuffled[i + 1]!]);
      }
    }

    const matchesPerPairing = params.matchesPerPairing ?? 1;
    let counter = 0;
    const total = allPairs.length * matchesPerPairing;
    for (const [ia, ib] of allPairs) {
      const ea = params.entries[ia]!;
      const eb = params.entries[ib]!;
      const pairResults: FightResult[] = [];
      for (let m = 0; m < matchesPerPairing; m++) {
        if (params.signal?.cancelled) break;
        const seed = (params.seed + counter * 1009) >>> 0;
        const result = this.runFight({
          sideA: ea.opponent,
          sideB: eb.opponent,
          sideAAgent: ea.agent,
          sideBAgent: eb.agent,
          seed,
          background: params.background,
          config: params.config,
          matchType: "ga_vs_ga",
        });
        pairResults.push(result);
        fights.push(result);
        const eaStats = entries[ia]!;
        const ebStats = entries[ib]!;
        if (result.winnerSide === 0) { eaStats.wins += 1; ebStats.losses += 1; eaStats.score += 1; }
        else if (result.winnerSide === 1) { ebStats.wins += 1; eaStats.losses += 1; ebStats.score += 1; }
        else { eaStats.draws += 1; ebStats.draws += 1; eaStats.score += 0.5; ebStats.score += 0.5; }
        counter++;
        params.onProgress?.(counter, total);
      }
      pairings.push({ aId: ea.id, bId: eb.id, results: pairResults });
    }

    return { id, format: params.format, entries, pairings, fights };
  }

  /**
   * Run a campaign of chapters, each producing one fight.
   */
  runCampaign(params: RunCampaignParams): CampaignResult {
    const chapters: CampaignResult["chapters"] = [];
    const startedAt = Date.now();
    const id = `campaign_${params.director.id}_${params.seed}_${Date.now().toString(36)}`;
    const executor = params.executor ?? ((p: RunFightParams) => this.runFight(p));
    for (let i = 0; i < params.director.chapterCount; i++) {
      if (params.signal?.cancelled) break;
      const chapter = params.director.planChapter(i, chapters.map(c => c.result));
      const seed = (params.seed + i * 7919) >>> 0;
      const result = executor({
        sideA: chapter.opponent,
        sideB: chapter.opponent, // both sides use the chapter's opponent
        sideAAgent: chapter.agent,
        sideBAgent: undefined,
        seed,
        background: chapter.background ?? params.backgrounds?.[i] ?? "sunset",
        config: params.config,
        matchType: "campaign_vs_campaign",
        meta: {
          campaignId: id,
          chapterIndex: i,
          emotion: chapter.emotion,
          difficulty: chapter.difficulty,
          baseOpponent: chapter.opponent.name,
        },
      });
      chapters.push({ chapter, result });
      params.onProgress?.(i + 1, params.director.chapterCount, result);
    }
    const aggregate = aggregateFights(chapters.map(c => c.result), startedAt);
    return {
      id,
      directorId: params.director.id,
      chapters,
      aggregate,
      chaptersWon: chapters.filter(c => c.result.winnerSide === 0).length,
      totalChapters: chapters.length,
    };
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private toOpponent(x: OpponentDef | IGenome): OpponentDef {
    if (this.isGenome(x)) {
      return genomeToOpponentDef(x, defaultOpponent(0));
    }
    return x;
  }

  private isGenome(x: unknown): x is IGenome {
    return (
      !!x &&
      typeof x === "object" &&
      "id" in (x as any) &&
      "version" in (x as any) &&
      "generation" in (x as any) &&
      "aggression" in (x as any) &&
      "blockChance" in (x as any)
    );
  }

  private idOf(x: OpponentDef | IGenome): string {
    if (this.isGenome(x)) return `genome:${x.id}`;
    return `opponent:${x.name}`;
  }

  private makeSideController(opp: OpponentDef, side: 0 | 1, agent?: IPlayerAgent): SideController {
    if (agent) {
      // Build a controller that calls the agent each frame
      return new AgentSideController(agent, opp);
    }
    return new EnemySideController(opp, side);
  }
}

// ----------------------------------------------------------------------------
// AgentSideController — drives a Fighter with a scripted player agent
// ----------------------------------------------------------------------------

class AgentSideController implements SideController {
  readonly id: string;
  private agent: IPlayerAgent;
  private engineRef: import("../engine").GameEngine | null = null;

  constructor(agent: IPlayerAgent, opp: OpponentDef) {
    this.agent = agent;
    this.id = `agent:${agent.id}:${opp.name}`;
  }

  reset(): void {
    this.agent.reset?.();
  }

  step(_dt: number, engine: import("../engine").GameEngine): InputState {
    this.engineRef = engine;
    // The agent's update signature uses GameEngine and dt; it returns
    // an InputState (from the engine's perspective it's the "player"
    // input). The HeadlessEngine wires it via engine.input.
    return this.agent.update(_dt, engine);
  }
}

// ----------------------------------------------------------------------------
// Aggregate helper
// ----------------------------------------------------------------------------

export function aggregateFights(fights: FightResult[], startedAt: number): SeriesAggregate {
  const n = fights.length;
  if (n === 0) {
    return {
      n: 0, winsA: 0, winsB: 0, draws: 0,
      winRateA: 0, winRateB: 0,
      avgDuration: 0, avgDamageA: 0, avgDamageB: 0,
      avgComboVariety: 0, avgBehaviourDiversity: 0, avgPredictionAccuracy: 0,
      totalSimSeconds: 0, totalWallSeconds: 0, throughputFps: 0,
    };
  }
  let winsA = 0, winsB = 0, draws = 0;
  let totalDur = 0, totalDmgA = 0, totalDmgB = 0;
  let totalComboVariety = 0, totalEntropy = 0;
  for (const f of fights) {
    if (f.winnerSide === 0) winsA++;
    else if (f.winnerSide === 1) winsB++;
    else draws++;
    totalDur += f.durationSeconds;
    totalDmgA += f.sideA.damageDealt;
    totalDmgB += f.sideB.damageDealt;
    totalComboVariety += Object.keys(f.sideA.attackKinds).length + Object.keys(f.sideB.attackKinds).length;
    totalEntropy += shannonEntropy(Object.values(f.sideA.attackKinds).map(v => v / Math.max(1, sumValues(f.sideA.attackKinds))));
  }
  const totalSimSeconds = totalDur;
  const totalWallSeconds = (Date.now() - startedAt) / 1000;
  return {
    n,
    winsA, winsB, draws,
    winRateA: winsA / n,
    winRateB: winsB / n,
    avgDuration: totalDur / n,
    avgDamageA: totalDmgA / n,
    avgDamageB: totalDmgB / n,
    avgComboVariety: totalComboVariety / n,
    avgBehaviourDiversity: totalEntropy / n,
    avgPredictionAccuracy: 0,
    totalSimSeconds,
    totalWallSeconds,
    throughputFps: totalWallSeconds > 0 ? n / totalWallSeconds : 0,
  };
}

function sumValues(o: Record<string, number>): number {
  let s = 0;
  for (const k of Object.keys(o)) s += o[k]!;
  return s;
}

// ----------------------------------------------------------------------------
// Convenience factories
// ----------------------------------------------------------------------------

/** Default runner. */
export function createRunner(): SimulationRunner {
  return new SimulationRunner();
}

/** Build a list of all 15 scripted agents as a tournament entry. */
export function archetypeEntries(): { id: string; opponent: OpponentDef; agent: IPlayerAgent }[] {
  const ids = [
    "aggressive", "defensive", "counter", "combo", "risky", "passive",
    "jumper", "roll_spam", "beginner", "speedrunner", "turtle", "random",
    "super_saver", "footsies", "whiff_punisher",
  ];
  return ids.map(id => ({
    id: `archetype:${id}`,
    opponent: defaultOpponent(0),
    agent: createAgentById(id),
  }));
}
