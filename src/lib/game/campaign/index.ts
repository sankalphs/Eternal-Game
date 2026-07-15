// ============================================================================
// Campaign system index.
// ============================================================================
export {
  CampaignPlanner,
  type CampaignPlan,
  type CampaignChapter,
  type CuriosityExperiment,
  type CampaignPlannerDeps,
} from "./CampaignPlanner";
export {
  selectEmotionalArc,
  getCurrentEmotion,
  advanceEmotion,
  EMOTIONAL_ARCS,
  EMOTION_PROFILES,
  type EmotionalCurve,
  type EmotionalBeat,
  type Emotion,
  type EmotionProfile,
} from "./EmotionalCurve";
