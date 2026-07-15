# Eternal — Technical Report

## 1. Executive summary

Eternal is a browser-native cinematic fighting game and AI research playground. The game itself is a playable 2D shadow fighter: Canvas2D rendering, WebGL post-processing, Web Audio, a custom physics/combat engine, authored opponents, story progression, local versus, and cinematic intro/ending sequences.

The current codebase also contains a substantial AI stack. The active gameplay path uses a rule-based `EnemyAI`, optional GA champion genomes, and a live Qwen AI Director. The Director is now authoritative for single-player match start: the engine does not advance from intro into active fighting until Qwen returns a validated live plan. That plan drives environment presentation, hazards, camera, and actual opponent combat tuning.

## 2. Product scope

### Player-facing features

- Story tournament with eight escalating opponents.
- Free Select mode for direct opponent/arena selection.
- Two-player local versus.
- Skip-to-ending shortcut.
- Round/match/champion phase flow.
- Health, rage, round timer, round pips, combo counter, announcements, and touch controls.
- In-fight AI transparency toolbar and panels.

### Narrative

The player is the shadow/villain, not the savior. Opponents are the last Sealers trying to contain the player. The final champion state triggers the world-destruction ending.

### Current opponents

| Opponent | Title | Arena | Combat profile |
| --- | --- | --- | --- |
| Lynx | The Last Apprentice | Sunset | forgiving starter |
| Bandit | The Defector | Desert | faster, more aggressive |
| Crane | The Temple Guard | Temple | defensive and measured |
| Hermit | The Hermit | Bamboo | adaptive teacher archetype |
| Widow | The Nightblade | Moon | fast whiff-punisher |
| Butcher | The Colossus | Volcano | high HP and pressure |
| Shogun | The Shogun | Snow | strong defense and mixups |
| Titan | The World's Last Hope | Moon | final high-stat opponent |

## 3. Runtime architecture

```text
React / EternalGame.tsx
  owns canvas refs, input, UI overlays, menu flow, Director requests
        |
        v
GameEngine
  phase FSM, rounds, fighters, AI, collision, hazards, particles, VFX events
        |
        +--> Fighter
        |      physics, state transitions, hitboxes, attacks, damage response
        |
        +--> EnemyAI
        |      rule-based opponent input generation
        |
        +--> DirectorRuntime
        |      live Qwen state, weather/lighting/camera/hazard/combat tuning
        |
        v
render.ts + postfx.ts + audio.ts
  Canvas2D frame, WebGL overlay, Web Audio response
```

The game loop is driven by `requestAnimationFrame`. React state is used for snapshots and UI, while the simulation itself lives in the engine object to avoid per-frame React reconciliation.

## 4. Match phase model

Main phases:

- `menu`
- `intro`
- `fight`
- `round_end`
- `match_end`
- `game_over`
- `champion`

Important flow:

1. A match path creates/reset fighters and starts a round.
2. The round enters `intro`.
3. For single-player, `intro` is held while Qwen is not live.
4. When Qwen returns a valid plan, `directorState.ai.status` becomes `live`.
5. Only then can `intro` count down into `fight`.
6. KO or timeout enters `round_end`.
7. Best-of-three determines match end, game over, next opponent, or champion ending.

Two-player mode skips the Qwen Director gate because it does not use an AI opponent.

## 5. Combat engine

### Fighter state and movement

The `Fighter` class owns physics and action state. Movement uses velocity, acceleration, friction, gravity, stage bounds, and grounded/airborne state. Jumps support variable height by cutting upward velocity when the input is released early. Rolls apply directional movement and invulnerability.

### Attack model

Available attacks:

- punch
- kick
- roundhouse
- super

Attacks are committed state transitions with startup/active/recovery windows. Hitboxes only exist during active windows. Damage is affected by attacker multipliers, blocking, invulnerability, knockdown state, and hit type.

### Defensive model

- Block only works when grounded and correctly facing the incoming hit.
- Roll grants invulnerability.
- Knockdown/getup include invulnerability to prevent repeated lockdown.
- Active-frame trades allow attacks already in their active window to still connect.

### VFX and feedback

Combat outcomes produce:

- hitstop,
- screen shake,
- flash,
- zoom,
- slow motion,
- chromatic aberration,
- spark/ring/shockwave/streak particles,
- floating damage or block text,
- audio/VFX events.

## 6. Rendering pipeline

The renderer uses Canvas2D for the main scene and a WebGL pass for post-processing.

Main Canvas2D responsibilities:

- draw arena/background,
- draw ground and atmospheric layers,
- compute fighter poses,
- render filled shadow silhouettes,
- render auras and rim accents,
- draw particles, shockwaves, streaks, and floating text,
- draw vignette/scene overlays.

