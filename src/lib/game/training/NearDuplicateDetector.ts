// ============================================================================
// PHASE 2: NEAR DUPLICATE DETECTOR
//
// Removes duplicate AND near-duplicate GameDesignSamples. Reuses the
// existing contextHash produced by the GameDesignDatasetLogger for
// exact-match detection, and adds a deterministic similarity score
// (Jaccard over tokenised field sets) for near-duplicate detection.
//
// A future CosineSimilarity interface is exposed — the same input/output
// shape is preserved so a real embedding-based detector can be dropped
// in later without changing callers.
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import { makeRng } from "./types";

export interface DuplicateReport {
  total: number;
  exactDuplicates: number;
  nearDuplicates: number;
  sequences: number;            // repeated runs of 3+ near-identical samples
  kept: number;
  removedIds: string[];
  similarityMatrixSize: number;
  averagePairwiseSimilarity: number;
  threshold: number;
}

export interface SimilarityEngine {
  name: string;
  /** Returns a value in [0, 1]. 1 = identical, 0 = disjoint. */
  similarity(a: GameDesignSample, b: GameDesignSample): number;
}

export interface NearDuplicateDetectorOptions {
  threshold: number;            // 0..1 — pairs above this are duplicates
  /**
   * If a "run" of `sequenceLength` near-identical samples appears
   * consecutively (after sorting by id), keep only the best one.
   */
  sequenceLength: number;
  /** Engine for similarity. Defaults to JaccardSetSimilarity. */
  engine?: SimilarityEngine;
}

/**
 * Jaccard similarity over the canonical token set of two samples.
 * The token set is a deterministic projection of the context's
 * high-signal fields (skill bucket, archetype, chapter, emotion,
 * difficulty, weather, genome, etc.). Cheap, reproducible, no
 * embeddings required.
 */
export class JaccardSetSimilarity implements SimilarityEngine {
  readonly name = "jaccard-set";

  similarity(a: GameDesignSample, b: GameDesignSample): number {
    const ta = tokensOf(a);
    const tb = tokensOf(b);
    if (ta.size === 0 && tb.size === 0) return 1;
    let intersect = 0;
    for (const t of ta) if (tb.has(t)) intersect++;
    const union = ta.size + tb.size - intersect;
    return union === 0 ? 0 : intersect / union;
  }
}

/**
 * Placeholder for a future embedding-based detector. The interface is
 * stable: same name + similarity() signature. Real engines can plug
 * in a vector store later.
 */
export class CosineSimilarityEngine implements SimilarityEngine {
  readonly name = "cosine-embedding";
  private vectors: Map<string, Map<string, number>> = new Map();

  /**
   * Register pre-computed vectors. When the real embedding pipeline
   * lands, callers will populate this map; the detector is unchanged.
   */
  registerVectors(idToVector: Map<string, Map<string, number>>): void {
    this.vectors = new Map(idToVector);
  }

  similarity(a: GameDesignSample, b: GameDesignSample): number {
    const va = this.vectors.get(a.id);
    const vb = this.vectors.get(b.id);
    if (!va || !vb) {
      // No vectors registered — fall back to Jaccard (callers should
      // use the deterministic engine when embeddings are absent).
      return new JaccardSetSimilarity().similarity(a, b);
    }
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (const [k, v] of va) {
      na += v * v;
      const w = vb.get(k);
      if (w !== undefined) dot += v * w;
    }
    for (const [, v] of vb) nb += v * v;
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }
}

