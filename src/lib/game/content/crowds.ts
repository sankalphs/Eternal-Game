// ============================================================================
// Crowd Library — 7 prebuilt crowd/atmosphere profiles.
// Selected by the AI Director. Drives background ambiance rendering.
// ============================================================================

export type CrowdId =
  | "cheering" | "silent" | "praying" | "running"
  | "burning_city" | "monks" | "ruined_kingdom";

export interface CrowdProfile {
  id: CrowdId;
  label: string;
  // Silhouette count in background
  silhouetteCount: number;
  silhouetteColor: string;
  // Movement
  movement: "static" | "sway" | "flee" | "gather" | "ritual";
  movementSpeed: number;
  // Ambient sound
  ambientSound: "cheer" | "silence" | "chant" | "scream" | "fire" | "bell" | "wind";
  ambientVolume: number;
  // Visual overlay
  overlayColor: string;
  overlayOpacity: number;
  // Light flicker (for fire/candle scenes)
  flicker: boolean;
  flickerColor: string;
}

export const CROWDS: Record<CrowdId, CrowdProfile> = {
  cheering: {
    id: "cheering", label: "Cheering Crowd",
    silhouetteCount: 12, silhouetteColor: "#0a0a0a",
    movement: "sway", movementSpeed: 1,
    ambientSound: "cheer", ambientVolume: 0.3,
    overlayColor: "#000000", overlayOpacity: 0,
    flicker: false, flickerColor: "#000",
  },
  silent: {
    id: "silent", label: "Silent Witnesses",
    silhouetteCount: 6, silhouetteColor: "#080808",
    movement: "static", movementSpeed: 0,
    ambientSound: "silence", ambientVolume: 0,
    overlayColor: "#000000", overlayOpacity: 0,
    flicker: false, flickerColor: "#000",
  },
  praying: {
    id: "praying", label: "Praying Monks",
    silhouetteCount: 8, silhouetteColor: "#1a1a2e",
    movement: "ritual", movementSpeed: 0.5,
    ambientSound: "chant", ambientVolume: 0.25,
    overlayColor: "#1a1a2e", overlayOpacity: 0.08,
    flicker: true, flickerColor: "#f59e0b",
  },
  running: {
    id: "running", label: "Fleeing Civilians",
    silhouetteCount: 15, silhouetteColor: "#0a0505",
    movement: "flee", movementSpeed: 3,
    ambientSound: "scream", ambientVolume: 0.2,
    overlayColor: "#1a0505", overlayOpacity: 0.1,
    flicker: false, flickerColor: "#000",
  },
  burning_city: {
    id: "burning_city", label: "Burning City",
    silhouetteCount: 10, silhouetteColor: "#0a0202",
    movement: "flee", movementSpeed: 2,
    ambientSound: "fire", ambientVolume: 0.35,
    overlayColor: "#400505", overlayOpacity: 0.2,
    flicker: true, flickerColor: "#f97316",
  },
  monks: {
    id: "monks", label: "Temple Monks",
    silhouetteCount: 6, silhouetteColor: "#1a1a14",
    movement: "gather", movementSpeed: 0.3,
    ambientSound: "bell", ambientVolume: 0.15,
    overlayColor: "#1a1a14", overlayOpacity: 0.06,
    flicker: true, flickerColor: "#fbbf24",
  },
  ruined_kingdom: {
    id: "ruined_kingdom", label: "Ruined Kingdom",
    silhouetteCount: 3, silhouetteColor: "#0a0a0a",
    movement: "static", movementSpeed: 0,
    ambientSound: "wind", ambientVolume: 0.2,
    overlayColor: "#1a1a1a", overlayOpacity: 0.15,
    flicker: false, flickerColor: "#000",
  },
};
