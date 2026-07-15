# Experimental — Reinforcement Learning Ghost

> ⚠️ **This is experimental code. It is NOT part of the production game loop.**

## What lives here

- `rl.ts` — a from-scratch PPO (Proximal Policy Optimization) implementation
  with full backprop, observation normalization (Welford), and localStorage
  persistence. The policy and value networks are 2×128 MLPs over a 20-dim
  state vector. The trainer pits the agent against a fixed random opponent in
  a lightweight simulation (see `runEpisode` in `rl.ts`).
- `RLTrainingPanel.tsx` — a React UI that lets you kick off training batches,
  plot the reward/value-loss curves, and clear the saved model.

## Relationship to the production game

After the Phase-1 cleanup, the production `GameEngine` (in
`src/lib/game/engine.ts`) no longer imports anything from this folder. The
8-opponent tournament, 2-player versus mode, story intro, and destruction
ending never touch this code, and the main menu no longer surfaces the
"Fight RL Ghost" or "RL Training Lab" buttons.

## How to re-wire it (if you want the ghost back)

The trainer is still fully functional on its own. To bring the ghost back
into the game:

1. In `src/lib/game/engine.ts`, re-add an `import { RLController, rlTrainer } from "@/experimental/rl/rl"` and a `startRLGhost()` method that constructs
   `new RLController(rlTrainer.agent)`, spawns a Fighter for the ghost, and
   feeds `rlController.getInput(this.enemy, this.player)` into the enemy
   fighter each frame from `updateFight()`.
2. In `src/components/game/EternalGame.tsx`, re-import `RLTrainingPanel` from
   `@/experimental/rl/RLTrainingPanel` and `rlTrainer` from
   `@/experimental/rl/rl`, then re-add the menu buttons and panel render.
3. (Optional) Define an `RL_GHOST` `OpponentDef` to set the ghost's stats
   and announce text.

## Why it is isolated

The RL trainer runs in the background (yielding to the UI thread) and writes
to `localStorage`. Keeping it under `src/experimental/rl/` makes it clear to
future maintainers that:

1. The core game does not depend on RL.
2. Removing or stubbing this folder must not break the tournament, 2-player
   mode, story, or ending.
3. Any future refactor of the production engine can ignore this code.

## Files

| File                  | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `rl.ts`               | PPO agent + trainer + controller singleton.      |
| `RLTrainingPanel.tsx` | UI for kicking off training and inspecting logs. |