function tokensOf(s: GameDesignSample): Set<string> {
  const out = new Set<string>();
  out.add(`skill:${Math.round(s.context.playerEstimate.skill * 10)}`);
  out.add(`conf:${Math.round(s.context.playerEstimate.confidence * 10)}`);
  out.add(`pat:${Math.round(s.context.playerEstimate.patience * 10)}`);
  out.add(`risk:${Math.round(s.context.playerEstimate.riskTolerance * 10)}`);
  out.add(`adap:${Math.round(s.context.playerEstimate.adaptability * 10)}`);
  out.add(`curio:${Math.round(s.context.playerEstimate.curiosity * 10)}`);
  out.add(`mood:${s.context.topline?.currentMood ?? "unknown"}`);
  out.add(`posture:${s.context.topline?.recommendedPosture ?? "unknown"}`);
  out.add(`weakness:${s.context.topline?.biggestWeakness ?? "unknown"}`);
  out.add(`dominant:${s.context.topline?.dominantStrategy ?? "unknown"}`);
  out.add(`streakW:${s.context.topline?.recentWinStreak ?? 0}`);
  out.add(`streakL:${s.context.topline?.recentLossStreak ?? 0}`);
  out.add(`chapter:${s.context.currentChapter?.chapterIndex ?? -1}`);
  out.add(`emotion:${s.plan.targetEmotion}`);
  out.add(`intensity:${Math.round(s.plan.targetIntensity * 10)}`);
  out.add(`difficulty:${s.plan.targetDifficulty}`);
  out.add(`genome:${s.plan.recommendedGenome}`);
  out.add(`weather:${s.plan.recommendedWeather}`);
  out.add(`lighting:${s.plan.recommendedLighting}`);
  out.add(`music:${s.plan.recommendedMusic}`);
  out.add(`camera:${s.plan.recommendedCamera}`);
  out.add(`crowd:${s.plan.recommendedCrowd}`);
  out.add(`hazards:${s.plan.recommendedHazards.slice().sort().join("|")}`);
  out.add(`narrative:${s.plan.recommendedNarrativeEvent}`);
  out.add(`experiment:${s.plan.recommendedExperiment ?? "none"}`);
  out.add(`trajectory:${s.context.emotionalCurve?.trajectory ?? "unknown"}`);
  out.add(`world_corr:${Math.round(s.context.worldState.corruptionLevel * 10)}`);
  out.add(`world_hope:${Math.round(s.context.worldState.hopeLevel * 10)}`);
  out.add(`win:${s.actualResult.playerWon ? 1 : 0}`);
  out.add(`chapter_progress:${Math.round((s.context.campaignHistory?.currentChapterIndex ?? 0))}`);
  out.add(`arc:${s.context.emotionalCurve?.currentEmotion ?? "unknown"}`);
  return out;
}

export class NearDuplicateDetector {
  private options: Required<NearDuplicateDetectorOptions>;
  private engine: SimilarityEngine;

  constructor(options: Partial<NearDuplicateDetectorOptions> = {}) {
    this.options = {
      threshold: options.threshold ?? 0.9,
      sequenceLength: options.sequenceLength ?? 3,
      engine: options.engine ?? new JaccardSetSimilarity(),
    };
    this.engine = this.options.engine;
  }

