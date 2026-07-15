// ============================================================================
// SELF-PLAY RUNNER
//
// Runs genome-vs-genome matches and tournaments (round robin, swiss,
// single elimination). Fitness can optionally include self-play performance.
// The engine, FSM, and physics remain untouched.
// ============================================================================

import { Fighter } from "../fighter";
import { EnemyAI } from "../ai";
import { GameEngine, ROUND_TIME, ROUNDS_TO_WIN } from "../engine";
import type { OpponentDef } from "../types";
import type { IGenome, ISelfPlayMatch, ISelfPlayTournament, TournamentFormat } from "./types";
import { genomeToOpponentDef } from "./GenomeSerializer";

export interface SelfPlayOptions {
  baseOpponent: OpponentDef;
  timeStep?: number;
  maxDurationSeconds?: number;
  fastRoundTransitions?: boolean;
  deterministic?: boolean;
  seedBase?: number;
}

export class SelfPlayRunner {
  constructor(private options: SelfPlayOptions) {}

  /** Runs one genome-vs-genome match. Genome A is the enemy; Genome B drives the player side. */
  runMatch(genomeA: IGenome, genomeB: IGenome, seed: number): ISelfPlayMatch {
    const engine = this.buildEngine(genomeA, genomeB, seed);
    const start = performance.now();
    const maxSteps = Math.ceil((this.options.maxDurationSeconds ?? 180) / (this.options.timeStep ?? 1 / 30));
    let elapsed = 0;

    // Simple scripted agent for genomeB: use the same EnemyAI logic but on the player side.
    const bAi = new EnemyAI(genomeToOpponentDef(genomeB, this.options.baseOpponent));

    for (let step = 0; step < maxSteps; step++) {
      const dt = this.options.timeStep ?? 1 / 30;
      engine.input = bAi.update(dt, engine.player, engine.enemy);
      engine.update(dt);
      elapsed += dt;

      if (this.options.fastRoundTransitions !== false && engine.phase === "round_end") {
        if (engine.playerWins >= ROUNDS_TO_WIN || engine.enemyWins >= ROUNDS_TO_WIN) break;
        engine.startRound();
        continue;
      }

      if (engine.phase === "match_end" || engine.phase === "game_over" || engine.phase === "champion") {
        break;
      }
    }

    const durationSeconds = (performance.now() - start) / 1000;
    const roundsA = engine.enemyWins;
    const roundsB = engine.playerWins;

    let winnerId: string | "draw";
    if (roundsA > roundsB) winnerId = genomeA.id;
    else if (roundsB > roundsA) winnerId = genomeB.id;
    else winnerId = "draw";

    return {
      genomeAId: genomeA.id,
      genomeBId: genomeB.id,
      winnerId,
      roundsWonA: roundsA,
      roundsWonB: roundsB,
      durationSeconds,
    };
  }

  /** Runs a tournament of the requested format. */
  runTournament(genomes: IGenome[], format: TournamentFormat): ISelfPlayTournament {
    switch (format) {
      case "roundRobin":
        return this.roundRobin(genomes);
      case "swiss":
        return this.swiss(genomes);
      case "singleElimination":
        return this.singleElimination(genomes);
      default:
        return this.roundRobin(genomes);
    }
  }

  private roundRobin(genomes: IGenome[]): ISelfPlayTournament {
    const matches: ISelfPlayMatch[] = [];
    for (let i = 0; i < genomes.length; i++) {
      for (let j = i + 1; j < genomes.length; j++) {
        const seed = this.hashSeed(genomes[i].id, genomes[j].id);
        matches.push(this.runMatch(genomes[i], genomes[j], seed));
      }
    }
    return { format: "roundRobin", matches, standings: this.computeStandings(matches, genomes) };
  }

  private swiss(genomes: IGenome[]): ISelfPlayTournament {
    // Simplified Swiss: each genome plays a fixed number of rounds against
    // similarly-scored opponents. For small offline populations this is enough.
    const rounds = Math.max(1, Math.ceil(Math.log2(genomes.length)));
    const matches: ISelfPlayMatch[] = [];
    let standings = genomes.map((g) => ({ genomeId: g.id, wins: 0, losses: 0, draws: 0, score: 0 }));

    for (let r = 0; r < rounds; r++) {
      standings.sort((a, b) => b.score - a.score);
      const paired = new Set<string>();
      for (let i = 0; i < standings.length; i++) {
        if (paired.has(standings[i].genomeId)) continue;
        for (let j = i + 1; j < standings.length; j++) {
          if (paired.has(standings[j].genomeId)) continue;
          const a = genomes.find((g) => g.id === standings[i].genomeId)!;
          const b = genomes.find((g) => g.id === standings[j].genomeId)!;
          const seed = this.hashSeed(a.id, b.id, r);
          const match = this.runMatch(a, b, seed);
          matches.push(match);
          paired.add(a.id);
          paired.add(b.id);
          standings = this.computeStandings(matches, genomes);
          break;
        }
      }
    }

    return { format: "swiss", matches, standings };
  }

  private singleElimination(genomes: IGenome[]): ISelfPlayTournament {
    let current = [...genomes];
    const matches: ISelfPlayMatch[] = [];

    while (current.length > 1) {
      const nextRound: IGenome[] = [];
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 >= current.length) {
          nextRound.push(current[i]);
          continue;
        }
        const seed = this.hashSeed(current[i].id, current[i + 1].id);
        const match = this.runMatch(current[i], current[i + 1], seed);
        matches.push(match);
        nextRound.push(match.winnerId === current[i].id ? current[i] : current[i + 1]);
      }
      current = nextRound;
    }

    return { format: "singleElimination", matches, standings: this.computeStandings(matches, genomes) };
  }

  private computeStandings(
    matches: ISelfPlayMatch[],
    genomes: IGenome[],
  ): Array<{ genomeId: string; wins: number; losses: number; draws: number; score: number }> {
    const map = new Map<string, { wins: number; losses: number; draws: number }>();
    for (const g of genomes) map.set(g.id, { wins: 0, losses: 0, draws: 0 });

    for (const m of matches) {
      if (m.winnerId === "draw") {
        map.get(m.genomeAId)!.draws++;
        map.get(m.genomeBId)!.draws++;
      } else {
        const winner = m.winnerId === m.genomeAId ? m.genomeAId : m.genomeBId;
        const loser = winner === m.genomeAId ? m.genomeBId : m.genomeAId;
        map.get(winner)!.wins++;
        map.get(loser)!.losses++;
      }
    }

    return Array.from(map.entries())
      .map(([genomeId, record]) => ({
        genomeId,
        ...record,
        score: record.wins * 3 + record.draws,
      }))
      .sort((a, b) => b.score - a.score);
  }

  private buildEngine(genomeA: IGenome, genomeB: IGenome, seed: number): GameEngine {
    const engine = new GameEngine();
    const defA = genomeToOpponentDef(genomeA, this.options.baseOpponent);
    engine.ai = new EnemyAI(defA);
    engine.enemy = new Fighter({
      x: 600,
      isPlayer: false,
      facing: -1,
      maxHp: defA.hp,
      rim: defA.rim,
      name: defA.name,
      damageMul: defA.damageMul,
      speedMul: defA.speedMul,
      blade: defA.blade,
      bodyType: defA.bodyType,
    });
    engine.twoPlayer = false;
    engine.playerWins = 0;
    engine.enemyWins = 0;
    engine.roundNo = 1;
    engine.startRound();
    return engine;
  }

  private hashSeed(a: string, b: string, salt = 0): number {
    let h = 2166136261 + salt;
    const str = `${a}:${b}`;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
}
