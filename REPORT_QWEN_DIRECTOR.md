# Qwen Director Implementation Report

## Summary

The game previously used the AI Director mainly as analysis and presentation. Weather, hazards, lighting, and camera effects were already connected to the runtime Director state, but opponent combat behaviour was still driven by the authored/GA `EnemyAI` parameters.

This update makes the Director authoritative for single-player match start and opponent behaviour.

## Implemented changes

1. Match-start gating

   - Single-player matches now remain in the intro phase until Qwen returns a live plan.
   - The engine blocks transition from `intro` to `fight` unless `directorState.ai.status === "live"`.
   - If Qwen fails, the intro remains locked and the player sees that Qwen is unavailable.
   - Two-player mode is excluded from this gate.

2. Combat intent application

   - Added `applyDirectorCombatIntent()` to convert Director themes into actual opponent stat tuning.
   - Live Qwen intent now changes aggression, reaction, combo length, pressure, mixup, whiff punish, adaptation, and related AI traits.
   - Tuning is confidence-blended so low-confidence plans have less effect.
   - When Qwen is thinking or unavailable, the opponent resets to baseline/GA behaviour.

3. GA compatibility

   - Existing GA champion genomes are preserved.
   - Director combat tuning is applied on top of the champion definition when champion mode is active.

4. Verification

   - Added focused tests for Director combat tuning.
   - Verified that `revenge`, `redemption`, and zero-confidence behaviour produce expected tuning results.

## Validation

- `bun test tests/director` passes.
- `bun run lint` passes with existing unrelated warnings.
- `bunx tsc --noEmit` still fails due to pre-existing repo-wide type issues unrelated to this feature, including missing websocket packages, old AI exports, hazard config typings, and Bun test type resolution.

## Result

The match no longer begins before Qwen is ready, and the opponent now follows the Director plan mechanically instead of merely showing Director analysis in the UI.

