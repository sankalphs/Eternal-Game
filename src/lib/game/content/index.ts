// ============================================================================
// Content Library Index — single import point for all prebuilt content
// AND the procedural modifier system.
// The AI Director and engine import from here.
// ============================================================================

// Prebuilt presets (V1)
export { WEATHER, type WeatherId, type WeatherProfile } from "./weather";
export { HAZARDS, type HazardId, type HazardProfile } from "./hazards";
export { CAMERAS, type CameraId, type CameraProfile } from "./cameras";
export { MUSIC, type MusicId, type MusicProfile } from "./music";
export { CROWDS, type CrowdId, type CrowdProfile } from "./crowds";
export { BOSS_STYLES, applyBossStyle, type BossStyleId, type BossStyleProfile } from "./boss_styles";
export { DIFFICULTIES, type DifficultyId, type DifficultyProfile } from "./difficulties";

// Procedural modifiers (V2 — replaces rigid presets with parameter combinations)
export {
  createFog, createRain, createAsh, createSnow, createEmbers, createFireflies,
  createLighting, createCamera, createHazard,
  type WeatherModifier, type LightingModifier, type CameraModifier, type HazardModifier,
} from "./modifiers";
