// ============================================================================
// PHASE 1/2: MEMORY RETRIEVAL LAYER
//
// Sits between ContextBuilder and PromptBuilder. Retrieves only the most
// relevant memories from all game history sources using a pluggable
// retriever interface. Today: deterministic scoring. Tomorrow: embeddings.
// The rest of the engine never knows which retriever is active.
// ============================================================================

import type { AIContext, MemoryRecord, RetrievedMemory, MemoryQuery, MemoryRetriever } from "./types";
import type { WorldEvent, DerivedWorldState } from "../eventsourcing/WorldHistory";
import type { BossMemory } from "../world/WorldState";
import type { MythEntry, CampaignRecord } from "../world/WorldState";

// ---- Memory Index: converts game state into MemoryRecords ----

export class MemoryIndex {
  private records: MemoryRecord[] = [];

  /** Index world events as memory records. */
  indexWorldEvents(events: WorldEvent[]): void {
    for (const e of events) {
      const record: MemoryRecord = {
        id: `world_${e.type}_${e.timestamp}`,
        source: "world",
        content: JSON.stringify(e),
        timestamp: e.timestamp,
        importance: this.eventImportance(e),
        frequency: this.countEventType(events, e.type),
        tags: [e.type],
      };
      // Deduplicate by id
      if (!this.records.some(r => r.id === record.id)) {
        this.records.push(record);
      }
    }
  }

  /** Index boss memories. */
  indexBossMemory(bossName: string, mem: BossMemory): void {
    this.records.push({
      id: `boss_${bossName}`,
      source: "boss",
      content: JSON.stringify({ bossName, ...mem }),
      timestamp: Date.now(),
      importance: Math.min(1, mem.encounters * 0.2),
      frequency: mem.encounters,
      tags: [bossName, "boss_memory", ...mem.adaptationNotes.slice(-3).flatMap(n => n.split(/\s+/).slice(0, 3))],
    });
  }

  /** Index mythology entries. */
  indexMythology(myths: MythEntry[]): void {
    for (const m of myths) {
      this.records.push({
        id: `myth_${m.year}_${m.location}`,
        source: "myth",
        content: JSON.stringify(m),
        timestamp: m.year * 1000,
        importance: 0.6,
        frequency: 1,
        tags: ["myth", m.location],
      });
    }
  }

  /** Index campaign history. */
  indexCampaignHistory(history: CampaignRecord[]): void {
    for (const h of history) {
      this.records.push({
        id: `campaign_${h.timestamp}`,
        source: "campaign",
        content: JSON.stringify(h),
        timestamp: h.timestamp,
        importance: h.won ? 0.7 : 0.8, // losses are more informative
        frequency: 1,
        tags: [h.opponentName, h.won ? "win" : "loss"],
      });
    }
  }

  /** Index a previous DirectorPlan. */
  indexDirectorPlan(plan: AIDirectorOutput, timestamp: number): void {
    this.records.push({
      id: `plan_${timestamp}`,
      source: "director_plan",
      content: JSON.stringify(plan),
      timestamp,
      importance: 0.5,
      frequency: 1,
      tags: [plan.bossStyle, plan.weather, plan.difficulty],
    });
  }

  /** Index a previous prediction. */
  indexPrediction(prediction: Record<string, number>, timestamp: number): void {
    this.records.push({
      id: `pred_${timestamp}`,
      source: "prediction",
      content: JSON.stringify(prediction),
      timestamp,
      importance: 0.4,
      frequency: 1,
      tags: Object.keys(prediction).slice(0, 5),
    });
  }

  /** Get all records (for the retriever). */
  getAll(): MemoryRecord[] {
    return [...this.records];
  }

  /** Clear all records. */
  clear(): void {
    this.records = [];
  }

  private eventImportance(e: WorldEvent): number {
    switch (e.type) {
      case "HeroDefeated": return 0.9;
      case "HeroSpared": return 0.8;
      case "PlayerDefeated": return 0.85;
      case "VillageBurned": return 0.7;
      case "BloodMoonAppeared": return 0.75;
      case "TempleCollapsed": return 0.6;
      default: return 0.3;
    }
  }

  private countEventType(events: WorldEvent[], type: string): number {
    return events.filter(e => e.type === type).length;
  }
}

// ---- Deterministic Retriever ----
// Scores memories using recency, importance, similarity, frequency, and
// narrative relevance. No embeddings needed — deterministic scoring.

export class DeterministicRetriever implements MemoryRetriever {
  private records: MemoryRecord[] = [];

  index(records: MemoryRecord[]): void {
    this.records = [...records];
  }

  retrieve(query: MemoryQuery): RetrievedMemory[] {
    let candidates = this.records;

    // Filter by source if specified
    if (query.sources && query.sources.length > 0) {
      candidates = candidates.filter(r => query.sources!.includes(r.source));
    }
    // Filter by minimum importance
    if (query.minImportance !== undefined) {
      candidates = candidates.filter(r => r.importance >= query.minImportance!);
    }

    // Score each candidate
    const scored = candidates.map(record => {
      const scores = this.scoreRecord(record, query.context);
      return {
        record,
        score: scores.combined,
        reason: scores.reason,
      };
    });

    // Sort by score descending, take top K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, query.k);
  }

  clear(): void {
    this.records = [];
  }

  metadata() {
    return { type: "deterministic", indexedCount: this.records.length };
  }

