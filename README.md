# Eternal — The Shadow's Ascension

Eternal is a cinematic browser fighting game built with Next.js, TypeScript, Canvas2D, WebGL post-processing, procedural audio, and a Director that shapes each encounter from a fixed set of encounter rules. The player is not the hero: they are the ancient shadow wearing a dead hero's memories, hunting the last Sealers of a collapsing world.

The build pairs a playable 2D fighting game with an AI research and tooling stack. Each fight is directed by deterministic, chapter-driven rules, and after every match the game runs a short player analysis that it uses — together with an optional fine-tuned Qwen model — to choose the genome style the next opponent will fight with.



## Current feature set

### Game modes

- Story tournament through eight opponents: Lynx, Bandit, Crane, Hermit, Widow, Butcher, Shogun, and Titan.
- Free Select mode for choosing an opponent and arena directly.
- Local two-player versus mode (second human-controlled shadow fighter).
- Practice mode (offline Classic Director, infinite HP) and a skippable micro-tutorial.
- Skip-to-ending mode for jumping directly to the destruction finale.
- Best-of-three round structure with victory, defeat, match debrief, story interstitials, and champion/endgame states.

### Combat

- Momentum-based movement with acceleration, friction, jump velocity, gravity, and stage bounds.
- Variable-height flip jump.
- Roll dodge with invulnerability frames.
- Punch, kick, roundhouse, throw/grab, and rage-powered super attack.
- Blocking reduces damage for all strikes when correctly facing the attacker (kicks do not beat stand-block).
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

### AI opponent system (rule-based)

- `EnemyAI` drives single-player opponents through a rule-based finite-state combat controller (`src/lib/game/ai.ts`).
- Opponents have authored combat traits such as aggression, block chance, reaction speed, combo length, whiff punish, anti-air, pressure, mixup, adaptation, rage, and perfection.
- Habit tracking responds to repeated player openings such as blocking, jumping, and attacking patterns (`directorJournal.ts`'s `computeAIDebrief`).


### Post-match analysis + genome selection (the adaptive loop)

After each match the `MatchDebriefPanel` runs the analysis and genome selection:

1. Computes a player debrief (`computeAIDebrief`): grade, archetype, behavioral observations, and trait scores.
2. Optionally calls `/api/ai/director` (the configured Qwen endpoint) once for a one-paragraph written analysis and a hint about which genome style should face the player next.
3. On failure or timeout (12s) it falls back to a local style pick (`selectGenomeStyleFromLocal`) so the feature works fully offline.
4. Loads the chosen style's frozen genome from `champions/{style}.json` via `/api/ai/genome` and stages it on the engine (`setChampionOverride` + `setUseChampionGenome(true)`) so the next opponent fights with that genome.
5. The panel shows the grade, player model, traits, the analysis paragraph, and the selected next-genome style.

This is the mechanism the project uses to select a genome after rounds and show analysis after each round, with an optional model assist when an endpoint is configured.

### AI transparency UI

Wired and rendering in the running game:

- `LiveAIDirector` panel.
- `DirectorChipStrip` (reads `DirectorRuntimeState`).
- `DirectorTimeline` (mounted via `DirectorPanel`).
- `DirectorNarration`.
- `AIInsightsPanel`.
- `AIGenomeHud`.
- `AIDecisionTicker`.
- `MatchDebriefPanel` (post-match analysis + genome selection).

Not mounted in the current build (defined but never imported): `EvolutionPanel.tsx`, `DirectorActionVisualizer.tsx`, `DirectorIntentCard.tsx`.


## Tech stack

- Framework: Next.js 16 App Router
- UI: React 19, Tailwind CSS 4, Radix/shadcn-style components
- Language: TypeScript 5
- Rendering: Canvas2D plus WebGL post-processing
- Audio: Web Audio API
- Runtime/package manager: Bun
- Server routes: Next.js route handlers
- Optional AI inference: external Modal endpoint configured through environment variables (used only for post-match analysis)
- Persistence/db dependency: Prisma is present, though gameplay itself is browser-driven


## Environment

Create `.env` from `.env.example`:

```env
DATABASE_URL="file:./db/custom.db"
ETERNAL_MODEL_ENDPOINT="https://YOUR-WORKSPACE--eternal-inference-eternal-game-designer.modal.run"
ETERNAL_MODEL_API_KEY=""
```

`ETERNAL_MODEL_ENDPOINT` is **optional**. It is only used by `/api/ai/director` for the post-match written analysis. When it is absent the game still runs fully: combat uses the deterministic Director, and after each match the analysis + next-genome pick fall back to local, rule-based logic. `ETERNAL_MODEL_API_KEY` is optional and only needed if the endpoint is protected.

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

## Director + genome flow 

1. The UI starts a match path in `EternalGame.tsx`.
2. The engine enters `intro` and applies a Classic Director plan (`applyDirectorPlan` / `applyOfflineDirector`) built from `DirectorRuntime.buildDirectorState(opponentIndex)`. No model call is made.
3. The match plays out; the Director state (weather, lighting, camera, hazards, confidence-blended combat tuning) is read by the renderer and engine. `watchDirector` records the encounter into the local player journal.
4. When the match ends, `MatchDebriefPanel` mounts and:
   - computes a local debrief (`computeAIDebrief`),
   - posts a `post_match_analysis` context to `/api/ai/director` for the written analysis + next-genome style hint (12s timeout, local fallback),
   - fetches `champions/{style}.json` via `/api/ai/genome` and stages it as the next opponent genome.
5. The panel shows the grade, player model, traits, analysis paragraph, and selected next-genome style. The next fight uses that genome.

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
- Director combat tests pass (testing the deterministic `DirectorRuntime`).
- Lint currently exits successfully with existing warnings about unused ESLint-disable comments in research/simulator files.
- Full `tsc --noEmit` currently reports pre-existing repo-wide type issues in examples, scripts, older AI exports, hazard config typings, and Bun test type resolution. Those are not limited to the Director feature.

## Deployment notes

The app can be deployed as a Next.js app. The post-match Qwen analysis is optional; without `ETERNAL_MODEL_ENDPOINT` the game runs entirely on the deterministic Director and local analysis. To enable post-match analysis, deploy the Modal model endpoint first and set `ETERNAL_MODEL_ENDPOINT` in the hosting environment.

The Modal script is in:

```text
modal/modal_inference.py
```

Typical Modal flow:

```bash
modal deploy modal/modal_inference.py
```

Then copy the generated endpoint URL into `ETERNAL_MODEL_ENDPOINT`.


## Contributors

- [sankalphs](https://github.com/sankalphs)
- [Sathvikar01](https://github.com/Sathvikar01)