The WebGL post-process layer adds bloom, chromatic aberration, and vignette intensity controlled by engine VFX state.

## 7. Audio system

The audio layer uses Web Audio rather than relying primarily on static files. The engine emits combat events; the audio system converts them into responsive hit, block, heavy-hit, and KO feedback. The UI exposes mute/unmute.

## 8. AI opponent system

The active opponent controller is `EnemyAI` in `src/lib/game/ai.ts`. It reads an `OpponentDef` and returns input for the enemy fighter each frame.

Important opponent fields:

- `aggression`
- `blockChance`
- `reaction`
- `combo`
- `whiffPunish`
- `antiAir`
- `pressure`
- `mixup`
- `readDelay`
- `adaptive`
- `rage`
- `perfection`
- `speedMul`
- `damageMul`
- `hp`

The AI can approach, retreat, block, wait, zone, punish whiffs, anti-air jumps, apply pressure, mix attack types, and adapt to repeated player habits.

## 9. Qwen AI Director

### Request path

`EternalGame.tsx` calls `/api/ai/director` with current context:

- opponent identity,
- chapter index,
- current Director intent,
- player wins/losses/max combo,
- enemy state,
- whether the evolved genome is active.

The route handler:

1. reads `ETERNAL_MODEL_ENDPOINT`,
2. forwards the context to the Modal-hosted model,
3. validates the model output,
4. returns normalized intent, model label, latency, and request id.

### Runtime application

`DirectorRuntime.ts` translates model output into safe runtime themes. The themes drive:

- weather,
- lighting,
- camera,
- hazards,
- combat tuning.

The runtime intent set includes revenge, redemption, revelation, defiance, grief, and triumph.

### Match gate

The engine method `shouldHoldIntroForDirector()` holds single-player matches in intro until the Director status is `live`. This prevents gameplay from beginning before Qwen is ready.

### Combat tuning

`applyDirectorCombatIntent()` modifies the opponent definition based on the Director theme. Examples:

- revenge increases aggression and whiff punish while reducing reaction delay,
- redemption lowers pressure and aggression,
- revelation increases adaptation/read behavior,
- defiance increases pressure,
- grief makes the AI more guarded,
- triumph raises overall challenge.

The tuning is confidence-blended and clamps bounded fields to safe ranges.

## 10. Genetic algorithm and champion genome

The evolution subsystem contains genomes, mutation, crossover, selection, fitness evaluation, genealogy, narrative traits, research reporting, and multiple simulated player archetypes.

Gameplay integration:

- `/api/ai/champion` reads `ChampionGenome.json` if present.
- The UI can enable GA champion mode.
- The engine overlays the champion genes onto the current opponent.
- If Qwen is live, Director combat tuning is applied on top of the champion definition.

Relevant scripts include:

- `scripts/evolve-champion.ts`
- `scripts/evolve-library.ts`
- `scripts/evolve-widow.ts`
- `scripts/freeze-genomes.ts`
- `scripts/ga-vs-ga.ts`
- `scripts/train-offline-ga.ts`

### Offline gameplay-parameter GA

The new offline GA module in `src/lib/game/offline-ga` evolves gameplay parameters rather than neural-network weights. Each genome is a normalized chromosome with genes for aggression, defense priority, dodge probability, counter attack tendency, combo continuation threshold, block frequency, punish window, risk tolerance, distance preference, jump frequency, projectile usage, and ultimate usage threshold.

Architecture:

- `Genome.ts` defines the normalized gene schema, population diversity, uniform crossover, and Gaussian mutation.
- `Fitness.ts` computes configurable weighted fitness from simulator outcomes only: win rate, remaining HP, damage dealt, damage avoided, combo efficiency, and survival time.
- `SimulatorAdapter.ts` keeps the GA engine separate from the current fighting simulator and maps offline genes into the existing `OpponentDef`/headless simulator interface.
- `OfflineEvolutionTrainer.ts` runs tournament selection, 20% default elitism, crossover, mutation, checkpointing, adaptive baseline pressure, and final frozen-genome validation.
- `CheckpointStore.ts` writes every generation and the final `best_genome.json` artifact.
- The headless simulator now uses side-aware enemy controllers, so a rule-based AI driving side A reads `engine.player` as self and `engine.enemy` as the opponent. Genome/opponent detection is also stricter, preventing authored `OpponentDef` baselines from being misclassified as genomes.

Default run behavior:

- Population size: 100.
- Initial training generations: 100.
- Maximum generations after failed validation: 300.
- Mutation: Gaussian noise with configurable rate and standard deviation.
- Validation: freeze only the best genome, then evaluate against every configured baseline opponent at an 80% default win-rate threshold.
- If validation fails, failed baseline opponents receive extra fitness pressure and evolution resumes until validation passes or `maxGenerations` is reached.

