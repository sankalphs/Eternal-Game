// ============================================================================
// MODIFIER SYSTEM — replaces rigid presets with procedural parameter combos.
//
// Instead of "fog" / "heavy_fog" / "light_fog", a single Fog modifier with:
//   density, height, movement, wind, colour, pulse
//
// The Director composes modifiers by setting parameters, not selecting presets.
// This dramatically increases replayability — 3 weather types × 6 params
// × 5 values each = 15,625 unique combinations per weather type.
// ============================================================================

export interface WeatherModifier {
  type: "none" | "fog" | "rain" | "ash" | "snow" | "dust" | "fireflies" | "petals" | "ember" | "shadow";
  density: number;        // 0..1 particle spawn rate
  height: number;         // 0..1 vertical distribution (0=ground, 1=full sky)
  movement: number;       // 0..1 drift speed
  wind: number;           // -1..1 horizontal direction
  color: string;          // particle color
  pulse: number;          // 0..1 flicker/pulse intensity (for fireflies, ember)
  size: number;           // particle base size
  speed: number;          // base fall speed
}

export interface LightingModifier {
  tint: string;           // color multiplied onto the scene
  intensity: number;      // 0..1 brightness
  flicker: number;        // 0..1 flicker amount
  flickerColor: string;   // color of the flicker
  ambientOcclusion: number; // 0..1 darkness in corners
  godRays: number;        // 0..1 light shaft intensity
}

export interface CameraModifier {
  zoom: number;           // base zoom level
  panX: number;           // horizontal offset
  panY: number;           // vertical offset
  tilt: number;           // rotation in radians
  shake: number;          // base shake
  followWeight: number;   // 0=static, 1=instant follow
  dynamicZoom: boolean;   // auto-zoom on action
  letterbox: number;      // 0..1 bar height
  chromaticAberration: number; // 0..1 extra CA
}

export interface HazardModifier {
  chipDamage: number;     // HP/s passive
  spawnRate: number;      // events/s
  spawnDamage: number;    // per-hit damage
  slipFactor: number;     // 0=normal, 1=no friction
  windForce: number;      // horizontal push
  screenShake: number;    // base shake/s
  darkness: number;       // 0..1 visibility reduction
  visualType: string;     // for the renderer
  visualColor: string;
}

// ============================================================================
// Modifier factories — the Director calls these to create modifiers with
// specific parameter values instead of selecting a rigid preset.
// ============================================================================

export function createFog(opts: {
  density?: number;
  height?: number;
  wind?: number;
  color?: string;
  pulse?: number;
}): WeatherModifier {
  return {
    type: "fog",
    density: opts.density ?? 0.3,
    height: opts.height ?? 0.5,
    movement: 0.3,
    wind: opts.wind ?? 0.1,
    color: opts.color ?? "rgba(150,150,160,0.3)",
    pulse: opts.pulse ?? 0,
    size: 80,
    speed: 10,
  };
}

export function createRain(opts: {
  density?: number;
  wind?: number;
  speed?: number;
  color?: string;
}): WeatherModifier {
  return {
    type: "rain",
    density: opts.density ?? 0.5,
    height: 1,
    movement: 1,
    wind: opts.wind ?? 0.2,
    color: opts.color ?? "rgba(150,170,200,0.4)",
    pulse: 0,
    size: 2,
    speed: opts.speed ?? 400,
  };
}

export function createAsh(opts: {
  density?: number;
  size?: number;
  speed?: number;
  brightness?: number;
}): WeatherModifier {
  const brightness = opts.brightness ?? 0.5;
  return {
    type: "ash",
    density: opts.density ?? 0.4,
    height: 1,
    movement: 0.5,
    wind: 0.05,
    color: `rgba(${180 + brightness * 50},${160 + brightness * 40},${140 + brightness * 30},0.4)`,
    pulse: 0,
    size: opts.size ?? 3,
    speed: opts.speed ?? 30,
  };
}

export function createSnow(opts: {
  density?: number;
  wind?: number;
  size?: number;
}): WeatherModifier {
  return {
    type: "snow",
    density: opts.density ?? 0.5,
    height: 1,
    movement: 0.6,
    wind: opts.wind ?? 0.2,
    color: "rgba(220,230,245,0.6)",
    pulse: 0,
    size: opts.size ?? 4,
    speed: 50,
  };
}

export function createEmbers(opts: {
  density?: number;
  pulse?: number;
  color?: string;
}): WeatherModifier {
  return {
    type: "ember",
    density: opts.density ?? 0.3,
    height: 0.8,
    movement: 0.3,
    wind: 0.05,
    color: opts.color ?? "#fb923c",
    pulse: opts.pulse ?? 0.5,
    size: 3,
    speed: 20,
  };
}

export function createFireflies(opts: {
  density?: number;
  pulse?: number;
  color?: string;
}): WeatherModifier {
  return {
    type: "fireflies",
    density: opts.density ?? 0.2,
    height: 0.7,
    movement: 0.4,
    wind: 0.1,
    color: opts.color ?? "#86efac",
    pulse: opts.pulse ?? 0.8,
    size: 3,
    speed: 5,
  };
}

// ============================================================================
// Lighting modifier factories
// ============================================================================

export function createLighting(opts: {
  tint?: string;
  intensity?: number;
  flicker?: number;
  flickerColor?: string;
  godRays?: number;
}): LightingModifier {
  return {
    tint: opts.tint ?? "#ffffff",
    intensity: opts.intensity ?? 1,
    flicker: opts.flicker ?? 0,
    flickerColor: opts.flickerColor ?? "#f97316",
    ambientOcclusion: 0.2,
    godRays: opts.godRays ?? 0,
  };
}

// ============================================================================
// Camera modifier factories
// ============================================================================

export function createCamera(opts: {
  zoom?: number;
  panX?: number;
  panY?: number;
  tilt?: number;
  shake?: number;
  followWeight?: number;
  dynamicZoom?: boolean;
  letterbox?: number;
  chromAb?: number;
}): CameraModifier {
  return {
    zoom: opts.zoom ?? 1,
    panX: opts.panX ?? 0,
    panY: opts.panY ?? 0,
    tilt: opts.tilt ?? 0,
    shake: opts.shake ?? 0,
    followWeight: opts.followWeight ?? 0,
    dynamicZoom: opts.dynamicZoom ?? false,
    letterbox: opts.letterbox ?? 0,
    chromaticAberration: opts.chromAb ?? 0,
  };
}

// ============================================================================
// Hazard modifier factories
// ============================================================================

export function createHazard(opts: {
  chipDamage?: number;
  spawnRate?: number;
  spawnDamage?: number;
  slipFactor?: number;
  windForce?: number;
  screenShake?: number;
  darkness?: number;
  visualType?: string;
  visualColor?: string;
}): HazardModifier {
  return {
    chipDamage: opts.chipDamage ?? 0,
    spawnRate: opts.spawnRate ?? 0,
    spawnDamage: opts.spawnDamage ?? 0,
    slipFactor: opts.slipFactor ?? 0,
    windForce: opts.windForce ?? 0,
    screenShake: opts.screenShake ?? 0,
    darkness: opts.darkness ?? 0,
    visualType: opts.visualType ?? "none",
    visualColor: opts.visualColor ?? "#000",
  };
}
