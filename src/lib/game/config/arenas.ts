// ============================================================================
// Arena configuration — visual configs for the 7 themed arenas.
// render.ts uses this to drive a single parameterized arena drawer.
// ============================================================================

import type { BackgroundId } from "../types";

export type AmbientParticleType =
  | "embers" | "petals" | "snow" | "fireflies" | "dust" | "none";

export interface ArenaConfig {
  id: BackgroundId;
  label: string;
  // Sky gradient
  skyTop: string;
  skyBottom: string;
  // Sun/moon
  sunColor: string;
  sunGlow: string;
  sunX: number; // 0..1 relative position
  sunY: number; // 0..1 relative position
  sunR: number;
  // Ground
  groundTop: string;
  groundBottom: string;
  groundEdge: string;
  // Ridge (background mountains)
  ridgeColor: string;
  ridgePoints: number[]; // [x1,y1, x2,y2, ...] relative to width
  ridgeBaseY: number; // 0..1 relative
  // Ambient particles
  ambientParticle: AmbientParticleType;
  ambientRate: number; // spawns per second
  ambientColor: string;
  // Fog/haze
  fogColor: string;
  fogOpacity: number;
}

export const ARENAS: Record<BackgroundId, ArenaConfig> = {
  sunset: {
    id: "sunset",
    label: "Sunset",
    skyTop: "#1a0a2e",
    skyBottom: "#c2410c",
    sunColor: "#fde047",
    sunGlow: "rgba(253,224,71,0.3)",
    sunX: 0.7,
    sunY: 0.35,
    sunR: 60,
    groundTop: "#3d1f0a",
    groundBottom: "#0a0503",
    groundEdge: "#f59e0b",
    ridgeColor: "#1a0a14",
    ridgePoints: [0.0, 0.55, 0.15, 0.42, 0.3, 0.5, 0.5, 0.38, 0.7, 0.45, 0.85, 0.4, 1.0, 0.55],
    ridgeBaseY: 0.55,
    ambientParticle: "none",
    ambientRate: 0,
    ambientColor: "#f59e0b",
    fogColor: "rgba(200,80,30,0.05)",
    fogOpacity: 0.05,
  },
  desert: {
    id: "desert",
    label: "Desert",
    skyTop: "#1c1208",
    skyBottom: "#d97706",
    sunColor: "#fef3c7",
    sunGlow: "rgba(254,243,199,0.2)",
    sunX: 0.5,
    sunY: 0.25,
    sunR: 50,
    groundTop: "#92400e",
    groundBottom: "#451a03",
    groundEdge: "#fbbf24",
    ridgeColor: "#451a03",
    ridgePoints: [0.0, 0.6, 0.2, 0.5, 0.4, 0.55, 0.6, 0.48, 0.8, 0.52, 1.0, 0.6],
    ridgeBaseY: 0.6,
    ambientParticle: "dust",
    ambientRate: 3,
    ambientColor: "rgba(180,150,100,0.4)",
    fogColor: "rgba(180,150,100,0.06)",
    fogOpacity: 0.06,
  },
  temple: {
    id: "temple",
    label: "Temple",
    skyTop: "#0a0a1a",
    skyBottom: "#1e1b3a",
    sunColor: "#a78bfa",
    sunGlow: "rgba(167,139,250,0.15)",
    sunX: 0.3,
    sunY: 0.2,
    sunR: 40,
    groundTop: "#1c1917",
    groundBottom: "#0a0908",
    groundEdge: "#a78bfa",
    ridgeColor: "#0a0a14",
    ridgePoints: [0.0, 0.5, 0.25, 0.35, 0.5, 0.45, 0.75, 0.3, 1.0, 0.5],
    ridgeBaseY: 0.5,
    ambientParticle: "dust",
    ambientRate: 2,
    ambientColor: "rgba(100,80,60,0.3)",
    fogColor: "rgba(100,80,120,0.08)",
    fogOpacity: 0.08,
  },
  bamboo: {
    id: "bamboo",
    label: "Bamboo",
    skyTop: "#0a1a0a",
    skyBottom: "#1a3a1a",
    sunColor: "#86efac",
    sunGlow: "rgba(134,239,172,0.12)",
    sunX: 0.6,
    sunY: 0.15,
    sunR: 35,
    groundTop: "#1a2a14",
    groundBottom: "#0a1208",
    groundEdge: "#22c55e",
    ridgeColor: "#0a1a0a",
    ridgePoints: [0.0, 0.55, 0.2, 0.42, 0.4, 0.5, 0.6, 0.4, 0.8, 0.48, 1.0, 0.55],
    ridgeBaseY: 0.55,
    ambientParticle: "fireflies",
    ambientRate: 4,
    ambientColor: "#86efac",
    fogColor: "rgba(60,120,60,0.06)",
    fogOpacity: 0.06,
  },
  moon: {
    id: "moon",
    label: "Moonlit",
    skyTop: "#05050f",
    skyBottom: "#0a0a25",
    sunColor: "#e2e8f0",
    sunGlow: "rgba(226,232,240,0.15)",
    sunX: 0.75,
    sunY: 0.2,
    sunR: 55,
    groundTop: "#1a1a2e",
    groundBottom: "#050510",
    groundEdge: "#6366f1",
    ridgeColor: "#080814",
    ridgePoints: [0.0, 0.5, 0.2, 0.4, 0.4, 0.48, 0.6, 0.38, 0.8, 0.45, 1.0, 0.5],
    ridgeBaseY: 0.5,
    ambientParticle: "none",
    ambientRate: 0,
    ambientColor: "#6366f1",
    fogColor: "rgba(50,50,100,0.05)",
    fogOpacity: 0.05,
  },
  volcano: {
    id: "volcano",
    label: "Volcano",
    skyTop: "#1a0505",
    skyBottom: "#7f1d1d",
    sunColor: "#fb923c",
    sunGlow: "rgba(251,146,60,0.2)",
    sunX: 0.5,
    sunY: 0.3,
    sunR: 45,
    groundTop: "#450a0a",
    groundBottom: "#0a0202",
    groundEdge: "#ef4444",
    ridgeColor: "#1a0505",
    ridgePoints: [0.0, 0.55, 0.25, 0.4, 0.5, 0.5, 0.75, 0.38, 1.0, 0.55],
    ridgeBaseY: 0.55,
    ambientParticle: "embers",
    ambientRate: 8,
    ambientColor: "#fb923c",
    fogColor: "rgba(150,30,10,0.08)",
    fogOpacity: 0.08,
  },
  snow: {
    id: "snow",
    label: "Snow",
    skyTop: "#0a0a1a",
    skyBottom: "#1e293b",
    sunColor: "#e0f2fe",
    sunGlow: "rgba(224,242,254,0.1)",
    sunX: 0.4,
    sunY: 0.2,
    sunR: 40,
    groundTop: "#334155",
    groundBottom: "#0f172a",
    groundEdge: "#cbd5e1",
    ridgeColor: "#1e293b",
    ridgePoints: [0.0, 0.55, 0.2, 0.42, 0.4, 0.5, 0.6, 0.4, 0.8, 0.48, 1.0, 0.55],
    ridgeBaseY: 0.55,
    ambientParticle: "snow",
    ambientRate: 12,
    ambientColor: "rgba(220,230,245,0.6)",
    fogColor: "rgba(200,210,230,0.06)",
    fogOpacity: 0.06,
  },
} as const;

export const ARENA_LIST = Object.values(ARENAS);
