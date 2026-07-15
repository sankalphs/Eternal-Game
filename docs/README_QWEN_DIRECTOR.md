# Eternal — Qwen AI Director Notes

This build uses Qwen as the live AI Director for single-player encounters.

## What the Director controls

- The fight does not advance into the active `fight` phase until Qwen returns a live plan.
- While Qwen is thinking, the match stays in the intro gate and shows a Director preparation message.
- Once Qwen is ready, its intent is applied to:
  - weather particles,
  - lighting tint/intensity,
  - camera shake/zoom profile,
  - hazards such as darkness, slip, and passive chip damage,
  - opponent combat behaviour.

## Opponent behaviour

The opponent no longer only displays Director reasoning. The live intent now retunes the active `EnemyAI` definition:

- `revenge` makes opponents faster and more punitive.
- `redemption` makes encounters more forgiving.
- `revelation` increases reads/adaptation.
- `defiance` increases pressure.
- `grief` makes opponents more guarded and hesitant.
- `triumph` raises overall challenge.

If the GA champion genome is enabled, the Qwen Director tuning is layered on top of the evolved genome instead of replacing it.

## Failure behaviour

If Qwen is unavailable, the match remains locked in the intro gate. The game does not claim that Director effects or AI-following behaviour are active unless a live Qwen plan has been applied.

Two-player mode bypasses the Qwen gate because there is no AI opponent to direct.

