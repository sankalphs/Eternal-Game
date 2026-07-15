// ============================================================================
// ACTIVE LEARNING — UNCERTAINTY SAMPLER
//
// Given a pool of ScoredSamples and a budget, select the top-K that should
// be sent to the teacher. Strategies:
//
//   - "uncertainty":  rank by confidence signal, pick top-K
//   - "disagreement": rank by plan-disagreement signal, pick top-K
//   - "outcome":      rank by bad-outcome signal, pick top-K
//   - "hybrid":       rank by composite value, pick top-K (default)
//   - "diversity":    MMR (maximal marginal relevance) — pick a diverse subset
//   - "rare_context": prefer samples with rare contextHashes, then by value
//
// All strategies honour the budget caps:
//
//   - maxQueriesPerRound (hard cap)
//   - maxSelectionRatio  (cap as a fraction of the pool)
//   - minSelectionSize   (floor — always send at least this many)
//
// Returns the selected samples sorted by descending value.
// ============================================================================

import type {
  ActiveLearningConfig,
  ScoredSample,
  SamplingStrategy,
  TeacherBudget,
} from "./types";
import { DEFAULT_TEACHER_BUDGET } from "./types";

// A simple deterministic LCG so the sampler is testable.
class SamplerRng {
  private state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 1; }
  next(): number {
    // Numerical Recipes LCG
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  // Fisher-Yates shuffle using the LCG
  shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = out[i]!;
      out[i] = out[j]!;
      out[j] = t;
    }
    return out;
  }
}

export class UncertaintySampler {
  private rng: SamplerRng;

  constructor(seed: number = 42) {
    this.rng = new SamplerRng(seed);
  }

  /**
   * Reseed (used by ActiveLearningEngine.setConfig).
   */
  setSeed(seed: number): void {
    this.rng = new SamplerRng(seed);
  }

  /**
   * Select a subset of ScoredSamples to send to the teacher.
   */
  select(pool: ScoredSample[], config: ActiveLearningConfig): ScoredSample[] {
    const budget = config.budget ?? DEFAULT_TEACHER_BUDGET;
    const strategy = config.strategy ?? "hybrid";

    // Compute the raw ranked list (or MMR list) for the chosen strategy
    let ranked: ScoredSample[];
    switch (strategy) {
      case "uncertainty":  ranked = this.bySignal(pool, "confidence");  break;
      case "disagreement": ranked = this.bySignal(pool, "disagreement"); break;
      case "outcome":      ranked = this.bySignal(pool, "outcome");      break;
      case "hybrid":       ranked = this.byValue(pool);                  break;
      case "diversity":    ranked = this.mmr(pool, this.softCap(pool.length, budget), config.diversityWeight); break;
      case "rare_context": ranked = this.byRarity(pool, config.diversityWeight); break;
      default:             ranked = this.byValue(pool);
    }

    // Apply the hard budget cap
    const cap = this.computeCap(ranked.length, budget);
    return ranked.slice(0, cap);
  }

  /**
   * Estimate the cost of a hypothetical selection.
   */
  estimateCost(selection: ScoredSample[]): number {
    return selection.reduce((acc, s) => acc + (s.estimatedTeacherCost ?? 0), 0);
  }

  /**
   * Dry-run a selection without returning the samples — just the count
   * and the estimated cost. Useful for planning rounds.
   */
  plan(pool: ScoredSample[], config: ActiveLearningConfig): {
    selected: number;
    estimatedCost: number;
    byStrategy: Record<SamplingStrategy, number>;
  } {
    const strategies: SamplingStrategy[] = [
      "uncertainty", "disagreement", "outcome", "hybrid", "diversity", "rare_context",
    ];
    const byStrategy = {} as Record<SamplingStrategy, number>;
    for (const s of strategies) {
      const subset = this.select(pool, { ...config, strategy: s });
      byStrategy[s] = subset.length;
    }
    const canonical = this.select(pool, config);
    return {
      selected: canonical.length,
      estimatedCost: this.estimateCost(canonical),
      byStrategy,
    };
  }

