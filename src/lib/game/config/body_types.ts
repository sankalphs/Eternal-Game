// ============================================================================
// Body type configuration — proportion multipliers per fighter body type.
// render.ts imports from here instead of a switch statement.
// ============================================================================

import type { BodyType } from "../types";

export interface BodyProps {
  headR: number;
  neck: number;
  torso: number;
  uarm: number;
  farm: number;
  thigh: number;
  shin: number;
  wTorso: number;
  wArm: number;
  wLeg: number;
  extraLean: number;
}

// Base Da Vinci proportions
const BASE = {
  headR: 12.5,
  neck: 9,
  torso: 46,
  uarm: 27,
  farm: 25,
  thigh: 40,
  shin: 38,
};

export const BODY_TYPES: Record<BodyType, BodyProps> = {
  lean: {
    ...BASE,
    wTorso: 1.0,
    wArm: 1.0,
    wLeg: 1.0,
    extraLean: 0,
  },
  bulky: {
    ...BASE,
    headR: BASE.headR * 1.15,
    torso: BASE.torso * 0.9,
    thigh: BASE.thigh * 0.85,
    shin: BASE.shin * 0.85,
    wTorso: 1.35,
    wArm: 1.3,
    wLeg: 1.25,
    extraLean: 0.05,
  },
  tall: {
    ...BASE,
    headR: BASE.headR * 0.95,
    torso: BASE.torso * 1.12,
    thigh: BASE.thigh * 1.2,
    shin: BASE.shin * 1.18,
    uarm: BASE.uarm * 1.1,
    farm: BASE.farm * 1.1,
    wTorso: 0.85,
    wArm: 0.85,
    wLeg: 0.9,
    extraLean: 0,
  },
  hunched: {
    ...BASE,
    torso: BASE.torso * 0.88,
    thigh: BASE.thigh * 0.92,
    shin: BASE.shin * 0.9,
    wTorso: 1.1,
    wArm: 0.95,
    wLeg: 0.95,
    extraLean: 0.2,
  },
} as const;
