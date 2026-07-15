# Eternal — The Shadow's Ascension

Eternal is a cinematic browser fighting game built with Next.js, TypeScript, Canvas2D, WebGL post-processing, procedural audio, and a live Qwen-powered AI Director. The player is not the hero: they are the ancient shadow wearing a dead hero's memories, hunting the last Sealers of a collapsing world.

The current build combines a playable 2D fighting game with an AI research stack: rule-based opponent AI, live Qwen encounter direction, genetic-algorithm champion genomes, self-play/evolution tooling, intent datasets, simulator infrastructure, and transparent in-game AI panels.

## Current feature set

### Game modes

- Story tournament through eight opponents: Lynx, Bandit, Crane, Hermit, Widow, Butcher, Shogun, and Titan.
- Free Select mode for choosing an opponent and arena directly.
- Local two-player versus mode.
- Practice mode (offline Classic Director, infinite HP) and a skippable micro-tutorial.
- Skip-to-ending mode for jumping directly to the destruction finale.
- Best-of-three round structure with victory, defeat, match debrief, story interstitials, and champion/endgame states.

### Combat

- Momentum-based movement with acceleration, friction, jump velocity, gravity, and stage bounds.
- Variable-height flip jump.
- Roll dodge with invulnerability frames.
- Punch, kick, roundhouse, throw/grab, and rage-powered super attack.
- Blocking reduces damage for all strikes when correctly facing the attacker (kicks do not beat stand-block — preserves GA genome balance).
- Throws beat pure standing block at grab range.
- Hitstop, shake, slow-motion, chromatic aberration, shockwaves, streaks, damage text, and KO cinematics.
- Knockdown/getup state flow with invulnerability windows to avoid repeated lockdown.
- Combo tracking and best-combo reporting after matches.

### Rendering and presentation

- Canvas2D game renderer with solid shadow-fighter silhouettes.
- Skeletal pose system for combat animation.
- Multiple body types: lean, bulky, tall, and hunched.
- Themed arenas such as sunset, desert, temple, bamboo, moon, volcano, and snow.
- WebGL overlay for bloom, chromatic aberration, and vignette.
- Touch controls for mobile play.
- Cinematic story intro and animated destruction ending.

### Audio

- Procedural Web Audio soundtrack and hit effects.
- Narrated cinematic prologue: `public/audio/Blade_at_the_Gate.mp3` plays alongside the opening story intro in `StoryIntro.tsx`.
- Combat events emit audio/VFX events from the engine.
- Mute/unmute control in the game UI.

### AI opponent system

- `EnemyAI` drives single-player opponents through a rule-based finite-state combat controller.
- Opponents have authored combat traits such as aggression, block chance, reaction speed, combo length, whiff punish, anti-air, pressure, mixup, adaptation, rage, and perfection.
- Habit tracking responds to repeated player openings such as blocking, jumping, and attacking patterns.
- GA champion mode can overlay a frozen evolved genome on the current opponent.

### Live Qwen AI Director

- Single-player prefers live Qwen: intro holds only while status is `thinking`.
- If Qwen succeeds, status is `live` and the plan is applied.
- If Qwen fails or times out (~4s), Classic Director applies a deterministic chapter plan (`status: "fallback"`) and **unlocks the fight** — never soft-locks; UI labels offline honestly.
- Practice mode and two-player bypass the Qwen wait.
- Live or Classic intent drives weather, lighting, camera, hazards, and confidence-blended opponent combat tuning over authored / GA genomes.

### AI transparency UI

- Live AI Director panel.
- Director chip strip.
- Director timeline/action visualizer.
- Director notifications.
- AI insights modal.
- AI genome HUD.
- AI decision ticker.
- Match debrief panel showing outcome context and best combo.

### Research and tooling

- Genetic algorithm/evolution modules for creating and freezing champion genomes.
- Offline GA trainer for normalized gameplay-parameter chromosomes, Gaussian mutation, self-play evaluation, checkpointing, and frozen best-genome baseline validation.
- Headless simulator, benchmark, statistics, and report-writing infrastructure.
- Intent dataset generation and validation modules.
- Active learning, prediction, psychology, campaign, narrative, persistence, world state, and research helpers.
- Modal deployment script for hosting a fine-tuned Qwen/Game Designer model.