  // --------------------------------------------------------------------------
  // Strategies
  // --------------------------------------------------------------------------

  private byValue(pool: ScoredSample[]): ScoredSample[] {
    return [...pool].sort((a, b) => b.value - a.value);
  }

  private bySignal(pool: ScoredSample[], signal: "confidence" | "disagreement" | "outcome"): ScoredSample[] {
    return [...pool].sort((a, b) => b.signals[signal] - a.signals[signal]);
  }

  /**
   * MMR-style diversity selection. The MMR score is:
   *
   *   mmr(s) = λ * value(s) - (1 - λ) * max_sim(s, selected)
   *
   * where max_sim(s, selected) is the worst-case (highest) similarity to
   * any already-selected sample. λ=1 collapses to byValue; λ=0 collapses
   * to pure diversity.
   */
  private mmr(pool: ScoredSample[], k: number, lambda: number): ScoredSample[] {
    if (pool.length === 0 || k === 0) return [];
    const remaining = this.rng.shuffle(pool).sort((a, b) => b.value - a.value);
    const selected: ScoredSample[] = [];
    selected.push(remaining.shift()!);
    while (selected.length < k && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]!;
        const maxSim = this.maxSimilarity(candidate, selected);
        const score = lambda * candidate.value - (1 - lambda) * maxSim;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      selected.push(remaining.splice(bestIdx, 1)[0]!);
    }
    return selected;
  }

  /**
   * Rarity-first: prefer samples with rare contextHashes, then by value.
   * We bucket by contextHash, score each bucket by 1/sqrt(size), and pick
   * proportionally to bucket size, capped by value.
   */
  private byRarity(pool: ScoredSample[], lambda: number): ScoredSample[] {
    if (pool.length === 0) return [];
    const buckets = new Map<string, ScoredSample[]>();
    for (const s of pool) {
      const key = s.sample.contextHash ?? "unknown";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(s);
    }
    const rarity: ScoredSample[] = [];
    for (const [, items] of buckets) {
      const rarityWeight = 1 / Math.sqrt(items.length);
      for (const s of items) {
        rarity.push({ ...s, value: s.value * 0.7 + rarityWeight * 0.3 * lambda });
      }
    }
    return this.mmr(rarity, pool.length, lambda);
  }

  // --------------------------------------------------------------------------
  // Similarity
  // --------------------------------------------------------------------------

  private maxSimilarity(candidate: ScoredSample, selected: ScoredSample[]): number {
    const ch = candidate.sample.contextHash;
    let max = 0;
    for (const s of selected) {
      if (ch && s.sample.contextHash === ch) return 1.0; // identical — short-circuit
      const sim = this.fieldSimilarity(candidate.sample.plan, s.sample.plan);
      if (sim > max) max = sim;
    }
    return max;
  }

  private fieldSimilarity(a: any, b: any): number {
    if (!a || !b) return 0;
    const fields = [
      "recommendedWeather", "recommendedLighting", "recommendedMusic",
      "recommendedCamera", "recommendedCrowd", "bossStyle", "bossEmotion",
      "difficulty", "recommendedNarrativeEvent",
    ];
    let match = 0;
    for (const f of fields) {
      if (a[f] !== undefined && a[f] === b[f]) match++;
    }
    return match / fields.length;
  }

  // --------------------------------------------------------------------------
  // Budget
  // --------------------------------------------------------------------------

  private computeCap(poolSize: number, budget: TeacherBudget): number {
    const byMaxQueries = budget.maxQueriesPerRound;
    const byRatio = Math.floor(poolSize * budget.maxSelectionRatio);
    // Take the smaller of maxQueries and ratioCap, but at least minSelectionSize
    return Math.max(budget.minSelectionSize, Math.min(byMaxQueries, byRatio, poolSize));
  }

  private softCap(poolSize: number, budget: TeacherBudget): number {
    // Used by diversity/rare_context — keep the cap generous so MMR
    // has a real pool to choose from.
    return Math.max(budget.minSelectionSize, Math.min(budget.maxQueriesPerRound, poolSize));
  }
}
