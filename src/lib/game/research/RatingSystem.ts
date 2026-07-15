// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — RATING SYSTEM
//
// PHASE 1 of the publication-quality evaluation layer.
//
// Implements two rating systems:
//
//   * Elo    — classical Elo (FIDE-style). Simple, well-known, fast.
//   * Glicko-2 — Glicko-2 (Mark Glickman, 2013). Adds rating
//     deviation (uncertainty) and volatility. PREFERRED for
//     publication-quality evaluation because it gives confidence
//     intervals and properly handles cold-start / sparse data.
//
// Reuses:
//   - Subject from research/types
//   - FightResult from simulator/MatchResult
//
// References:
//   - Arpad Elo, "The Rating of Chessplayers, Past and Present" (1978)
//   - Mark E. Glickman, "Example of the Glicko-2 system" (2013)
//     http://www.glicko.net/glicko/glicko2.pdf
// ============================================================================

import type { Subject, Rating, RatingConfig } from "./types";
import { DEFAULT_RATING_CONFIG } from "./types";
import { Rng } from "../simulator/Rng";

// ----------------------------------------------------------------------------
// Elo
// ----------------------------------------------------------------------------

export class EloRating {
  private config: RatingConfig;
  private ratings: Map<string, Rating> = new Map();

  constructor(config: Partial<RatingConfig> = {}) {
    this.config = { ...DEFAULT_RATING_CONFIG, ...config };
  }

  /** Get or create a rating for a subject. */
  getRating(subjectId: string): Rating {
    let r = this.ratings.get(subjectId);
    if (!r) {
      r = this.createRating(subjectId);
      this.ratings.set(subjectId, r);
    }
    return r;
  }

  /** Set a subject's rating (e.g. from a prior tournament). */
  setRating(rating: Rating): void {
    this.ratings.set(rating.subjectId, rating);
  }

  /** Update Elo for one match: winner side beats loser side. */
  updateMatch(winnerId: string, loserId: string, draw = false): { winner: Rating; loser: Rating } {
    const w = this.getRating(winnerId);
    const l = this.getRating(loserId);
    const k = this.config.kFactor;
    const eW = 1 / (1 + Math.pow(10, (l.rating - w.rating) / 400));
    const eL = 1 - eW;
    const sW = draw ? 0.5 : 1;
    const sL = draw ? 0.5 : 0;
    w.rating = w.rating + k * (sW - eW);
    l.rating = l.rating + k * (sL - eL);
    w.wins += draw ? 0 : 1;
    l.losses += draw ? 0 : 1;
    if (draw) { w.draws += 1; l.draws += 1; }
    w.matches += 1;
    l.matches += 1;
    w.lastUpdated = Date.now();
    l.lastUpdated = Date.now();
    return { winner: w, loser: l };
  }

  /** Update from a single fight. */
  updateFromFight(subjectAId: string, subjectBId: string, winnerSide: 0 | 1 | null): void {
    if (winnerSide === 0) this.updateMatch(subjectAId, subjectBId, false);
    else if (winnerSide === 1) this.updateMatch(subjectBId, subjectAId, false);
    else this.updateMatch(subjectAId, subjectBId, true);
  }

  /** Bulk update from a list of fights. */
  updateFromFights(subjectAId: string, subjectBId: string, fights: { winnerSide: 0 | 1 | null }[]): void {
    for (const f of fights) this.updateFromFight(subjectAId, subjectBId, f.winnerSide);
  }

  /** Get the full leaderboard (sorted by rating desc). */
  leaderboard(): Rating[] {
    return [...this.ratings.values()].sort((a, b) => b.rating - a.rating);
  }

  private createRating(subjectId: string): Rating {
    return {
      subjectId,
      rating: this.config.initialRating,
      ratingDeviation: 0, // Elo doesn't use RD
      volatility: 0,
      wins: 0, losses: 0, draws: 0, matches: 0,
      ratedPeriods: 0,
      lastUpdated: Date.now(),
    };
  }
}

// ----------------------------------------------------------------------------
// Glicko-2
// ----------------------------------------------------------------------------

/**
 * Glicko-2 rating system. Each subject has a rating (r), a rating
 * deviation (RD) — the uncertainty in the rating — and a volatility
 * (sigma) — how much the rating is expected to fluctuate.
 *
 * Matches are grouped into "rating periods". At the end of a period
 * the system updates all ratings. A period can be a single match, a
 * batch, or a full experiment — the caller decides.
 */
