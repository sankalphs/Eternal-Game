// ============================================================================
// CAMPAIGN PLANNER — the most important module. Creates the next 5-10 fights
// as a coherent campaign with emotional arcs, escalating difficulty, and
// narrative purpose. Each fight is a CHAPTER, not just a match.
//
// The planner can modify FUTURE fights based on player behaviour (if the
// player is dominating, future fights get harder; if struggling, they ease).
// ============================================================================

import type { PlayerEstimate } from "../prediction/PlayerAnalyzer";
import type { PlayerPrediction } from "../prediction/PredictionEngine";
import type { DerivedWorldState } from "../eventsourcing/WorldHistory";
import {
  type EmotionalCurve, type EmotionalBeat, type Emotion,
  selectEmotionalArc, getCurrentEmotion, advanceEmotion,
  EMOTION_PROFILES, type EmotionProfile,
} from "./EmotionalCurve";
import type { BossStyleId } from "../content/boss_styles";
import type { DifficultyId } from "../content/difficulties";

export interface CampaignChapter {
  chapterIndex: number;        // 0-based
  opponentName: string;
  opponentTitle: string;
  bossStyle: BossStyleId;
  difficulty: DifficultyId;
  emotion: Emotion;
  emotionProfile: EmotionProfile;
  emotionalBeat: EmotionalBeat;
  targetExperience: string;    // what the player should feel
  narrativePurpose: string;    // why this fight exists in the story
  worldChangeEvent?: string;   // what happens to the world after this fight
  // Curiosity experiment (Phase 7) — null if no experiment
  experiment: CuriosityExperiment | null;
}

export interface CuriosityExperiment {
  description: string;
  modification: "no_music" | "low_visibility" | "boss_passive" | "silent_arena" | "habit_breaker";
}

export interface CampaignPlan {
  chapters: CampaignChapter[];
  emotionalArc: EmotionalCurve;
  totalChapters: number;
  createdAt: number;
}

export interface CampaignPlannerDeps {
  estimate: PlayerEstimate;
  prediction: PlayerPrediction;
  worldState: DerivedWorldState;
  opponentNames: { name: string; title: string }[];
}

export class CampaignPlanner {
  /**
   * Generate a full campaign plan (5-10 chapters). Each chapter is a fight
   * with a specific emotional purpose, difficulty target, and narrative event.
   */
  planCampaign(deps: CampaignPlannerDeps): CampaignPlan {
    const { estimate, prediction, worldState, opponentNames } = deps;

    // 1. Select the emotional arc based on player psychology
    const emotionalArc = selectEmotionalArc(
      estimate.skill,
      estimate.confidence, // proxy for aggression in arc selection
      estimate.patience,
      estimate.riskTolerance,
    );

    // 2. Determine campaign length (8 opponents = 8 chapters)
    const totalChapters = Math.min(8, opponentNames.length);

    // 3. Generate each chapter
    const chapters: CampaignChapter[] = [];
    for (let i = 0; i < totalChapters; i++) {
      const beat = emotionalArc.beats[i] ?? emotionalArc.beats[emotionalArc.beats.length - 1];
      const emotionProfile = EMOTION_PROFILES[beat.emotion];

      const chapter = this.planChapter(i, beat, emotionProfile, estimate, prediction, worldState, opponentNames[i]);
      chapters.push(chapter);
    }

    // 4. Insert curiosity experiments at strategic points (Phase 7)
    this.injectExperiments(chapters, estimate, prediction);

    return {
      chapters,
      emotionalArc,
      totalChapters,
      createdAt: Date.now(),
    };
  }

  /**
   * Update the campaign after a match. Can modify FUTURE chapters based on
   * how the player performed. This is what makes the campaign adaptive.
   */
  updateAfterMatch(
    plan: CampaignPlan,
    completedChapter: number,
    won: boolean,
    updatedEstimate: PlayerEstimate,
    updatedPrediction: PlayerPrediction,
    updatedWorldState: DerivedWorldState,
  ): CampaignPlan {
    const chapters = [...plan.chapters];
    const emotionalArc = advanceEmotion(plan.emotionalArc);

    // If the player is struggling (lost 2+ in a row), ease future chapters
    const recentLosses = this.countRecentLosses(plan, completedChapter);
    if (!won && recentLosses >= 2) {
      for (let i = completedChapter + 1; i < chapters.length; i++) {
        chapters[i] = this.easeChapter(chapters[i]);
      }
    }

    // If the player is dominating (won 3+ in a row), make future chapters harder
    const recentWins = this.countRecentWins(plan, completedChapter);
    if (won && recentWins >= 3) {
      for (let i = completedChapter + 1; i < chapters.length; i++) {
        chapters[i] = this.hardenChapter(chapters[i]);
      }
    }

    // If the player is getting frustrated, inject a curiosity experiment
    // to break the monotony
    if (updatedEstimate.frustrationTolerance < 0.3 && completedChapter + 1 < chapters.length) {
      chapters[completedChapter + 1] = this.addExperiment(
        chapters[completedChapter + 1],
        { description: "Break the player's frustration with a novel experience.", modification: "habit_breaker" },
      );
    }

    // Update emotional arc progression
    return { ...plan, chapters, emotionalArc };
  }

