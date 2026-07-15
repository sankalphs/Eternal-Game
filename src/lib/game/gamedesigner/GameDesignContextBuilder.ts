// ============================================================================
// PHASE 1: GAME DESIGN CONTEXT BUILDER
//
// Collects all design-time information available in the system and compresses
// it into a structured GameDesignContext. Extends the existing ContextBuilder
// pattern (src/lib/game/ai/ContextBuilder.ts) — does NOT replace it.
//
// Pipeline:
//   PlayerProfile, PlayerEstimate, PlayerPrediction,
//   CampaignPlan, CampaignHistory, DerivedWorldState,
//   PreviousDirectorPlans, GenomeLibrary, StoryEvent,
//   EmotionalCurve, BossMemory, CurrentDifficulty, ArenaState
//        │
//        ▼
//   GameDesignContext (compressed, model-ready)
// ============================================================================

import { getCurrentEmotion, advanceEmotion } from "../campaign/EmotionalCurve";
import { createInitialWorldState } from "../world/WorldState";
import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { PlayerEstimate } from "../prediction/PlayerAnalyzer";
import type { PlayerPrediction } from "../prediction/PredictionEngine";
import type { DerivedWorldState } from "../eventsourcing/WorldHistory";
import type { CampaignPlan, CampaignChapter } from "../campaign/CampaignPlanner";
import type { StoryEvent } from "../narrative/NarrativeEngine";
import type { BossMemory } from "../world/WorldState";
import type { DirectorPlanV3 } from "../director/DirectorEngineV3";
import type {
  GameDesignContext,
  GameDesignTopline,
  CampaignHistory,
  CampaignHistoryEntry,
  PreviousDirectorPlans,
  PreviousDirectorPlanSummary,
  GenomeLibrarySnapshot,
  GenomeLibraryEntry,
  EmotionalCurveSnapshot,
  CurrentDifficulty,
  ArenaState,
} from "./types";
import {
  createEmptyCampaignHistory,
  createEmptyGenomeLibrarySnapshot,
  createEmptyPreviousDirectorPlans,
  createEmptyArenaState,
} from "./types";
import { DIFFICULTIES, type DifficultyId } from "../content/difficulties";

const PREVIOUS_PLANS_HISTORY_LIMIT = 8;

export interface BuildContextParams {
  playerProfile: PlayerProfile;
  playerEstimate: PlayerEstimate;
  playerPrediction: PlayerPrediction;
  campaignPlan: CampaignPlan | null;
  chapterIndex: number;
  worldState: DerivedWorldState | null;
  previousDirectorPlans: DirectorPlanV3[];
  genomeLibrary: GenomeLibrarySnapshot | null;
  narrativeState: StoryEvent | null;
  bossMemory: BossMemory | null;
  currentDifficultyId: DifficultyId;
  arenaId: string;
  arenaDamage: Record<string, number>;
  activeHazardTypes: string[];
  campaignResults: CampaignHistoryEntry[];
}

export class GameDesignContextBuilder {
  /**
   * Build a complete GameDesignContext from all available design-time data.
   */
  build(params: BuildContextParams): GameDesignContext {
    const campaign = params.campaignPlan;
    const world = params.worldState ?? this.deriveEmptyWorld();
    const currentChapter = campaign?.chapters[params.chapterIndex] ?? null;
    const previousPlans = this.summarizePreviousPlans(params.previousDirectorPlans);
    const library = params.genomeLibrary ?? createEmptyGenomeLibrarySnapshot();
    const history = this.buildCampaignHistory(params.campaignResults, params.chapterIndex, campaign);
    const curve = this.buildEmotionalCurve(campaign, params.chapterIndex);
    const difficulty = this.buildDifficulty(params.currentDifficultyId);
    const arena = this.buildArena(params.arenaId, params.arenaDamage, params.activeHazardTypes);
    const topline = this.buildTopline(params, history, curve, world);

    return {
      version: 1,
      playerProfile: params.playerProfile,
      playerEstimate: params.playerEstimate,
      playerPrediction: params.playerPrediction,
      campaignPlan: campaign ?? this.emptyCampaignPlan(),
      currentChapter,
      campaignHistory: history,
      worldState: world,
      previousDirectorPlans: previousPlans,
      genomeLibrary: library,
      narrativeState: params.narrativeState,
      emotionalCurve: curve,
      bossMemory: params.bossMemory,
      currentDifficulty: difficulty,
      arenaState: arena,
      topline,
    };
  }