## 11. AI/research infrastructure

The repo includes modules beyond the currently active moment-to-moment gameplay path:

- intent schema and output validation,
- massive dataset generation/export,
- fine-tuning package generation,
- active learning,
- confidence and quality engines,
- prompt building/strategy,
- memory retrieval,
- game-designer pipelines,
- prediction/player psychology,
- campaign and narrative planners,
- world history/state,
- headless simulator and batch executor,
- benchmark/statistics/report tooling.

These modules support experimentation and model/dataset work around the playable game.

## 12. API routes

| Route | Purpose |
| --- | --- |
| `/api/ai/director` | Live Qwen Director inference proxy |
| `/api/ai/champion` | Reads current frozen champion genome |
| `/api/ai/ga-stats` | GA/evolution statistics |
| `/api/ai/llm-info` | Model/LLM information |

The Director route is dynamic and uses Node.js runtime because it calls an external endpoint and validates the returned intent.

## 13. Configuration and environment

Required/important environment variables:

```env
DATABASE_URL="file:./db/custom.db"
ETERNAL_MODEL_ENDPOINT="https://YOUR-WORKSPACE--eternal-inference-eternal-game-designer.modal.run"
ETERNAL_MODEL_API_KEY=""
```

`ETERNAL_MODEL_ENDPOINT` is required for the single-player Qwen-gated match flow. Without it, single-player match start remains locked because the game intentionally refuses to enter a fight without a live Qwen plan.

## 14. Modal inference deployment

The Modal endpoint is defined in `modal/modal_inference.py`. It loads a fine-tuned causal language model, exposes a FastAPI endpoint, and returns intent output for the game Director.

The local Next.js API route is intentionally thin: it does not run the model locally; it forwards requests and validates responses.

## 15. Testing and quality status

Commands used for current validation:

```bash
bun run train:offline-ga
./node_modules/.bin/eslint.cmd scripts/train-offline-ga.ts src/lib/game/offline-ga/*.ts
./node_modules/.bin/tsc.cmd --noEmit
bun test tests/director
bun run lint
```

Current observed status:

- Offline GA targeted lint passes with no warnings.
- Offline GA default training resumed from the latest checkpoint and accepted a frozen best genome at generation 99.
- Final offline GA artifact: `best_genome.json`, genome id `offline_5_0000l5`, reported fitness `0.742401678240735`, generation discovered `5`.
- Final validation used an 80% threshold with 20 fights per baseline. Win rates were Lynx 100%, Bandit 100%, Crane 100%, Hermit 100%, Widow 100%, Butcher 100%, Shogun 100%, and Titan 85%.
- Checkpoint output now contains 100 generation checkpoint files plus `data/offline-ga-checkpoints/latest.json`.
- Director combat tests pass.
- Lint exits successfully with three existing warnings about unused ESLint-disable comments in research/simulator files.
- Full TypeScript project checking with `bunx tsc --noEmit` currently fails due to pre-existing wider repo issues: missing websocket dependencies in examples, older script/type mismatches, legacy AI export references, hazard config typing mismatches, private method access in older engine code paths, particle union mismatch, and Bun test type resolution.

## 16. Current limitations and risks

- Single-player mode depends on Qwen availability. This is intentional for the current requirement, but it means a bad endpoint blocks match start.
- Some research/script modules are not type-clean under the global tsconfig.
- Offline GA validation now produces decisive results, but the current accepted champion benefits from using the adapter's strong default body baseline; tune the baseline body separately if the product goal is behaviour-only dominance with weaker body stats.
- `.env` contains local secrets/config and should not be committed.
- The repository contains both active gameplay code and experimental research code; not every module is part of the live UI path.
- The deleted `public/audio/steel_on_the_riverbank.mp3` indicates the current build leans on procedural/fixed audio paths rather than that older track.

## 17. Recommended next steps

1. Add a visible retry/reconfigure CTA when Qwen is unavailable.
2. Split experimental scripts/examples from production `tsconfig` or add separate tsconfigs.
3. Add integration tests for offline GA validation so headless fights cannot regress into all-draw outcomes.
4. Add integration tests for intro gating and Director fallback behavior.
5. Add a small health-check endpoint for the Modal model.
6. Document the expected Qwen intent JSON schema beside the Modal deployment docs.
7. Decide whether the Qwen-specific README/report should remain separate or be merged into these primary documents.

## 18. Conclusion

Eternal is now more than a static fighting prototype. It has a playable combat loop, cinematic presentation, authored and evolved AI opponents, and a live external model directing match tone and behavior. The most important current behavioral guarantee is that single-player combat does not begin until Qwen has produced a validated live plan, and that plan changes both the encounter atmosphere and the opponent's actual combat decisions.
