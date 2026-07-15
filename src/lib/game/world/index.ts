// ============================================================================
// World Memory index — single import point.
// ============================================================================
export {
  createInitialWorldState,
  onBossKilled,
  onBossSpared,
  onPlayerDefeated,
  addMythEntry,
  addCampaignRecord,
  updateBossMemory,
  type WorldState,
  type MythEntry,
  type CampaignRecord,
  type BossMemory,
} from "./WorldState";
export {
  getArenaStage,
  getArenaEvolution,
  getArenaStageLabel,
  type ArenaStage,
  type ArenaEvolutionConfig,
} from "./ArenaEvolution";
