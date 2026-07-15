# REFACTOR NOTES — From GameDesignPlan to IntentOutput

## Summary

The legacy `GameDesignPlan` output the LLM produced was wrong. The LLM
was acting as a junior designer, picking from a menu of low-level
choices (weather, camera, hazards, boss style, difficulty).
The new `IntentOutput` lets the LLM act as a high-level Game
Director: it picks the intent, reasoning, expected player reaction,
and an abstract plan. The deterministic Director (V3 + V5 +
IntentTranslator) handles the rest.

## What changed

### New schema (IntentOutput)

```ts
interface IntentOutput {
  intent: string;                 // short label
  reasoning: string;              // 1-5 sentences
  expectedPlayerReaction: string; // what the player will do
  highLevelPlan: string;          // abstract plan
  confidence: number;             // 0..1
}
```

### Old schema (GameDesignPlan)

```ts
interface GameDesignPlan {
  intent: string;
  reasoning: string;
  targetEmotion: string;
  targetIntensity: number;
  targetDifficulty: DifficultyId;
  targetLearningGoal: string;
  recommendedGenome: BossStyleId;
  recommendedWeather: WeatherId;
  recommendedLighting: LightingStyle;
  recommendedCamera: CameraStyle;
  recommendedCrowd: CrowdStyle;
  recommendedHazards: string[];
  recommendedNarrativeEvent: string;
  recommendedExperiment: string | null;
  confidence: number;
}
```

## Migration path

1. **Use the v4 prompt.** The legacy v1-v3 prompts are kept for
   backward compatibility. The new training pipeline uses v4.

2. **Use the new `IntentGameDesigner` class.** The old `GameDesigner`
   class is kept for backward compatibility but should not be used in
   new code.

3. **Use the new `DirectorEngineV5` class.** It calls the
   `IntentGameDesigner` and feeds the result through the
   `IntentTranslator`. The legacy V4 still works for old prompts.

4. **Train on the v4 prompt.** The Modal training pipeline defaults
   to v4. To train on a different prompt version, pass
   `--prompt-version vN` to `modal_train.py`.

## Backward compatibility

The legacy `GameDesignPlan` type, the legacy `GameDesigner` class,
and the legacy V4 Director remain in the codebase. They are not
deleted. New code should use the new intent layer. The dataset
logger transparently accepts both shapes.

## Why this matters

- The LLM is no longer asked to make decisions it is bad at
  (selecting a weather id, a camera id, etc.).
- The LLM is now asked to make decisions it is good at
  (judging player psychology, designing a high-level plan,
  reasoning about the narrative).
- The deterministic Director remains the source of truth for
  gameplay. The LLM cannot cause gameplay bugs.
- The training signal is cleaner. The LLM learns one thing well
  (intent) instead of 12 things poorly.
- The model is smaller and faster. A 270M model can do intent
  classification well; it cannot do menu-selection from 200+
  categories reliably.
