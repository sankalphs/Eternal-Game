// ============================================================================
// Camera Library — 8 prebuilt camera profiles.
// Selected by the AI Director. Applied by the render system.
// ============================================================================

export type CameraId =
  | "wide" | "close" | "cinematic" | "handheld"
  | "dynamic_zoom" | "boss_focus" | "dutch_angle" | "slow_zoom";

export interface CameraProfile {
  id: CameraId;
  label: string;
  // Zoom: 1.0 = fit full stage, >1 = zoomed in
  zoom: number;
  // Pan offset (0 = centered)
  panX: number;
  panY: number;
  // Tilt (radians)
  tilt: number;
  // Shake (base amount, applied on top of combat shake)
  baseShake: number;
  // Follow behavior
  followFighters: boolean;
  followWeight: number; // 0 = static, 1 = instant follow
  // Dynamic zoom params
  dynamicZoom: boolean;
  dynamicZoomMin: number;
  dynamicZoomMax: number;
  // Letterbox (cinematic bars)
  letterbox: boolean;
  letterboxHeight: number; // fraction of screen height
}

export const CAMERAS: Record<CameraId, CameraProfile> = {
  wide: {
    id: "wide", label: "Wide Shot",
    zoom: 1.0, panX: 0, panY: 0, tilt: 0,
    baseShake: 0, followFighters: false, followWeight: 0,
    dynamicZoom: false, dynamicZoomMin: 1, dynamicZoomMax: 1,
    letterbox: false, letterboxHeight: 0,
  },
  close: {
    id: "close", label: "Close-Up",
    zoom: 1.3, panX: 0, panY: -30, tilt: 0,
    baseShake: 0, followFighters: true, followWeight: 0.5,
    dynamicZoom: false, dynamicZoomMin: 1.3, dynamicZoomMax: 1.3,
    letterbox: false, letterboxHeight: 0,
  },
  cinematic: {
    id: "cinematic", label: "Cinematic",
    zoom: 1.1, panX: 0, panY: -10, tilt: 0,
    baseShake: 0, followFighters: false, followWeight: 0,
    dynamicZoom: false, dynamicZoomMin: 1.1, dynamicZoomMax: 1.1,
    letterbox: true, letterboxHeight: 0.08,
  },
  handheld: {
    id: "handheld", label: "Handheld",
    zoom: 1.15, panX: 0, panY: 0, tilt: 0,
    baseShake: 1.5, followFighters: true, followWeight: 0.8,
    dynamicZoom: false, dynamicZoomMin: 1.15, dynamicZoomMax: 1.15,
    letterbox: false, letterboxHeight: 0,
  },
  dynamic_zoom: {
    id: "dynamic_zoom", label: "Dynamic Zoom",
    zoom: 1.0, panX: 0, panY: 0, tilt: 0,
    baseShake: 0, followFighters: true, followWeight: 0.3,
    dynamicZoom: true, dynamicZoomMin: 1.0, dynamicZoomMax: 1.5,
    letterbox: false, letterboxHeight: 0,
  },
  boss_focus: {
    id: "boss_focus", label: "Boss Focus",
    zoom: 1.25, panX: 80, panY: -20, tilt: 0,
    baseShake: 0.5, followFighters: false, followWeight: 0,
    dynamicZoom: false, dynamicZoomMin: 1.25, dynamicZoomMax: 1.25,
    letterbox: true, letterboxHeight: 0.05,
  },
  dutch_angle: {
    id: "dutch_angle", label: "Dutch Angle",
    zoom: 1.1, panX: 0, panY: 0, tilt: 0.15,
    baseShake: 0, followFighters: false, followWeight: 0,
    dynamicZoom: false, dynamicZoomMin: 1.1, dynamicZoomMax: 1.1,
    letterbox: false, letterboxHeight: 0,
  },
  slow_zoom: {
    id: "slow_zoom", label: "Slow Zoom",
    zoom: 1.0, panX: 0, panY: 0, tilt: 0,
    baseShake: 0, followFighters: false, followWeight: 0,
    dynamicZoom: true, dynamicZoomMin: 1.0, dynamicZoomMax: 1.2,
    letterbox: true, letterboxHeight: 0.06,
  },
};