  // --------------------------------------------------------------------------
  // Compress — reduce context size for small-context models.
  // Drops verbose fields, keeps the topline and the essentials.
  // --------------------------------------------------------------------------
  compress(ctx: GameDesignContext, maxTokens: number): GameDesignContext {
    const estimated = JSON.stringify(ctx).length / 4;
    if (estimated <= maxTokens * 0.6) return ctx;

    // Drop deep details, keep the topline, current chapter, prediction top-5,
    // and the most recent director plan.
    const topPredictions: Record<string, number> = Object.fromEntries(
      Object.entries(ctx.playerPrediction as unknown as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    );

    return {
      ...ctx,
      playerProfile: {
        ...ctx.playerProfile,
        favouriteAttacks: this.topEntries(ctx.playerProfile.favouriteAttacks, 3),
      },
      playerPrediction: { ...ctx.playerPrediction, ...topPredictions } as PlayerPrediction,
      previousDirectorPlans: {
        recent: ctx.previousDirectorPlans.recent.slice(0, 3),
        totalStored: ctx.previousDirectorPlans.totalStored,
      },
      genomeLibrary: {
        ...ctx.genomeLibrary,
        entries: ctx.genomeLibrary.entries.slice(0, 3),
      },
      campaignHistory: {
        ...ctx.campaignHistory,
        entries: ctx.campaignHistory.entries.slice(-5),
      },
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private topEntries<V>(record: Record<string, V>, k: number): Record<string, V> {
    return Object.fromEntries(Object.entries(record).slice(0, k));
  }

  private emptyCampaignPlan(): CampaignPlan {
    return {
      chapters: [],
      emotionalArc: { beats: [], currentBeat: 0 },
      totalChapters: 0,
      createdAt: 0,
    };
  }

  private deriveEmptyWorld(): DerivedWorldState {
    const ws = createInitialWorldState();
    return {
      villagesDestroyed: ws.villagesDestroyed,
      templesDestroyed: ws.templesDestroyed,
      civiliansAlive: ws.civiliansAlive,
      heroesDefeated: ws.bossesKilled,
      heroesSpared: ws.bossesSpared,
      playerReputation: ws.playerReputation,
      worldFear: ws.worldFear,
      darknessLevel: ws.darknessLevel,
      corruptionLevel: ws.corruptionLevel,
      hopeLevel: ws.hopeLevel,
      sealsBroken: 0,
      arenaDamage: ws.arenaDamage,
      weatherHistory: ws.weatherHistory,
      bloodMoonActive: false,
      eventCount: 0,
    };
  }

  private buildCampaignHistory(
    results: CampaignHistoryEntry[],
    chapterIndex: number,
    plan: CampaignPlan | null,
  ): CampaignHistory {
    if (results.length === 0) return createEmptyCampaignHistory();

    const completed = results.filter(r => r.playerWon !== undefined);
    const wins = completed.filter(r => r.playerWon).length;
    const ratios = completed.map(r => r.damageRatio);
    const avg = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;

    return {
      entries: results.slice(-PREVIOUS_PLANS_HISTORY_LIMIT),
      currentChapterIndex: chapterIndex,
      totalChapters: plan?.totalChapters ?? results.length,
      completedChapters: completed.length,
      winRate: completed.length > 0 ? wins / completed.length : 0,
      averageDamageRatio: avg,
    };
  }

  private summarizePreviousPlans(plans: DirectorPlanV3[]): PreviousDirectorPlans {
    if (plans.length === 0) return createEmptyPreviousDirectorPlans();
    const recent: PreviousDirectorPlanSummary[] = plans.slice(-PREVIOUS_PLANS_HISTORY_LIMIT).map(p => ({
      chapterIndex: p.chapter?.chapterIndex ?? -1,
      intent: p.intent.objective,
      weather: p.weather.type,
      bossStyle: p.bossStyle,
      difficulty: p.difficulty,
      emotion: p.chapter?.emotion ?? p.intent.emotion,
      playerWon: null,
      timestamp: 0,
    }));
    return { recent, totalStored: plans.length };
  }

  private buildEmotionalCurve(
    plan: CampaignPlan | null,
    chapterIndex: number,
  ): EmotionalCurveSnapshot {
    if (!plan) {
      return {
        arcId: -1,
        currentBeat: 0,
        totalBeats: 0,
        currentEmotion: "confidence",
        currentIntensity: 0.5,
        upcomingBeats: [],
        previousBeats: [],
        trajectory: "steady",
      };
    }
    const beats = plan.emotionalArc.beats;
    const cur = getCurrentEmotion(plan.emotionalArc);
    const idx = plan.emotionalArc.currentBeat;
    const upcoming: typeof beats = [];
    const previous: typeof beats = [];
    for (let i = 1; i <= 3; i++) {
      const u = beats[idx + i];
      if (u) upcoming.push(u);
      const p = beats[idx - i];
      if (p) previous.push(p);
    }
    let trajectory: EmotionalCurveSnapshot["trajectory"] = "steady";
    if (upcoming.length > 0 && upcoming[0].intensity > cur.intensity + 0.1) trajectory = "rising";
    else if (upcoming.length > 0 && upcoming[0].intensity < cur.intensity - 0.1) trajectory = "falling";
    if (idx >= beats.length - 2) trajectory = "peaking";

    return {
      arcId: 0, // single-arc campaigns; could be multi-arc later
      currentBeat: idx,
      totalBeats: beats.length,
      currentEmotion: cur.emotion,
      currentIntensity: cur.intensity,
      upcomingBeats: upcoming,
      previousBeats: previous.reverse(),
      trajectory,
    };
  }

  private buildDifficulty(id: DifficultyId): CurrentDifficulty {
    const d = DIFFICULTIES[id];
    return {
      id: d.id,
      aggressionMul: d.aggressionMul,
      reactionMul: d.reactionMul,
      damageMul: d.damageMul,
      aiAdaptive: d.aiAdaptive,
      aiPerfection: d.aiPerfection,
    };
  }

  private buildArena(
    arenaId: string,
    arenaDamage: Record<string, number>,
    activeHazardTypes: string[],
  ): ArenaState {
    const dmg = arenaDamage[arenaId] ?? 0;
    return {
      arenaId,
      stage: Math.min(5, Math.floor(dmg)),
      damageLevel: Math.min(1, dmg / 5),
      visibleCracks: Math.floor(dmg * 4),
      activeHazardTypes: [...activeHazardTypes],
    };
  }

  private buildTopline(
    params: BuildContextParams,
    history: CampaignHistory,
    curve: EmotionalCurveSnapshot,
    world: DerivedWorldState,
  ): GameDesignTopline {
    const recent = history.entries.slice(-5);
    let wins = 0;
    let losses = 0;
    for (const r of recent) {
      if (r.playerWon) wins++;
      else losses++;
    }
    const recentWinStreak = this.tailStreak(recent.map(r => r.playerWon));
    const recentLossStreak = this.tailStreak(recent.map(r => !r.playerWon));

    // Dominant strategy: most-used attack, with safety.
    const attacks = Object.entries(params.playerProfile.favouriteAttacks ?? {});
    attacks.sort((a, b) => b[1] - a[1]);
    const dominantStrategy = attacks[0]?.[0] ?? params.playerEstimate.favouriteStrategies[0] ?? "balanced";

    // Biggest weakness: the prediction with the lowest score.
    const preds = params.playerPrediction as unknown as Record<string, number>;
    const predEntries = Object.entries(preds).sort((a, b) => a[1] - b[1]);
    const biggestWeakness = predEntries[0]?.[0] ?? "none";
    const strongestTrait = predEntries[predEntries.length - 1]?.[0] ?? "none";

    // Mood: derived from recent win/loss + confidence.
    let mood: GameDesignTopline["currentMood"];
    if (wins >= 3) mood = "overconfident";
    else if (losses >= 3) mood = "frustrated";
    else if (params.playerEstimate.curiosity > 0.7) mood = "engaged";
    else if (params.playerEstimate.riskTolerance < 0.3) mood = "bored";
    else mood = "focused";

    // World trajectory
    let worldTrajectory: GameDesignTopline["worldTrajectory"];
    if (world.corruptionLevel > 0.5 || world.darknessLevel > 0.5) worldTrajectory = "darkening";
    else if (world.hopeLevel > 0.5) worldTrajectory = "brightening";
    else worldTrajectory = "stable";

    // Narrative phase
    let narrativePhase: GameDesignTopline["narrativePhase"];
    if (curve.currentBeat === 0) narrativePhase = "opening";
    else if (curve.trajectory === "rising") narrativePhase = "rising";
    else if (curve.trajectory === "peaking") narrativePhase = "climax";
    else if (curve.trajectory === "falling") narrativePhase = "falling";
    else narrativePhase = "rising";

    // Recommended posture
    let recommendedPosture: GameDesignTopline["recommendedPosture"];
    if (mood === "overconfident") recommendedPosture = "punish";
    else if (mood === "frustrated") recommendedPosture = "reward";
    else if (mood === "bored") recommendedPosture = "challenge";
    else if (mood === "engaged") recommendedPosture = "teach";
    else recommendedPosture = "challenge";

    return {
      recentWinStreak,
      recentLossStreak,
      dominantStrategy,
      biggestWeakness,
      strongestTrait,
      currentMood: mood,
      worldTrajectory,
      narrativePhase,
      recommendedPosture,
    };
  }

  private tailStreak(values: boolean[]): number {
    let count = 0;
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i]) count++;
      else break;
    }
    return count;
  }
}