  /**
   * Returns the deduplicated list and a report. The first occurrence of
   * each unique / near-unique group is kept.
   */
  detect(samples: GameDesignSample[]): { kept: GameDesignSample[]; report: DuplicateReport } {
    const report: DuplicateReport = {
      total: samples.length,
      exactDuplicates: 0,
      nearDuplicates: 0,
      sequences: 0,
      kept: 0,
      removedIds: [],
      similarityMatrixSize: samples.length,
      averagePairwiseSimilarity: 0,
      threshold: this.options.threshold,
    };

    // 1. Exact dedup by contextHash
    const seenHash = new Set<string>();
    const afterExact: GameDesignSample[] = [];
    for (const s of samples) {
      if (seenHash.has(s.contextHash)) {
        report.exactDuplicates++;
        report.removedIds.push(s.id);
        continue;
      }
      seenHash.add(s.contextHash);
      afterExact.push(s);
    }

    // 2. Near-duplicate detection — O(n^2) is fine for dataset sizes
    // we expect (≤50k). For larger sets, a bucketing pre-filter is
    // recommended but not required.
    const keep = new Set<string>(afterExact.map(s => s.id));
    const reps = new Map<string, GameDesignSample>(); // representative id

    let simSum = 0;
    let simCount = 0;
    for (let i = 0; i < afterExact.length; i++) {
      for (let j = i + 1; j < afterExact.length; j++) {
        const a = afterExact[i];
        const b = afterExact[j];
        const sim = this.engine.similarity(a, b);
        simSum += sim;
        simCount++;
        if (sim >= this.options.threshold) {
          // Keep the higher quality one
          const qa = a.quality?.overall ?? 0.5;
          const qb = b.quality?.overall ?? 0.5;
          const winner = qa >= qb ? a : b;
          const loser = qa >= qb ? b : a;
          if (reps.has(winner.id)) {
            const prev = reps.get(winner.id)!;
            const prevQ = prev.quality?.overall ?? 0.5;
            if (winner.quality?.overall ?? 0.5 > prevQ) reps.set(winner.id, winner);
          } else {
            reps.set(winner.id, winner);
          }
          if (keep.has(loser.id)) {
            keep.delete(loser.id);
            report.nearDuplicates++;
            report.removedIds.push(loser.id);
          }
        }
      }
    }
    report.averagePairwiseSimilarity = simCount > 0 ? simSum / simCount : 0;

    // 3. Repeated-sequence detection
    const keptSorted = afterExact.filter(s => keep.has(s.id)).sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < keptSorted.length; i++) {
      let runEnd = i;
      for (let k = i + 1; k < keptSorted.length; k++) {
        const sim = this.engine.similarity(keptSorted[i], keptSorted[k]);
        if (sim >= this.options.threshold) runEnd = k;
        else break;
      }
      const runLength = runEnd - i + 1;
      if (runLength >= this.options.sequenceLength) {
        // Keep the best one
        const group = keptSorted.slice(i, runEnd + 1);
        group.sort((a, b) => (b.quality?.overall ?? 0.5) - (a.quality?.overall ?? 0.5));
        for (let k = 1; k < group.length; k++) {
          if (keep.has(group[k].id)) {
            keep.delete(group[k].id);
            report.sequences++;
            report.removedIds.push(group[k].id);
          }
        }
      }
    }

    const final = afterExact.filter(s => keep.has(s.id));
    report.kept = final.length;
    return { kept: final, report };
  }

  /**
   * Similarity between two specific samples. Exposed for debugging /
   * the dashboard. Uses the active engine.
   */
  similarity(a: GameDesignSample, b: GameDesignSample): number {
    return this.engine.similarity(a, b);
  }

  engineName(): string {
    return this.engine.name;
  }
}

// ---- Optional: deterministic MiniHash sketch for very large datasets ----
// Not used in the default path; provided for future scale.
export class MinHashSketch {
  private readonly numPerms: number;
  private readonly seeds: number[];

  constructor(numPerms = 32, seed = 42) {
    this.numPerms = numPerms;
    const rng = makeRng(seed);
    this.seeds = Array.from({ length: numPerms }, () => Math.floor(rng() * 0x7fffffff));
  }

  sketch(sample: GameDesignSample): bigint[] {
    const tokens = [...tokensOf(sample)];
    const sig: bigint[] = [];
    for (let i = 0; i < this.numPerms; i++) {
      let min = BigInt(Number.MAX_SAFE_INTEGER);
      for (const t of tokens) {
        const h = this.hashPerm(t, this.seeds[i]);
        if (h < min) min = h;
      }
      sig.push(min);
    }
    return sig;
  }

  private hashPerm(token: string, seed: number): bigint {
    let h = BigInt(2166136261) ^ BigInt(seed);
    for (let i = 0; i < token.length; i++) {
      h = (h ^ BigInt(token.charCodeAt(i))) * BigInt(16777619);
      h &= BigInt("0xFFFFFFFFFFFFFFFF");
    }
    return h;
  }
}