export class Glicko2Rating {
  private config: RatingConfig;
  private ratings: Map<string, Rating> = new Map();
  /** Pending matches in the current rating period. */
  private pendingMatches: { winnerId: string; loserId: string; draw: boolean }[] = [];

  constructor(config: Partial<RatingConfig> = {}) {
    this.config = { ...DEFAULT_RATING_CONFIG, ...config };
  }

  getRating(subjectId: string): Rating {
    let r = this.ratings.get(subjectId);
    if (!r) {
      r = this.createRating(subjectId);
      this.ratings.set(subjectId, r);
    }
    return r;
  }

  setRating(rating: Rating): void {
    this.ratings.set(rating.subjectId, rating);
  }

  /** Queue a match. Updates happen at endRatingPeriod(). */
  recordMatch(winnerId: string, loserId: string, draw = false): void {
    this.pendingMatches.push({ winnerId, loserId, draw });
  }

  /** Queue from a single fight. */
  recordFight(subjectAId: string, subjectBId: string, winnerSide: 0 | 1 | null): void {
    if (winnerSide === 0) this.recordMatch(subjectAId, subjectBId, false);
    else if (winnerSide === 1) this.recordMatch(subjectBId, subjectAId, false);
    else this.recordMatch(subjectAId, subjectBId, true);
  }

  /** Bulk record. */
  recordFights(subjectAId: string, subjectBId: string, fights: { winnerSide: 0 | 1 | null }[]): void {
    for (const f of fights) this.recordFight(subjectAId, subjectBId, f.winnerSide);
  }

  /**
   * End a rating period: update all ratings based on the queued
   * matches. Matches in the period are grouped per player (one
   * "game" per period per player per opponent). We model each
   * individual match as a separate game for simplicity.
   */
  endRatingPeriod(): { updated: Rating[] } {
    // Group games by player
    const gamesByPlayer = new Map<string, { opponentId: string; score: number }[]>();
    for (const m of this.pendingMatches) {
      if (!gamesByPlayer.has(m.winnerId)) gamesByPlayer.set(m.winnerId, []);
      if (!gamesByPlayer.has(m.loserId)) gamesByPlayer.set(m.loserId, []);
      const winnerScore = m.draw ? 0.5 : 1;
      const loserScore = m.draw ? 0.5 : 0;
      gamesByPlayer.get(m.winnerId)!.push({ opponentId: m.loserId, score: winnerScore });
      gamesByPlayer.get(m.loserId)!.push({ opponentId: m.winnerId, score: loserScore });
    }
    // Update every player who has games
    const updated: Rating[] = [];
    for (const [playerId, games] of gamesByPlayer) {
      const r = this.getRating(playerId);
      const newR = this.updatePlayer(r, games);
      this.ratings.set(playerId, newR);
      updated.push(newR);
    }
    // Increment RD for inactive players
    const now = Date.now();
    for (const r of this.ratings.values()) {
      if (!gamesByPlayer.has(r.subjectId)) {
        r.ratingDeviation = Math.min(
          Math.sqrt(r.ratingDeviation ** 2 + r.volatility ** 2),
          this.config.initialRd,
        );
        r.lastUpdated = now;
        r.ratedPeriods += 1;
      }
    }
    this.pendingMatches = [];
    return { updated };
  }