## Tech stack

- Framework: Next.js 16 App Router
- UI: React 19, Tailwind CSS 4, Radix/shadcn-style components
- Language: TypeScript 5
- Rendering: Canvas2D plus WebGL post-processing
- Audio: Web Audio API
- Runtime/package manager: Bun
- Server routes: Next.js route handlers
- AI inference: external Modal endpoint configured through environment variables
- Persistence/db dependency: Prisma is present, though gameplay itself is browser-driven

## Project structure

```text
src/app/
  page.tsx                       Main app entry
  api/ai/champion/route.ts        Returns the frozen champion genome
  api/ai/director/route.ts        Proxies live Qwen Director inference
  api/ai/ga-stats/route.ts        GA statistics endpoint
  api/ai/llm-info/route.ts        Model/info endpoint

src/components/game/
  EternalGame.tsx                Main game shell, canvas loop, input, menus
  StoryIntro.tsx                  Opening cinematic
  DestructionEnding.tsx           Ending sequence
  Director*.tsx                   Director UI panels and live visualizers
  AI*.tsx                         AI transparency panels/HUDs
  MatchDebriefPanel.tsx           Win/loss transition panel

src/lib/game/
  engine.ts                       Match phase FSM, collision, hazards, VFX, rounds
  fighter.ts                      Fighter physics and state machine
  ai.ts                           Rule-based opponent combat AI
  render.ts                       Canvas2D renderer
  poses.ts                        Pose and attack animation data
  audio.ts                        Procedural audio
  postfx.ts                       WebGL post-processing
  types.ts                        Shared gameplay types
  config/                         Opponents, physics, arenas, hazards, VFX constants
  director/                       Director engines and runtime state
  evolution/                      Genetic algorithm and champion genome system
  offline-ga/                     Offline gameplay-parameter GA trainer
  simulator/                      Headless simulation and batch execution
  intent/                         Intent schema, validation, dataset generation
  training/                       Fine-tuning dataset preparation
  ai/                             AI pipeline, model adapters, validation, prompts
  research/                       Benchmarking/statistics/research utilities

modal/
  modal_inference.py              Modal FastAPI endpoint for the fine-tuned model

scripts/
  build-intent-dataset.ts
  evolve-champion.ts
  evolve-library.ts
  evolve-widow.ts
  freeze-genomes.ts
  ga-vs-ga.ts
  train-offline-ga.ts
  run-evaluation.ts
  run-research-dashboard.ts
  run-simulator.ts
  smoke-test-adapter.ts
  verify-e2e.ts

tests/
  director/
  evolution/
  intent/
  ai/
```

## Environment

Create `.env` from `.env.example`:

```env
DATABASE_URL="file:./db/custom.db"
ETERNAL_MODEL_ENDPOINT="https://YOUR-WORKSPACE--eternal-inference-eternal-game-designer.modal.run"
ETERNAL_MODEL_API_KEY=""
```

`ETERNAL_MODEL_ENDPOINT` is required for live Qwen Director mode. It should point at the Modal endpoint that returns a valid intent payload. `ETERNAL_MODEL_API_KEY` is optional and only needed if the endpoint is protected.

## Running locally

Install dependencies:

```bash
bun install
```

Start the development server:

```bash
bun run dev
```

Open:

```text
http://localhost:3000
```

Build:

```bash
bun run build
```

Start the production server after build:

```bash
bun run start
```

## Offline GA training

The offline GA trainer evolves normalized gameplay parameters, not neural-network weights. It uses a 100-genome population by default, tournament selection, 20% elitism, uniform crossover, Gaussian mutation, deterministic seeds, per-generation checkpoints, and final frozen-genome validation against the story baseline opponents.

Run:

```bash
bun run train:offline-ga
```

Resume from the latest checkpoint:

```bash
bun run train:offline-ga -- --resume
```

Default outputs:

```text
best_genome.json
data/offline-ga-checkpoints/latest.json
data/offline-ga-checkpoints/generation_XXXX.json
```

Latest full run status, July 2, 2026:

- Command: `bun run train:offline-ga`
- Config: population 100, initial training generations 100, max generations 300, validation threshold 80%, 20 validation fights per baseline.
- Result: accepted champion after validation at generation 99.
- Final best genome: `offline_5_0000l5`, fitness `0.742401678240735`.
- Validation win rates: Lynx 100%, Bandit 100%, Crane 100%, Hermit 100%, Widow 100%, Butcher 100%, Shogun 100%, Titan 85%.
- Artifacts written: `best_genome.json` and 100 generation checkpoints plus `latest.json`.
- Notes: headless simulator validation now runs decisive fights; side-aware AI controllers and stricter genome/opponent detection prevent the earlier all-draw validation failure mode.

## Controls

### Player 1

| Action | Keys |
| --- | --- |
| Move | `A` / `D` or left/right arrows |
| Jump | `W`, `Space`, or up arrow |
| Crouch | `S` or down arrow |
| Roll | `E` |
| Punch | `J` or `Z` |
| Kick | `K` or `X` |
| Roundhouse | `I` or `U` |
| Throw | `F` / `T`, or punch+kick together |
| Super | `Q` |
| Block | `L` or `Shift` (all strikes; throws ignore block) |
| Pause | `Esc`, `P`, or the on-screen pause button |

### Player 2

| Action | Keys |
| --- | --- |
| Move | Arrow keys |
| Punch | `,` |
| Kick | `.` |
| Roundhouse | `/` |
| Roll | `;` |
| Block | `'` |
| Super | `]` |
| Throw | `[` |

## Qwen Director flow

1. The UI starts a match path in `EternalGame.tsx`.
2. The engine enters `intro`.
3. `requestAIDirector()` posts match context to `/api/ai/director` (aborts after ~4s).
4. The route handler forwards context to `ETERNAL_MODEL_ENDPOINT`.
5. On success, the returned intent is validated and `engine.applyAIIntent()` applies live Qwen plan (`status: "live"`).
6. On failure or timeout, `engine.setDirectorFallback()` applies the deterministic Classic Director plan (`status: "fallback"`) and **unlocks the fight** — never soft-locks.
7. The intro gate holds only while `status === "thinking"`. Practice mode and 2P skip the wait.
8. Live or fallback both can blend combat themes; UI labels Classic vs Live honestly.

## Testing and validation

Focused Director tests:

```bash
bun test tests/director
```

Lint:

```bash
bun run lint
```

Known status:

- Offline GA targeted lint passes for `scripts/train-offline-ga.ts` and `src/lib/game/offline-ga/*.ts`.
- Offline GA default run writes an accepted `best_genome.json` that clears the 80% baseline validation threshold.
- Director combat tests pass.
- Lint currently exits successfully with existing warnings about unused ESLint-disable comments in research/simulator files.
- Full `tsc --noEmit` currently reports pre-existing repo-wide type issues in examples, scripts, older AI exports, hazard config typings, and Bun test type resolution. Those are not limited to the live Director feature.

## Deployment notes

The app can be deployed as a Next.js app. For live Qwen Director behavior, deploy the Modal model endpoint first and set `ETERNAL_MODEL_ENDPOINT` in the hosting environment.

The Modal script is in:

```text
modal/modal_inference.py
```

Typical Modal flow:

```bash
modal deploy modal/modal_inference.py
```

Then copy the generated endpoint URL into `ETERNAL_MODEL_ENDPOINT`.

## Documentation

- `README.md` — full project overview and setup.
- `docs/REPORT.md` — technical implementation report.
- `docs/README_QWEN_DIRECTOR.md` — focused Qwen Director notes.
- `docs/REPORT_QWEN_DIRECTOR.md` — focused Qwen Director implementation report.
- `docs/` — additional guides (deployment, Modal training, genome freeze, evaluation, reproducibility, refactoring notes).

## Contributors

- [sankalphs](https://github.com/sankalphs)
- [Sathvikar01](https://github.com/Sathvikar01)
