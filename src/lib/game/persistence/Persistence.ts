// ============================================================================
// PERSISTENCE — saves and loads all AI systems to browser storage.
//
// Persists: PlayerProfile, WorldState, Mythology, Boss memories, Campaign history.
// The world survives browser refreshes.
// ============================================================================

import type { WorldState } from "../world/WorldState";
import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { PlayerEstimate } from "../prediction/PlayerAnalyzer";
import type { WorldEvent } from "../eventsourcing/WorldHistory";
import type { CampaignPlan } from "../campaign/CampaignPlanner";

const KEYS = {
  world: "eternal_world_state",
  player: "eternal_player_profile",
  estimate: "eternal_player_estimate",
  events: "eternal_world_events",
  campaign: "eternal_campaign_plan",
  version: "eternal_schema_version",
};

const SCHEMA_VERSION = 2;

export interface PersistedState {
  world: WorldState | null;
  player: PlayerProfile | null;
  estimate: PlayerEstimate | null;
  events: WorldEvent[] | null;
  campaign: CampaignPlan | null;
}

export class Persistence {
  /** Save the full game state to localStorage. */
  save(state: PersistedState): void {
    try {
      if (state.world) localStorage.setItem(KEYS.world, JSON.stringify(state.world));
      if (state.player) localStorage.setItem(KEYS.player, JSON.stringify(state.player));
      if (state.estimate) localStorage.setItem(KEYS.estimate, JSON.stringify(state.estimate));
      if (state.events) localStorage.setItem(KEYS.events, JSON.stringify(state.events));
      if (state.campaign) localStorage.setItem(KEYS.campaign, JSON.stringify(state.campaign));
      localStorage.setItem(KEYS.version, String(SCHEMA_VERSION));
    } catch {
      // localStorage may be full or unavailable (private mode)
    }
  }

  /** Load the full game state from localStorage. */
  load(): PersistedState {
    try {
      const worldRaw = localStorage.getItem(KEYS.world);
      const playerRaw = localStorage.getItem(KEYS.player);
      const estimateRaw = localStorage.getItem(KEYS.estimate);
      const eventsRaw = localStorage.getItem(KEYS.events);
      const campaignRaw = localStorage.getItem(KEYS.campaign);
      return {
        world: worldRaw ? JSON.parse(worldRaw) as WorldState : null,
        player: playerRaw ? JSON.parse(playerRaw) as PlayerProfile : null,
        estimate: estimateRaw ? JSON.parse(estimateRaw) as PlayerEstimate : null,
        events: eventsRaw ? JSON.parse(eventsRaw) as WorldEvent[] : null,
        campaign: campaignRaw ? JSON.parse(campaignRaw) as CampaignPlan : null,
      };
    } catch {
      return { world: null, player: null, estimate: null, events: null, campaign: null };
    }
  }

  /** Check if a saved game exists. */
  hasSave(): boolean {
    try {
      return localStorage.getItem(KEYS.world) !== null;
    } catch {
      return false;
    }
  }

  /** Clear all saved state (new game). */
  clear(): void {
    try {
      localStorage.removeItem(KEYS.world);
      localStorage.removeItem(KEYS.player);
      localStorage.removeItem(KEYS.estimate);
      localStorage.removeItem(KEYS.events);
      localStorage.removeItem(KEYS.campaign);
      localStorage.removeItem(KEYS.version);
    } catch {
      // ignore
    }
  }

  /** Save just the world state. */
  saveWorld(world: WorldState): void {
    try {
      localStorage.setItem(KEYS.world, JSON.stringify(world));
    } catch { /* ignore */ }
  }

  /** Save just the player profile. */
  savePlayer(profile: PlayerProfile): void {
    try {
      localStorage.setItem(KEYS.player, JSON.stringify(profile));
    } catch { /* ignore */ }
  }

  /** Load just the world state. */
  loadWorld(): WorldState | null {
    try {
      const raw = localStorage.getItem(KEYS.world);
      return raw ? JSON.parse(raw) as WorldState : null;
    } catch {
      return null;
    }
  }

  /** Load just the player profile. */
  loadPlayer(): PlayerProfile | null {
    try {
      const raw = localStorage.getItem(KEYS.player);
      return raw ? JSON.parse(raw) as PlayerProfile : null;
    } catch {
      return null;
    }
  }

  /** Save the player estimate. */
  saveEstimate(estimate: PlayerEstimate): void {
    try { localStorage.setItem(KEYS.estimate, JSON.stringify(estimate)); } catch { /* ignore */ }
  }

  /** Load the player estimate. */
  loadEstimate(): PlayerEstimate | null {
    try {
      const raw = localStorage.getItem(KEYS.estimate);
      return raw ? JSON.parse(raw) as PlayerEstimate : null;
    } catch { return null; }
  }

  /** Save the world event log. */
  saveEvents(events: WorldEvent[]): void {
    try { localStorage.setItem(KEYS.events, JSON.stringify(events)); } catch { /* ignore */ }
  }

  /** Load the world event log. */
  loadEvents(): WorldEvent[] | null {
    try {
      const raw = localStorage.getItem(KEYS.events);
      return raw ? JSON.parse(raw) as WorldEvent[] : null;
    } catch { return null; }
  }

  /** Save the campaign plan. */
  saveCampaign(plan: CampaignPlan): void {
    try { localStorage.setItem(KEYS.campaign, JSON.stringify(plan)); } catch { /* ignore */ }
  }

  /** Load the campaign plan. */
  loadCampaign(): CampaignPlan | null {
    try {
      const raw = localStorage.getItem(KEYS.campaign);
      return raw ? JSON.parse(raw) as CampaignPlan : null;
    } catch { return null; }
  }
}

// Singleton instance
export const persistence = new Persistence();