  /** Update a single player given a list of games. */
  private updatePlayer(r: Rating, games: { opponentId: string; score: number }[]): Rating {
    const scale = this.config.scale;
    // Convert to Glicko-2 scale (mu, phi)
    const mu = (r.rating - 1500) / scale;
    const phi = r.ratingDeviation / scale;
    const sigma = r.volatility;
    // Compute v (estimated variance) and delta (estimated improvement)
    let v = 0;
    const deltaAcc: number[] = [];
    const termAcc: number[] = [];
    for (const g of games) {
      const opp = this.getRating(g.opponentId);
      const muJ = (opp.rating - 1500) / scale;
      const phiJ = opp.ratingDeviation / scale;
      const gPhiJ = Math.sqrt(phi ** 2 + phiJ ** 2);
      const expPart = Math.exp(-(gPhiJ ** 2) / 2);
      const E = 1 / (1 + expPart);
      const denom = 1 / (phi ** 2) + 1 / (gPhiJ ** 2);
      v += gPhiJ ** 2 * E * (1 - E);
      deltaAcc.push(gPhiJ * (g.score - E));
      termAcc.push((g.score - E) * (g.score - E - E * (1 - E) * gPhiJ ** 2));
    }
    v = 1 / v;
    let delta = v * sum(deltaAcc);
    // Volatility update (iterative)
    const tau = this.config.tau;
    const eps = this.config.convergenceEpsilon;
    let sigmaPrime = sigma;
    let a = Math.log(sigmaPrime ** 2);
    const fA = (x: number) => {
      const eX = Math.exp(x);
      const t1 = eX * (delta ** 2 - phi ** 2 - v - eX);
      const t2 = 2 * (phi ** 2 + v + eX) ** 2;
      return t1 / t2 - (x - a) / (tau ** 2);
    };
    let A = a;
    let B: number;
    if (delta ** 2 > phi ** 2 + v) {
      B = Math.log(delta ** 2 - phi ** 2 - v);
    } else {
      let k = 1;
      while (fA(a - k * tau) < 0) k += 1;
      B = a - k * tau;
    }
    let fA_A = fA(A);
    let fA_B = fA(B);
    let iterations = 0;
    while (Math.abs(B - A) > eps && iterations < 100) {
      const C = A + (A - B) * fA_A / (fA_B - fA_A);
      const fA_C = fA(C);
      if (fA_C * fA_B < 0) { A = B; fA_A = fA_B; }
      else { fA_A = fA_A / 2; }
      B = C;
      fA_B = fA_C;
      iterations++;
    }
    sigmaPrime = Math.exp(A / 2);
    // Update phi* and phi
    const phiStar = Math.sqrt(phi ** 2 + sigmaPrime ** 2);
    const phiPrime = 1 / Math.sqrt(1 / phiStar ** 2 + 1 / v);
    const muPrime = mu + phiPrime ** 2 * sum(termAcc.map((t, i) => {
      const g = games[i]!;
      const opp = this.getRating(g.opponentId);
      const muJ = (opp.rating - 1500) / scale;
      const phiJ = opp.ratingDeviation / scale;
      const gPhiJ = Math.sqrt(phi ** 2 + phiJ ** 2);
      const E = 1 / (1 + Math.exp(-(gPhiJ ** 2) / 2));
      return g.score - E;
    }));
    // Convert back
    const newR: Rating = {
      ...r,
      rating: muPrime * scale + 1500,
      ratingDeviation: phiPrime * scale,
      volatility: sigmaPrime,
      ratedPeriods: r.ratedPeriods + 1,
      lastUpdated: Date.now(),
    };
    // Bookkeeping
    for (const g of games) {
      if (g.score === 1) newR.wins += 1;
      else if (g.score === 0) newR.losses += 1;
      else newR.draws += 1;
      newR.matches += 1;
    }
    return newR;
  }

  /** Full leaderboard (sorted by rating desc). */
  leaderboard(): Rating[] {
    return [...this.ratings.values()].sort((a, b) => b.rating - a.rating);
  }

  /** Get the rating deviation interval (95%). */
  ratingInterval(subjectId: string, confidence = 0.95): [number, number] {
    const r = this.getRating(subjectId);
    const z = confidence === 0.95 ? 1.96 : confidence === 0.99 ? 2.576 : 1.0;
    return [r.rating - z * r.ratingDeviation, r.rating + z * r.ratingDeviation];
  }

  private createRating(subjectId: string): Rating {
    return {
      subjectId,
      rating: this.config.initialRating,
      ratingDeviation: this.config.initialRd,
      volatility: this.config.initialVolatility,
      wins: 0, losses: 0, draws: 0, matches: 0,
      ratedPeriods: 0,
      lastUpdated: Date.now(),
    };
  }
}

// ----------------------------------------------------------------------------
// Unified RatingSystem facade
// ----------------------------------------------------------------------------

export type RatingAlgorithm = "elo" | "glicko2";

export class RatingSystem {
  private algo: RatingAlgorithm;
  private elo: EloRating | null = null;
  private glicko2: Glicko2Rating | null = null;

  constructor(algo: RatingAlgorithm = "glicko2", config: Partial<RatingConfig> = {}) {
    this.algo = algo;
    if (algo === "elo") this.elo = new EloRating(config);
    else this.glicko2 = new Glicko2Rating(config);
  }

  getAlgorithm(): RatingAlgorithm { return this.algo; }

  /** Set a prior rating. */
  setRating(rating: Rating): void {
    if (this.elo) this.elo.setRating(rating);
    if (this.glicko2) this.glicko2.setRating(rating);
  }

  /** Get a rating (current). */
  getRating(subjectId: string): Rating {
    if (this.elo) return this.elo.getRating(subjectId);
    return this.glicko2!.getRating(subjectId);
  }

