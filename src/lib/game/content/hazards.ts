// ============================================================================
// Hazard Library — 10 prebuilt hazard profiles.
// Selected by the AI Director. Applied by the engine's hazard system.
// ============================================================================

export type HazardId =
  | "none" | "volcano" | "temple_debris" | "ice_floor" | "poison_mist"
  | "moving_platforms" | "earthquake" | "fire_rain" | "darkness"
  | "falling_trees" | "wind_gusts";

export interface HazardProfile {
  id: HazardId;
  label: string;
  description: string;
  // Damage
  chipDamage: number;       // HP/s passive damage (0 = none)
  chipRange?: { left: number; right: number }; // stage area where chip applies
  // Spawn rate for dynamic hazards
  spawnRate: number;        // events per second (0 = none)
  spawnDamage: number;      // damage per spawned hazard hit
  spawnHitstun: number;     // hitstun on hit
  // Physics modifier
  slipFactor: number;       // 0 = normal, 1 = no friction (ice)
  windForce: number;        // horizontal force applied to fighters
  // Visual
  visualEffect: "none" | "embers" | "debris" | "mist" | "ice" | "fire" | "darkness" | "leaves";
  visualColor: string;
  // Screen effect
  screenShake: number;      // base shake per second
  darknessLevel: number;    // 0..1, reduces visibility
}

export const HAZARDS: Record<HazardId, HazardProfile> = {
  none: {
    id: "none", label: "No Hazards", description: "A clean fight.",
    chipDamage: 0, spawnRate: 0, spawnDamage: 0, spawnHitstun: 0,
    slipFactor: 0, windForce: 0,
    visualEffect: "none", visualColor: "#000",
    screenShake: 0, darknessLevel: 0,
  },
  volcano: {
    id: "volcano", label: "Burning Edges", description: "Stage edges burn fighters.",
    chipDamage: 6, chipRange: { left: 36, right: 36 },
    spawnRate: 8, spawnDamage: 0, spawnHitstun: 0,
    slipFactor: 0, windForce: 0,
    visualEffect: "embers", visualColor: "#fb923c",
    screenShake: 0, darknessLevel: 0,
  },
  temple_debris: {
    id: "temple_debris", label: "Falling Debris", description: "Rocks fall from above.",
    chipDamage: 0, spawnRate: 0.55, spawnDamage: 4, spawnHitstun: 0.18,
    slipFactor: 0, windForce: 0,
    visualEffect: "debris", visualColor: "#7c6f5b",
    screenShake: 0, darknessLevel: 0,
  },
  ice_floor: {
    id: "ice_floor", label: "Ice Floor", description: "Reduced traction — fighters slide.",
    chipDamage: 0, spawnRate: 0, spawnDamage: 0, spawnHitstun: 0,
    slipFactor: 0.6, windForce: 0,
    visualEffect: "ice", visualColor: "rgba(150,200,255,0.2)",
    screenShake: 0, darknessLevel: 0,
  },
  poison_mist: {
    id: "poison_mist", label: "Poison Mist", description: "Slow chip damage to both fighters.",
    chipDamage: 2, spawnRate: 0, spawnDamage: 0, spawnHitstun: 0,
    slipFactor: 0, windForce: 0,
    visualEffect: "mist", visualColor: "rgba(80,200,80,0.15)",
    screenShake: 0, darknessLevel: 0.15,
  },
  moving_platforms: {
    id: "moving_platforms", label: "Moving Platforms", description: "Stage shifts during combat.",
    chipDamage: 0, spawnRate: 0, spawnDamage: 0, spawnHitstun: 0,
    slipFactor: 0, windForce: 0,
    visualEffect: "none", visualColor: "#000",
    screenShake: 0, darknessLevel: 0,
  },
  earthquake: {
    id: "earthquake", label: "Earthquake", description: "Constant screen shake disrupts inputs.",
    chipDamage: 1, spawnRate: 0, spawnDamage: 0, spawnHitstun: 0,
    slipFactor: 0, windForce: 0,
    visualEffect: "none", visualColor: "#000",
    screenShake: 3, darknessLevel: 0,
  },
  fire_rain: {
    id: "fire_rain", label: "Fire Rain", description: "Burning embers rain from the sky.",
    chipDamage: 1, spawnRate: 4, spawnDamage: 3, spawnHitstun: 0.12,
    slipFactor: 0, windForce: 0,
    visualEffect: "fire", visualColor: "#f97316",
    screenShake: 0, darknessLevel: 0,
  },
  darkness: {
    id: "darkness", label: "Darkness", description: "Visibility severely reduced.",
    chipDamage: 0, spawnRate: 0, spawnDamage: 0, spawnHitstun: 0,
    slipFactor: 0, windForce: 0,
    visualEffect: "darkness", visualColor: "rgba(0,0,0,0.5)",
    screenShake: 0, darknessLevel: 0.5,
  },
  falling_trees: {
    id: "falling_trees", label: "Falling Trees", description: "Massive trunks crash down.",
    chipDamage: 0, spawnRate: 0.2, spawnDamage: 8, spawnHitstun: 0.3,
    slipFactor: 0, windForce: 0,
    visualEffect: "leaves", visualColor: "#4a3520",
    screenShake: 5, darknessLevel: 0,
  },
  wind_gusts: {
    id: "wind_gusts", label: "Wind Gusts", description: "Strong wind pushes fighters back.",
    chipDamage: 0, spawnRate: 0, spawnDamage: 0, spawnHitstun: 0,
    slipFactor: 0, windForce: 80,
    visualEffect: "none", visualColor: "#000",
    screenShake: 0, darknessLevel: 0,
  },
};
