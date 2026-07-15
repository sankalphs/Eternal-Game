// ============================================================================
// WORLD MEMORY — persistent world state that evolves with player actions.
//
// Every victory, defeat, and spare changes the world. Never resets.
// Persists across browser refreshes via the Persistence layer.
// ============================================================================

export interface WorldState {
  // Destruction counters
  villagesDestroyed: number;
  templesDestroyed: number;
  civiliansAlive: number;       // starts high, decreases
  bossesKilled: number;
  bossesSpared: number;

  // World mood (0..1 scales)
  playerReputation: number;     // 0 = feared tyrant, 1 = merciful lord
  worldFear: number;            // 0..1, rises with destruction
  darknessLevel: number;        // 0..1, rises with corruption
  corruptionLevel: number;      // 0..1, rises with killing
  hopeLevel: number;            // 0..1, rises with sparing

  // Environmental state
  weatherHistory: string[];     // last 20 weather IDs
  arenaDamage: Record<string, number>; // arenaId → 0..5 damage stage
  currentSeason: "spring" | "summer" | "autumn" | "winter";

  // Mythology
  mythology: MythEntry[];
  campaignHistory: CampaignRecord[];

  // Boss memories (Phase 7)
  bossMemories: Record<string, BossMemory>;

  // Meta
  totalPlayTime: number;        // seconds
  lastPlayed: number;           // timestamp
  version: number;              // schema version for migrations
}

export interface MythEntry {
  year: number;                 // in-world year
  location: string;
  event: string;
  consequence: string;
  legend: string;               // the poetic retelling
}

export interface CampaignRecord {
  opponentName: string;
  opponentIndex: number;
  won: boolean;
  spared: boolean;
  roundsToWin: number;
  damageDealt: number;
  damageTaken: number;
  timestamp: number;
}

export interface BossMemory {
  bossName: string;
  encounters: number;
  playerWins: number;
  bossWins: number;
  previousLossReason: string | null;    // "whiff_punished", "cornered", "out_zoned", etc.
  playerFavouriteAttack: string | null;  // most used attack in encounters
  successfulCounters: number;            // boss successfully countered player
  failedCounters: number;                // boss failed to counter
  preferredSpacing: "close" | "mid" | "far" | null;
  lastFightResult: "win" | "loss" | null;
  adaptationNotes: string[];             // textual notes for the Director
}

export function createInitialWorldState(): WorldState {
  return {
    villagesDestroyed: 0,
    templesDestroyed: 0,
    civiliansAlive: 10000,
    bossesKilled: 0,
    bossesSpared: 0,
    playerReputation: 0.5,
    worldFear: 0.1,
    darknessLevel: 0.05,
    corruptionLevel: 0.0,
    hopeLevel: 0.5,
    weatherHistory: [],
    arenaDamage: {},
    currentSeason: "autumn",
    mythology: [],
    campaignHistory: [],
    bossMemories: {},
    totalPlayTime: 0,
    lastPlayed: Date.now(),
    version: 1,
  };
}

// ============================================================================
// WorldState mutations — called by the engine after matches, never during.
// ============================================================================

export function onBossKilled(world: WorldState, bossName: string): WorldState {
  const updated = { ...world };
  updated.bossesKilled++;
  updated.corruptionLevel = Math.min(1, world.corruptionLevel + 0.12);
  updated.darknessLevel = Math.min(1, world.darknessLevel + 0.08);
  updated.worldFear = Math.min(1, world.worldFear + 0.1);
  updated.hopeLevel = Math.max(0, world.hopeLevel - 0.1);
  updated.playerReputation = Math.max(0, world.playerReputation - 0.1);
  updated.civiliansAlive = Math.max(0, world.civiliansAlive - Math.floor(Math.random() * 500 + 200));

  // Damage the arena
  if (!updated.arenaDamage[bossName]) updated.arenaDamage[bossName] = 0;
  updated.arenaDamage[bossName] = Math.min(5, updated.arenaDamage[bossName] + 1);

  return updated;
}

export function onBossSpared(world: WorldState, bossName: string): WorldState {
  const updated = { ...world };
  updated.bossesSpared++;
  updated.hopeLevel = Math.min(1, world.hopeLevel + 0.15);
  updated.playerReputation = Math.min(1, world.playerReputation + 0.1);
  updated.worldFear = Math.max(0, world.worldFear - 0.05);
  updated.corruptionLevel = Math.max(0, world.corruptionLevel - 0.03);
  return updated;
}

export function onPlayerDefeated(world: WorldState, bossName: string): WorldState {
  const updated = { ...world };
  updated.hopeLevel = Math.min(1, world.hopeLevel + 0.05); // the world gains hope when the villain loses
  updated.worldFear = Math.max(0, world.worldFear - 0.05);
  updated.darknessLevel = Math.max(0, world.darknessLevel - 0.03);
  return updated;
}

export function addMythEntry(world: WorldState, entry: MythEntry): WorldState {
  return { ...world, mythology: [...world.mythology, entry] };
}

export function addCampaignRecord(world: WorldState, record: CampaignRecord): WorldState {
  return { ...world, campaignHistory: [...world.campaignHistory, record] };
}

export function updateBossMemory(
  world: WorldState,
  bossName: string,
  result: {
    won: boolean;
    lossReason?: string;
    favouriteAttack?: string;
    spacing?: "close" | "mid" | "far";
    bossCountered?: boolean;
  },
): WorldState {
  const existing: BossMemory = world.bossMemories[bossName] ?? {
    bossName,
    encounters: 0,
    playerWins: 0,
    bossWins: 0,
    previousLossReason: null,
    playerFavouriteAttack: null,
    successfulCounters: 0,
    failedCounters: 0,
    preferredSpacing: null,
    lastFightResult: null,
    adaptationNotes: [],
  };

  const notes = [...existing.adaptationNotes];
  if (result.lossReason) notes.push(`Player lost to ${bossName}: ${result.lossReason}`);
  if (result.favouriteAttack) notes.push(`Player favours ${result.favouriteAttack} against ${bossName}`);
  if (result.bossCountered !== undefined) {
    if (result.bossCountered) notes.push(`${bossName} successfully countered the player`);
    else notes.push(`${bossName} failed to counter the player`);
  }

  const updated: BossMemory = {
    ...existing,
    encounters: existing.encounters + 1,
    playerWins: existing.playerWins + (result.won ? 1 : 0),
    bossWins: existing.bossWins + (result.won ? 0 : 1),
    previousLossReason: result.won ? null : (result.lossReason ?? existing.previousLossReason),
    playerFavouriteAttack: result.favouriteAttack ?? existing.playerFavouriteAttack,
    successfulCounters: existing.successfulCounters + (result.bossCountered === true ? 1 : 0),
    failedCounters: existing.failedCounters + (result.bossCountered === false ? 1 : 0),
    preferredSpacing: result.spacing ?? existing.preferredSpacing,
    lastFightResult: result.won ? "win" : "loss",
    adaptationNotes: notes.slice(-20), // keep last 20 notes
  };

  return { ...world, bossMemories: { ...world.bossMemories, [bossName]: updated } };
}