  /** Record a match result. */
  recordMatch(winnerId: string, loserId: string, draw = false): void {
    if (this.elo) { this.elo.updateMatch(winnerId, loserId, draw); return; }
    this.glicko2!.recordMatch(winnerId, loserId, draw);
  }

  /** Record a fight between two subjects. */
  recordFight(subjectAId: string, subjectBId: string, winnerSide: 0 | 1 | null): void {
    if (this.elo) { this.elo.updateFromFight(subjectAId, subjectBId, winnerSide); return; }
    this.glicko2!.recordFight(subjectAId, subjectBId, winnerSide);
  }

  /** Record a batch of fights. */
  recordFights(subjectAId: string, subjectBId: string, fights: { winnerSide: 0 | 1 | null }[]): void {
    if (this.elo) { this.elo.updateFromFights(subjectAId, subjectBId, fights); return; }
    this.glicko2!.recordFights(subjectAId, subjectBId, fights);
  }

  /**
   * For Elo: updates happen per-match. For Glicko-2: this is a no-op
   * (matches are queued and updated at endRatingPeriod). For
   * Glicko-2 call endRatingPeriod() to commit a period.
   */
  endRatingPeriod(): void {
    this.glicko2?.endRatingPeriod();
  }

  /** Leaderboard (sorted desc). */
  leaderboard(): Rating[] {
    if (this.elo) return this.elo.leaderboard();
    return this.glicko2!.leaderboard();
  }

  /**
   * Build ratings from a set of subjects, using the given fights.
   * Convenience for the dashboard.
   */
  static fromSubjects(
    subjects: Subject[],
    fights: { sideAId: string; sideBId: string; winnerSide: 0 | 1 | null }[],
    algo: RatingAlgorithm = "glicko2",
    config: Partial<RatingConfig> = {},
    periodSize = 50,
  ): RatingSystem {
    const sys = new RatingSystem(algo, config);
    // Seed every subject
    for (const s of subjects) sys.setRating({
      subjectId: s.id, rating: config.initialRating ?? 1500,
      ratingDeviation: config.initialRd ?? 350, volatility: config.initialVolatility ?? 0.06,
      wins: 0, losses: 0, draws: 0, matches: 0, ratedPeriods: 0, lastUpdated: Date.now(),
    });
    // Record fights in rating periods
    if (algo === "elo") {
      for (const f of fights) sys.recordFight(f.sideAId, f.sideBId, f.winnerSide);
    } else {
      for (let i = 0; i < fights.length; i += periodSize) {
        for (let j = i; j < Math.min(fights.length, i + periodSize); j++) {
          const f = fights[j]!;
          sys.recordFight(f.sideAId, f.sideBId, f.winnerSide);
        }
        sys.endRatingPeriod();
      }
    }
    return sys;
  }
}

function sum(xs: number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return s;
}

// ----------------------------------------------------------------------------
// Leaderboard export
// ----------------------------------------------------------------------------

/** Render a leaderboard as Markdown. */
export function renderLeaderboardMd(ratings: Rating[], title = "ELO Leaderboard"): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push("| Rank | Subject | Rating | RD | Vol | W | L | D | Matches | 95% CI |");
  lines.push("|---:|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (let i = 0; i < ratings.length; i++) {
    const r = ratings[i]!;
    const z = 1.96;
    const lo = r.rating - z * r.ratingDeviation;
    const hi = r.rating + z * r.ratingDeviation;
    lines.push(
      `| ${i + 1} | ${r.subjectId} | ${r.rating.toFixed(1)} | ${r.ratingDeviation.toFixed(1)} | ${r.volatility.toFixed(4)} | ${r.wins} | ${r.losses} | ${r.draws} | ${r.matches} | [${lo.toFixed(0)}, ${hi.toFixed(0)}] |`,
    );
  }
  return lines.join("\n");
}

/** Render a leaderboard as CSV. */
export function renderLeaderboardCsv(ratings: Rating[]): string {
  const lines: string[] = ["rank,subject,rating,rd,volatility,wins,losses,draws,matches,ratedPeriods"];
  for (let i = 0; i < ratings.length; i++) {
    const r = ratings[i]!;
    lines.push(`${i + 1},${r.subjectId},${r.rating.toFixed(4)},${r.ratingDeviation.toFixed(4)},${r.volatility.toFixed(6)},${r.wins},${r.losses},${r.draws},${r.matches},${r.ratedPeriods}`);
  }
  return lines.join("\n");
}

/** Render a leaderboard as JSON. */
export function renderLeaderboardJson(ratings: Rating[]): string {
  return JSON.stringify(ratings, null, 2);
}
