// ============================================================================
// ACTIVE LEARNING — DISAGREEMENT DETECTOR
//
// Scores every stored sample against three signals:
//
//   1. Confidence    — 1 - student confidence on the original plan
//   2. Disagreement  — 1 - plan agreement vs the historical plan
//   3. Outcome       — 1 - (did the player win AND engage?)
//
// Plus a fourth novelty signal that flags samples whose context is
// unusual. The composite is a weighted blend. Samples above the
// configured floor in any signal are auto-flagged for re-teaching.
//
// Reuses:
//   - GameDesignSample from gamedesigner/GameDesignDatasetLogger
//   - PlanComparison from gamedesigner/ReplayEvaluator
//   - ReplayEvaluator.comparePlans (field-by-field comparison)
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import type { GameDesignPlan } from "../gamedesigner/GameDesignPlan";
import type { PlanComparison } from "../gamedesigner/ReplayEvaluator";
import { ReplayEvaluator } from "../gamedesigner/ReplayEvaluator";
import type {
  ActiveLearningConfig,
  DisagreementReason,
  ScoredSample,
} from "./types";

export interface DisagreementDetectorDeps {
  // Reused: ReplayEvaluator.comparePlans for the disagreement signal
  replayEvaluator: ReplayEvaluator;
}

export class DisagreementDetector {
  private readonly deps: DisagreementDetectorDeps;

  constructor(deps: DisagreementDetectorDeps) {
    this.deps = deps;
  }

  /**
   * Score a single sample. Returns null if the sample is missing a plan.
   *
   * This is the lightweight path: confidence + outcome + novelty only.
   * The disagreement signal is 0 unless the caller provides a fresh
   * comparison via `scoreAgainstReplay`.
   */
  score(sample: GameDesignSample, config: ActiveLearningConfig): ScoredSample | null {
    if (!sample.plan) return null;

    const confidenceSignal = this.scoreConfidence(sample);
    const disagreementSignal = 0; // filled in by scoreAgainstReplay
    const outcomeSignal = this.scoreOutcome(sample);
    const noveltySignal = this.scoreNovelty(sample);

    const value =
      confidenceSignal * config.weights.confidence +
      disagreementSignal * config.weights.disagreement +
      outcomeSignal * config.weights.outcome +
      noveltySignal * config.weights.novelty;

    const reasons: DisagreementReason[] = [];
    if ((sample.plan.confidence ?? 0.5) < config.confidenceFloor) reasons.push("low_confidence");
    if (this.isBadOutcome(sample)) reasons.push("bad_outcome");
    if (noveltySignal > 0.7) reasons.push("novel_context");
    if (this.isFieldAmbiguous(sample)) reasons.push("field_ambiguity");
    if (confidenceSignal > 0.6) reasons.push("high_uncertainty");

    return {
      sampleId: sample.id,
      sample,
      value,
      signals: { confidence: confidenceSignal, disagreement: disagreementSignal, outcome: outcomeSignal, novelty: noveltySignal },
      reasons,
      comparison: undefined,
      estimatedTeacherCost: config.distillation?.numCandidates ?? 5,
    };
  }

  /**
   * Score a sample that has been freshly replayed by the new student.
   * The disagreement signal is 1 - fieldAgreement of (new plan vs
   * historical plan). This is the full active-learning signal stack.
   */
  scoreAgainstReplay(
    sample: GameDesignSample,
    newPlan: GameDesignPlan,
    config: ActiveLearningConfig,
  ): ScoredSample | null {
    const base = this.score(sample, config);
    if (!base) return null;

    const comparison = this.deps.replayEvaluator.comparePlans(sample.plan, newPlan);
    const disagreementSignal = 1 - comparison.fieldAgreement;

    const value =
      base.signals.confidence * config.weights.confidence +
      disagreementSignal * config.weights.disagreement +
      base.signals.outcome * config.weights.outcome +
      base.signals.novelty * config.weights.novelty;

    const reasons: DisagreementReason[] = [...base.reasons];
    if (disagreementSignal > config.disagreementFloor) reasons.push("plan_disagreement");
    if (disagreementSignal > 0.6) reasons.push("high_uncertainty");

    return {
      sampleId: sample.id,
      sample,
      value,
      signals: { ...base.signals, disagreement: disagreementSignal },
      reasons,
      comparison,
      estimatedTeacherCost: base.estimatedTeacherCost,
    };
  }

  /**
   * Score an entire pool of samples with the lightweight path.
   */
  scorePool(samples: GameDesignSample[], config: ActiveLearningConfig): ScoredSample[] {
    const out: ScoredSample[] = [];
    for (const s of samples) {
      const scored = this.score(s, config);
      if (scored) out.push(scored);
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Signal scoring
  // --------------------------------------------------------------------------

  private scoreConfidence(sample: GameDesignSample): number {
    return clamp01(1 - (sample.plan?.confidence ?? 0.5));
  }

  private scoreOutcome(sample: GameDesignSample): number {
    const r = sample.actualResult;
    if (!r) return 0.5; // neutral — no signal
    const winQ = r.playerWon ? 1.0 : 0.0;
    const engageQ = r.engaged ? 1.0 : 0.0;
    // Loss + low engagement = high "bad outcome" signal
    return clamp01(1 - (0.6 * winQ + 0.4 * engageQ));
  }

  private isBadOutcome(sample: GameDesignSample): boolean {
    const r = sample.actualResult;
    if (!r) return false;
    if (!r.playerWon && !r.engaged) return true;
    if (!r.playerWon) return true;
    return false;
  }

  private scoreNovelty(sample: GameDesignSample): number {
    const p = sample.plan;
    if (!p) return 0;
    // Recommended experiments are rare by design — high novelty
    if (p.recommendedExperiment) return 0.8;
    // Long hazard lists are unusual
    if (p.recommendedHazards && p.recommendedHazards.length >= 3) return 0.6;
    // Multiple high-intensity fields combined is novel
    let count = 0;
    if (p.recommendedLighting && p.recommendedLighting !== "normal") count++;
    if (p.recommendedMusic && p.recommendedMusic !== "ancient") count++;
    if (p.recommendedCrowd && p.recommendedCrowd !== "silent") count++;
    if (count >= 2) return 0.5;
    return 0.2;
  }

  private isFieldAmbiguous(sample: GameDesignSample): boolean {
    const p = sample.plan;
    if (!p) return false;
    return (p.confidence ?? 0.5) < 0.3;
  }

  // --------------------------------------------------------------------------
  // Bulk helper: score a pool against fresh replays
  // --------------------------------------------------------------------------

  /**
   * Score a pool where each sample is paired with a fresh replay
   * (i.e. the new student's plan for the same context). Used by the
   * ActiveLearningEngine when it has access to a replay hook.
   */
  scorePoolWithReplays(
    samples: GameDesignSample[],
    freshPlans: Map<string, GameDesignPlan>,
    config: ActiveLearningConfig,
  ): ScoredSample[] {
    const out: ScoredSample[] = [];
    for (const s of samples) {
      const fresh = freshPlans.get(s.id);
      if (fresh) {
        const scored = this.scoreAgainstReplay(s, fresh, config);
        if (scored) out.push(scored);
      } else {
        const scored = this.score(s, config);
        if (scored) out.push(scored);
      }
    }
    return out;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
