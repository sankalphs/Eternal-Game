// ============================================================================
// EVENT-SOURCED WORLD — the single source of truth is an append-only event log.
// WorldState (fear, darkness, hope, etc.) is DERIVED from events, never stored.
//
// This means we can replay the entire world history from scratch and get the
// exact same derived state. No stale caches, no desync between events and state.
// ============================================================================

// All possible world events
export type WorldEvent =
  | { type: "TempleCollapsed"; location: string; timestamp: number }
  | { type: "VillageBurned"; villageName: string; casualties: number; timestamp: number }
  | { type: "HeroSpared"; heroName: string; timestamp: number }
  | { type: "HeroDefeated"; heroName: string; roundsToWin: number; timestamp: number }
  | { type: "PlayerDefeated"; heroName: string; timestamp: number }
  | { type: "BloodMoonAppeared"; timestamp: number }
  | { type: "MonksEscaped"; templeName: string; count: number; timestamp: number }
  | { type: "SealBroken"; sealId: number; timestamp: number }
  | { type: "ArenaDamaged"; arenaId: string; stage: number; timestamp: number }
  | { type: "WeatherChanged"; weatherType: string; timestamp: number }
  | { type: "MythCreated"; mythId: string; legend: string; timestamp: number }
  | { type: "CampaignStarted"; timestamp: number }
  | { type: "CampaignEnded"; won: boolean; timestamp: number };

export interface DerivedWorldState {
  villagesDestroyed: number;
  templesDestroyed: number;
  civiliansAlive: number;
  heroesDefeated: number;
  heroesSpared: number;
  playerReputation: number;     // 0=tyrant, 1=merciful
  worldFear: number;            // 0..1
  darknessLevel: number;        // 0..1
  corruptionLevel: number;      // 0..1
  hopeLevel: number;            // 0..1
  sealsBroken: number;
  arenaDamage: Record<string, number>;
  weatherHistory: string[];
  bloodMoonActive: boolean;
  eventCount: number;
}

export class WorldHistory {
  private events: WorldEvent[] = [];

  /** Append an event. This is the ONLY mutation method. */
  record(event: WorldEvent): void {
    this.events.push(event);
  }

  /** Get all events (for persistence). */
  getAll(): WorldEvent[] {
    return [...this.events];
  }

  /** Replace the event log (for loading from persistence). */
  replace(events: WorldEvent[]): void {
    this.events = [...events];
  }

  /** Derive the current world state by folding over all events. */
  derive(): DerivedWorldState {
    let state: DerivedWorldState = {
      villagesDestroyed: 0,
      templesDestroyed: 0,
      civiliansAlive: 10000,
      heroesDefeated: 0,
      heroesSpared: 0,
      playerReputation: 0.5,
      worldFear: 0.1,
      darknessLevel: 0.05,
      corruptionLevel: 0.0,
      hopeLevel: 0.5,
      sealsBroken: 0,
      arenaDamage: {},
      weatherHistory: [],
      bloodMoonActive: false,
      eventCount: 0,
    };

    for (const e of this.events) {
      state = this.apply(state, e);
    }

    return state;
  }

  /** Apply a single event to the derived state. */
  private apply(state: DerivedWorldState, e: WorldEvent): DerivedWorldState {
    const s = { ...state, arenaDamage: { ...state.arenaDamage } };

    switch (e.type) {
      case "TempleCollapsed":
        s.templesDestroyed++;
        s.darknessLevel = Math.min(1, s.darknessLevel + 0.05);
        s.worldFear = Math.min(1, s.worldFear + 0.05);
        break;
      case "VillageBurned":
        s.villagesDestroyed++;
        s.civiliansAlive = Math.max(0, s.civiliansAlive - e.casualties);
        s.corruptionLevel = Math.min(1, s.corruptionLevel + 0.06);
        s.worldFear = Math.min(1, s.worldFear + 0.04);
        s.hopeLevel = Math.max(0, s.hopeLevel - 0.05);
        break;
      case "HeroSpared":
        s.heroesSpared++;
        s.hopeLevel = Math.min(1, s.hopeLevel + 0.12);
        s.playerReputation = Math.min(1, s.playerReputation + 0.08);
        s.worldFear = Math.max(0, s.worldFear - 0.03);
        break;
      case "HeroDefeated":
        s.heroesDefeated++;
        s.sealsBroken++;
        s.corruptionLevel = Math.min(1, s.corruptionLevel + 0.1);
        s.darknessLevel = Math.min(1, s.darknessLevel + 0.07);
        s.worldFear = Math.min(1, s.worldFear + 0.08);
        s.hopeLevel = Math.max(0, s.hopeLevel - 0.08);
        s.playerReputation = Math.max(0, s.playerReputation - 0.08);
        break;
      case "PlayerDefeated":
        s.hopeLevel = Math.min(1, s.hopeLevel + 0.05);
        s.worldFear = Math.max(0, s.worldFear - 0.04);
        break;
      case "BloodMoonAppeared":
        s.bloodMoonActive = true;
        s.darknessLevel = Math.min(1, s.darknessLevel + 0.1);
        break;
      case "MonksEscaped":
        s.hopeLevel = Math.min(1, s.hopeLevel + 0.03);
        break;
      case "SealBroken":
        s.sealsBroken++;
        s.darknessLevel = Math.min(1, s.darknessLevel + 0.05);
        break;
      case "ArenaDamaged":
        s.arenaDamage[e.arenaId] = Math.min(5, e.stage);
        break;
      case "WeatherChanged":
        s.weatherHistory = [...s.weatherHistory, e.weatherType].slice(-20);
        break;
      case "MythCreated":
        // No state change — myths are stored in the event log itself
        break;
      case "CampaignStarted":
        break;
      case "CampaignEnded":
        break;
    }

    s.eventCount = this.events.length;
    return s;
  }

  /** Get events of a specific type. */
  filter(type: WorldEvent["type"]): WorldEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /** Check if an event has occurred. */
  hasOccurred(type: WorldEvent["type"]): boolean {
    return this.events.some((e) => e.type === type);
  }

  /** Get the last N events (for narrative display). */
  recent(n: number): WorldEvent[] {
    return this.events.slice(-n);
  }
}
