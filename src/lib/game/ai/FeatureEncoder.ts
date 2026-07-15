// ============================================================================
// PHASE 1: FEATURE ENCODER
//
// Converts raw gameplay telemetry into a normalized, versioned, AI-friendly
// representation. Never exposes raw engine objects to the AI layer.
// ============================================================================

import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { PlayerEstimate } from "../prediction/PlayerAnalyzer";
import type { EncodedFeatures } from "./types";

const ENCODER_VERSION = 1;

export class FeatureEncoder {
  /**
   * Encode a PlayerProfile + PlayerEstimate into normalized features.
   * All values are 0..1 (or integers for enums) so any model can consume them
   * regardless of its internal representation.
   */
  encode(profile: PlayerProfile, estimate: PlayerEstimate): EncodedFeatures {
    const spacingMap = { close: 0, mid: 1, far: 2 } as const;

    return {
      version: ENCODER_VERSION,
      // Behavioural (from profile)
      aggression: this.clamp(profile.aggression),
      risk: this.clamp(profile.riskLevel),
      defense: this.clamp(profile.defense),
      spacing: spacingMap[profile.preferredSpacing] ?? 1,
      reaction: this.clamp(1 - profile.reactionSpeed / 1000), // invert: high=fast
      jumpRate: this.clamp(profile.jumpFrequency / 15),
      rollRate: this.clamp(profile.rollFrequency / 10),
      comboDepth: this.clamp(profile.averageComboLength / 5),
      superTiming: this.clamp(profile.superTiming),
      cornerPressure: this.clamp(profile.cornerPressure),
      // Psychological (from estimate)
      skill: this.clamp(estimate.skill),
      confidence: this.clamp(estimate.confidence),
      patience: this.clamp(estimate.patience),
      adaptability: this.clamp(estimate.adaptability),
      curiosity: this.clamp(estimate.curiosity),
      emotionalStability: this.clamp(estimate.emotionalStability),
      frustrationTolerance: this.clamp(estimate.frustrationTolerance),
      // Match context
      matchesPlayed: profile.matchesPlayed,
      winRate: profile.matchesPlayed > 0 ? profile.matchesWon / profile.matchesPlayed : 0.5,
    };
  }

  /**
   * Decode features back to a human-readable summary (for the debug panel).
   */
  summarize(f: EncodedFeatures): string {
    const labels: Record<string, string> = {
      aggression: `${(f.aggression * 100).toFixed(0)}%`,
      risk: `${(f.risk * 100).toFixed(0)}%`,
      defense: `${(f.defense * 100).toFixed(0)}%`,
      spacing: ["close", "mid", "far"][f.spacing] ?? "mid",
      reaction: `${(f.reaction * 100).toFixed(0)}%`,
      skill: `${(f.skill * 100).toFixed(0)}%`,
      patience: `${(f.patience * 100).toFixed(0)}%`,
      confidence: `${(f.confidence * 100).toFixed(0)}%`,
    };
    return Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(", ");
  }

  /**
   * Check if features are compatible with a target version.
   * Future versions can migrate old features.
   */
  isCompatible(features: EncodedFeatures, targetVersion: number): boolean {
    return features.version <= targetVersion;
  }

  /**
   * Migrate features from an older version to the current version.
   * Currently only v1 exists, but this method is the extension point.
   */
  migrate(features: EncodedFeatures): EncodedFeatures {
    if (features.version === ENCODER_VERSION) return features;
    // Future: switch on features.version and apply migrations
    return { ...features, version: ENCODER_VERSION };
  }

  private clamp(v: number): number {
    return Math.max(0, Math.min(1, v));
  }
}
