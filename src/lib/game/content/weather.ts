// ============================================================================
// Weather Library — 11 prebuilt weather profiles.
// Selected by the AI Director before a boss fight. Never generated at runtime.
// ============================================================================

export type WeatherId =
  | "clear" | "fog" | "heavy_fog" | "ash" | "rain" | "thunder"
  | "snow" | "dust_storm" | "fireflies" | "blood_moon" | "cherry_blossoms"
  | "solar_eclipse";

export interface WeatherProfile {
  id: WeatherId;
  label: string;
  // Visual overlay
  overlayColor: string;
  overlayOpacity: number;
  // Particle effect
  particleType: "none" | "fog" | "ash" | "rain" | "snow" | "dust" | "fireflies" | "petals" | "ember" | "shadow";
  particleRate: number;     // spawns per second
  particleColor: string;
  particleSize: number;
  particleSpeed: number;    // base fall speed
  particleDrift: number;    // horizontal drift
  // Lighting
  lightTint: string;        // multiply onto the scene
  lightIntensity: number;   // 0..1
  // Audio
  ambientSound: "none" | "wind" | "rain" | "thunder" | "fire" | "omni";
  ambientVolume: number;
}

export const WEATHER: Record<WeatherId, WeatherProfile> = {
  clear: {
    id: "clear", label: "Clear",
    overlayColor: "#000000", overlayOpacity: 0,
    particleType: "none", particleRate: 0, particleColor: "#fff", particleSize: 0, particleSpeed: 0, particleDrift: 0,
    lightTint: "#ffffff", lightIntensity: 1,
    ambientSound: "none", ambientVolume: 0,
  },
  fog: {
    id: "fog", label: "Fog",
    overlayColor: "#888888", overlayOpacity: 0.15,
    particleType: "fog", particleRate: 2, particleColor: "rgba(150,150,160,0.3)", particleSize: 80, particleSpeed: 10, particleDrift: 15,
    lightTint: "#a0a0b0", lightIntensity: 0.7,
    ambientSound: "wind", ambientVolume: 0.15,
  },
  heavy_fog: {
    id: "heavy_fog", label: "Heavy Fog",
    overlayColor: "#666677", overlayOpacity: 0.3,
    particleType: "fog", particleRate: 5, particleColor: "rgba(120,120,140,0.5)", particleSize: 120, particleSpeed: 8, particleDrift: 10,
    lightTint: "#707080", lightIntensity: 0.5,
    ambientSound: "wind", ambientVolume: 0.3,
  },
  ash: {
    id: "ash", label: "Ash Fall",
    overlayColor: "#3a2020", overlayOpacity: 0.12,
    particleType: "ash", particleRate: 8, particleColor: "rgba(180,160,140,0.4)", particleSize: 3, particleSpeed: 30, particleDrift: 8,
    lightTint: "#806050", lightIntensity: 0.6,
    ambientSound: "fire", ambientVolume: 0.1,
  },
  rain: {
    id: "rain", label: "Rain",
    overlayColor: "#202830", overlayOpacity: 0.2,
    particleType: "rain", particleRate: 40, particleColor: "rgba(150,170,200,0.4)", particleSize: 2, particleSpeed: 400, particleDrift: 30,
    lightTint: "#6080a0", lightIntensity: 0.5,
    ambientSound: "rain", ambientVolume: 0.4,
  },
  thunder: {
    id: "thunder", label: "Thunderstorm",
    overlayColor: "#101020", overlayOpacity: 0.3,
    particleType: "rain", particleRate: 50, particleColor: "rgba(150,170,200,0.5)", particleSize: 2, particleSpeed: 500, particleDrift: 50,
    lightTint: "#303050", lightIntensity: 0.3,
    ambientSound: "thunder", ambientVolume: 0.5,
  },
  snow: {
    id: "snow", label: "Snowfall",
    overlayColor: "#a0b0c0", overlayOpacity: 0.1,
    particleType: "snow", particleRate: 15, particleColor: "rgba(220,230,245,0.6)", particleSize: 4, particleSpeed: 50, particleDrift: 20,
    lightTint: "#b0c0d0", lightIntensity: 0.8,
    ambientSound: "wind", ambientVolume: 0.2,
  },
  dust_storm: {
    id: "dust_storm", label: "Dust Storm",
    overlayColor: "#8a6030", overlayOpacity: 0.25,
    particleType: "dust", particleRate: 25, particleColor: "rgba(180,140,80,0.4)", particleSize: 6, particleSpeed: 200, particleDrift: 150,
    lightTint: "#a08050", lightIntensity: 0.4,
    ambientSound: "wind", ambientVolume: 0.5,
  },
  fireflies: {
    id: "fireflies", label: "Fireflies",
    overlayColor: "#0a1a0a", overlayOpacity: 0.08,
    particleType: "fireflies", particleRate: 5, particleColor: "#86efac", particleSize: 3, particleSpeed: 5, particleDrift: 10,
    lightTint: "#50a060", lightIntensity: 0.7,
    ambientSound: "none", ambientVolume: 0,
  },
  blood_moon: {
    id: "blood_moon", label: "Blood Moon",
    overlayColor: "#400000", overlayOpacity: 0.2,
    particleType: "ember", particleRate: 3, particleColor: "#dc2626", particleSize: 3, particleSpeed: 20, particleDrift: 5,
    lightTint: "#a02020", lightIntensity: 0.4,
    ambientSound: "omni", ambientVolume: 0.2,
  },
  cherry_blossoms: {
    id: "cherry_blossoms", label: "Cherry Blossoms",
    overlayColor: "#2a1020", overlayOpacity: 0.08,
    particleType: "petals", particleRate: 6, particleColor: "#fbcfe8", particleSize: 5, particleSpeed: 30, particleDrift: 40,
    lightTint: "#e090b0", lightIntensity: 0.8,
    ambientSound: "none", ambientVolume: 0,
  },
  solar_eclipse: {
    id: "solar_eclipse", label: "Solar Eclipse",
    overlayColor: "#000000", overlayOpacity: 0.4,
    particleType: "shadow", particleRate: 2, particleColor: "rgba(0,0,0,0.6)", particleSize: 60, particleSpeed: 5, particleDrift: 3,
    lightTint: "#202030", lightIntensity: 0.2,
    ambientSound: "omni", ambientVolume: 0.3,
  },
};