  private scoreRecord(record: MemoryRecord, context: AIContext): { combined: number; reason: string } {
    const now = Date.now();

    // 1. Recency: exponential decay (half-life = 1 hour of game time)
    const ageMs = now - record.timestamp;
    const recency = Math.exp(-ageMs / (3600 * 1000)); // ~1 for recent, ~0 for old

    // 2. Importance: directly from the record
    const importance = record.importance;

    // 3. Frequency: more frequent = more relevant (but with diminishing returns)
    const frequency = Math.log(1 + record.frequency) / Math.log(10);

    // 4. Similarity: tag overlap with context features
    const contextTags = this.extractContextTags(context);
    const tagOverlap = record.tags.filter(t => contextTags.includes(t)).length;
    const similarity = contextTags.length > 0 ? tagOverlap / contextTags.length : 0;

    // 5. Narrative relevance: does this memory relate to the current emotion/chapter?
    const narrativeRelevance = this.narrativeRelevance(record, context);

    // Weighted combination
    const combined =
      recency * 0.15 +
      importance * 0.35 +
      frequency * 0.10 +
      similarity * 0.25 +
      narrativeRelevance * 0.15;

    const reasons: string[] = [];
    if (importance > 0.7) reasons.push("high importance");
    if (similarity > 0.3) reasons.push("tag match");
    if (recency > 0.5) reasons.push("recent");
    if (narrativeRelevance > 0.5) reasons.push("narratively relevant");

    return { combined, reason: reasons.join(", ") || "low relevance" };
  }

  private extractContextTags(context: AIContext): string[] {
    const tags: string[] = [];
    const f = context.features;
    if (f.aggression > 0.6) tags.push("aggressive");
    if (f.patience > 0.6) tags.push("patient");
    if (f.risk > 0.5) tags.push("risky");
    if (context.prediction.kickSpam > 0.6) tags.push("kickSpam");
    if (context.prediction.blockTurtle > 0.6) tags.push("blockTurtle");
    if (context.worldState.corruption > 0.5) tags.push("corrupt");
    if (context.worldState.bloodMoon) tags.push("BloodMoonAppeared");
    tags.push(context.campaign.currentEmotion);
    return tags;
  }

  private narrativeRelevance(record: MemoryRecord, context: AIContext): number {
    // If the memory's content mentions the current emotion, it's relevant
    const content = record.content.toLowerCase();
    const emotion = context.campaign.currentEmotion.toLowerCase();
    if (content.includes(emotion)) return 0.8;
    // If the memory is from the same campaign chapter, it's relevant
    if (record.source === "campaign" && content.includes(`"chapterIndex":${context.campaign.chapterIndex}`)) return 0.6;
    // World events related to the current world state
    if (record.source === "world") {
      if (context.worldState.corruption > 0.5 && content.includes("burn")) return 0.7;
      if (context.worldState.bloodMoon && content.includes("bloodmoon")) return 0.9;
    }
    return 0.2;
  }
}

// ---- Embedding Retriever (stub — interface ready for future implementation) ----
// Same interface as DeterministicRetriever. When embeddings are added,
// swap this in without changing any downstream code.

export class EmbeddingRetriever implements MemoryRetriever {
  private records: MemoryRecord[] = [];
  private embeddings: Map<string, number[]> = new Map();

  index(records: MemoryRecord[]): void {
    this.records = [...records];
    // Future: compute embeddings here using a model
    for (const r of records) {
      // Placeholder: use a simple hash-based pseudo-embedding
      this.embeddings.set(r.id, this.pseudoEmbed(r.content));
    }
  }

  retrieve(query: MemoryQuery): RetrievedMemory[] {
    // Future: use actual embedding similarity (cosine)
    // For now, fall back to deterministic scoring
    const det = new DeterministicRetriever();
    det.index(this.records);
    return det.retrieve(query);
  }

  clear(): void { this.records = []; this.embeddings.clear(); }
  metadata() { return { type: "embedding (pseudo)", indexedCount: this.records.length }; }

  private pseudoEmbed(text: string): number[] {
    // Simple hash-based pseudo-embedding for interface testing
    const dim = 64;
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % dim] += text.charCodeAt(i) / 1000;
    }
    return vec;
  }
}

// ---- Hybrid Retriever: combines deterministic + embedding ----

export class HybridRetriever implements MemoryRetriever {
  private deterministic = new DeterministicRetriever();
  private embedding = new EmbeddingRetriever();
  private weight: number; // 0=pure deterministic, 1=pure embedding

  constructor(weight = 0.3) {
    this.weight = weight;
  }

  index(records: MemoryRecord[]): void {
    this.deterministic.index(records);
    this.embedding.index(records);
  }

  retrieve(query: MemoryQuery): RetrievedMemory[] {
    const detResults = this.deterministic.retrieve({ ...query, k: query.k * 2 });
    const embResults = this.embedding.retrieve({ ...query, k: query.k * 2 });

    // Merge: weighted average of scores, deduplicate by record id
    const merged = new Map<string, RetrievedMemory>();
    for (const r of detResults) {
      merged.set(r.record.id, { record: r.record, score: r.score * (1 - this.weight), reason: r.reason });
    }
    for (const r of embResults) {
      const existing = merged.get(r.record.id);
      if (existing) {
        existing.score += r.score * this.weight;
        existing.reason += ` + ${r.reason}`;
      } else {
        merged.set(r.record.id, { record: r.record, score: r.score * this.weight, reason: r.reason });
      }
    }

    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, query.k);
  }

  clear(): void { this.deterministic.clear(); this.embedding.clear(); }
  metadata() { return { type: "hybrid", indexedCount: this.deterministic.metadata().indexedCount }; }
}