  // ---- Chapter planning ----

  private planChapter(
    index: number,
    beat: EmotionalBeat,
    emotionProfile: EmotionProfile,
    estimate: PlayerEstimate,
    prediction: PlayerPrediction,
    worldState: DerivedWorldState,
    opponent: { name: string; title: string },
  ): CampaignChapter {
    const difficulty = this.selectDifficulty(index, estimate, false);
    const bossStyle = this.selectBossStyle(beat.emotion, prediction, estimate);
    const experiment = this.shouldExperiment(index, estimate) ? this.createExperiment(index, prediction) : null;

    let targetExperience: string;
    let narrativePurpose: string;
    let worldChangeEvent: string | undefined;

    switch (beat.emotion) {
      case "wonder":
        targetExperience = "The player should feel awe and curiosity about the world.";
        narrativePurpose = "Introduce the world and the player's role as the Shadow.";
        worldChangeEvent = "CampaignStarted";
        break;
      case "confidence":
        targetExperience = "The player should feel powerful and in control.";
        narrativePurpose = "Build confidence before the difficulty escalates.";
        break;
      case "suspicion":
        targetExperience = "Something should feel slightly wrong — the world shifts.";
        narrativePurpose = "Introduce doubt. The world is not what it seems.";
        break;
      case "fear":
        targetExperience = "The player should feel genuinely threatened.";
        narrativePurpose = "The sealers are real threats. Stakes are established.";
        break;
      case "hopelessness":
        targetExperience = "The player should question whether they can win.";
        narrativePurpose = "Lowest point. The world is dark and the odds are against them.";
        worldChangeEvent = "BloodMoonAppeared";
        break;
      case "determination":
        targetExperience = "The player should feel resolve — one more push.";
        narrativePurpose = "The turning point. The player decides to fight on.";
        break;
      case "rage":
        targetExperience = "Everything burns. The player is unstoppable and terrifying.";
        narrativePurpose = "The Shadow's full power is unleashed.";
        worldChangeEvent = "VillageBurned";
        break;
      case "victory":
      case "triumph":
        targetExperience = "Catharsis. The campaign is won.";
        narrativePurpose = "Resolution. The gates are open. The world is changed forever.";
        worldChangeEvent = "CampaignEnded";
        break;
      case "curiosity":
        targetExperience = "The player wants to understand the sealers, not just break them.";
        narrativePurpose = "A different kind of fight — one that asks questions.";
        break;
      case "chaos":
        targetExperience = "Disorientation. The rules seem to change.";
        narrativePurpose = "The world destabilizes. Nothing is certain.";
        worldChangeEvent = "TempleCollapsed";
        break;
      case "isolation":
        targetExperience = "Loneliness. The player is alone in a ruined world.";
        narrativePurpose = "The cost of the Shadow's path becomes visible.";
        break;
      case "despair":
        targetExperience = "The weight of everything lost.";
        narrativePurpose = "The Shadow confronts what it has done.";
        break;
      case "serene":
        targetExperience = "A strange peace. The fighting means something else now.";
        narrativePurpose = "Transcendence. The Shadow finds meaning beyond destruction.";
        break;
      case "awe":
        targetExperience = "The magnitude of what happened sinks in.";
        narrativePurpose = "The final reckoning. The world is forever changed.";
        worldChangeEvent = "CampaignEnded";
        break;
      default:
        targetExperience = "The player should feel engaged and challenged.";
        narrativePurpose = "Advance the campaign.";
    }

    return {
      chapterIndex: index,
      opponentName: opponent.name,
      opponentTitle: opponent.title,
      bossStyle,
      difficulty,
      emotion: beat.emotion,
      emotionProfile,
      emotionalBeat: beat,
      targetExperience,
      narrativePurpose,
      worldChangeEvent,
      experiment,
    };
  }

  // ---- Difficulty selection ----

  private selectDifficulty(chapterIndex: number, estimate: PlayerEstimate, won: boolean): DifficultyId {
    // Base difficulty scales with chapter
    let base: DifficultyId = "normal";
    if (chapterIndex >= 6) base = "brutal";
    else if (chapterIndex >= 4) base = "hard";
    else if (chapterIndex >= 2) base = "normal";

    // Adjust for player skill
    if (estimate.skill > 0.7 && base === "normal") base = "hard";
    if (estimate.skill > 0.8 && base === "hard") base = "brutal";
    if (estimate.skill < 0.3 && base === "hard") base = "normal";
    if (estimate.skill < 0.2 && base === "brutal") base = "hard";

    return base;
  }

  // ---- Boss style selection — aligned to emotion + counters prediction ----

  private selectBossStyle(
    emotion: Emotion,
    prediction: PlayerPrediction,
    estimate: PlayerEstimate,
  ): BossStyleId {
    // First, get the emotion-driven style
    const emotionStyle = EMOTION_PROFILES[emotion].bossPersonality as BossStyleId;

    // Then adjust based on predictions — counter the player's predicted behaviour
    if (prediction.kickSpam > 0.7) return "counter";      // counter the kick spam
    if (prediction.earlyRush > 0.7) return "zoner";        // keep them out
    if (prediction.blockTurtle > 0.7) return "rushdown";   // break the turtle
    if (prediction.superSave > 0.8) return "aggressive";   // force them to use super early
    if (prediction.panicRoll > 0.6) return "punisher";     // punish the panic rolls
    if (estimate.adaptability > 0.7) return "mind_game";    // match their adaptability
    if (estimate.skill > 0.8) return "adaptive";           // evolve against skilled players

    return emotionStyle;
  }

  // ---- Curiosity experiments (Phase 7) ----

  private shouldExperiment(chapterIndex: number, estimate: PlayerEstimate): boolean {
    // Experiments at chapters 2 and 5 (midpoints), only if the player is
    // curious or experienced enough to appreciate them
    if (chapterIndex !== 2 && chapterIndex !== 5) return false;
    return estimate.curiosity > 0.4 || estimate.matchesAnalyzed > 3;
  }

  private createExperiment(chapterIndex: number, prediction: PlayerPrediction): CuriosityExperiment {
    // Choose an experiment that disrupts the player's predicted habits
    if (prediction.blockTurtle > 0.6) {
      return { description: "The boss never attacks first — the player must initiate.", modification: "boss_passive" };
    }
    if (prediction.hazardAvoid > 0.5) {
      return { description: "Visibility reduced to 20% — the player can't rely on sight.", modification: "low_visibility" };
    }
    if (prediction.kickSpam > 0.5 || prediction.punchSpam > 0.5) {
      return { description: "The arena is silent — no audio cues. Habit patterns are disrupted.", modification: "silent_arena" };
    }
    // Default: remove music to create an unsettling atmosphere
    return { description: "No music. Only the sound of combat.", modification: "no_music" };
  }

  private injectExperiments(chapters: CampaignChapter[], estimate: PlayerEstimate, prediction: PlayerPrediction) {
    // Already handled in planChapter via shouldExperiment + createExperiment
    // This method is a no-op — experiments are injected during planning
  }

  private addExperiment(chapter: CampaignChapter, exp: CuriosityExperiment): CampaignChapter {
    return { ...chapter, experiment: exp };
  }

  // ---- Adaptive adjustments ----

  private easeChapter(chapter: CampaignChapter): CampaignChapter {
    const difficultyMap: Record<string, DifficultyId> = {
      nightmare: "brutal", brutal: "hard", hard: "normal", normal: "easy", easy: "easy",
    };
    return { ...chapter, difficulty: difficultyMap[chapter.difficulty] ?? "normal" };
  }

  private hardenChapter(chapter: CampaignChapter): CampaignChapter {
    const difficultyMap: Record<string, DifficultyId> = {
      easy: "normal", normal: "hard", hard: "brutal", brutal: "nightmare", nightmare: "nightmare",
    };
    return { ...chapter, difficulty: difficultyMap[chapter.difficulty] ?? "hard" };
  }

  private countRecentLosses(plan: CampaignPlan, completedChapter: number): number {
    // This would normally track win/loss history; for now, we use a placeholder
    // that the caller updates. In a real implementation, the CampaignPlan would
    // store results per chapter.
    return 0;
  }

  private countRecentWins(plan: CampaignPlan, completedChapter: number): number {
    return 0;
  }
}
