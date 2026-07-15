# Eternal — Technical Implementation Report & Live-vs-Dead-Code Audit

**Date:** 2026-07-15
**Scope:** What is actually wired into the running browser game, what is offline
tooling, and what is dead/never-invoked code. Written to replace the
misleading "live Qwen Director" narrative in the prior README with the real
runtime behavior.

---

## 1. Executive summary

- The in-browser game is **fully deterministic at runtime**. There is **no live
  model call during combat**.
- The combat "Director" is `src/lib/game/director/DirectorRuntime.ts`, a
  fixed chapter→intent→parameter lookup table. It is rule-based and offline.
- Qwen (the fine-tuned model behind `ETERNAL_MODEL_ENDPOINT`) is consulted
  **exactly once per match**, in `MatchDebriefPanel`, for a written player
  analysis + a hint about the next genome style. It has a deterministic local
  fallback when the endpoint is absent or times out.
- The "adaptive" behavior the project advertises is the **post-match genome
  selection loop**: after each match the game picks a frozen genome style from
  `champions/{style}.json` and stages it for the next fight.
- The large `evolution/`, `offline-ga/`, `simulator/`, `research/`,
  `gamedesigner/`, `training/`, `intent/` (dataset generation), `active/`,
  `distillation/`, `prediction/`, `profiler/`, `world/`, `campaign/`,
  `narrative/` trees are **real and runnable**, but they are **offline tooling**
  used by `scripts/*.ts` to train/validate models and genomes. They are not
  imported by the runtime game or its routes.
- Three components are defined but never mounted: `EvolutionPanel.tsx`,
  `DirectorActionVisualizer.tsx`, `DirectorIntentCard.tsx`.
- The in-combat "live Qwen" engine methods (`setDirectorThinking`,
  `applyAIIntent`, `setDirectorFallback`) are **dead code** — grep finds zero
  callers in `src/components` or `src/app`.

---

## 2. Runtime architecture (LIVE)

Entry point: `src/components/game/EternalGame.tsx` → `src/lib/game/engine.ts`.

### Core engine modules (all live)
| Module | Role |
| --- | --- |
| `engine.ts` | Match-phase FSM, collision, hazards, VFX, rounds, GA-champion overlay |
| `fighter.ts` | Fighter physics + state machine |
| `ai.ts` | `EnemyAI` — rule-based opponent controller |
| `render.ts` | Canvas2D renderer |
| `poses.ts` | Pose / attack animation data |
| `audio.ts` | Procedural Web Audio |
| `postfx.ts` | WebGL post-processing |
| `types.ts` | Shared gameplay types |
| `config/*` | Opponents, physics, arenas, hazards, VFX constants |
| `canvas-utils.ts` | Canvas helpers (used by EternalGame, StoryIntro, DestructionEnding) |
| `story.ts` | Story script data |

### Director (live, deterministic)
- `director/DirectorRuntime.ts` — `buildDirectorState(opponentIndex)` builds a
  `DirectorRuntimeState` from `CHAPTER_INTENTS` (index→intent) and `INTENT_TABLE`
  (intent→weather/lighting/camera/hazards/combat tuning). The renderer and
  engine read this state directly.
- `applyDirectorCombatIntent(base, intent, confidence)` blends the intent's
  combat multipliers onto the authored opponent (or GA genome) traits.
- `applyAIIntent(...)` exists for the (unused) live path; it is not called.

### Post-match analysis + genome selection (LIVE — the adaptive loop)
- `directorJournal.ts` — `computeAIDebrief(engine)` (grade, archetype,
  observations, traits) and `watchDirector`/`recordEncounter` for local history.
- `postMatchAnalysis.ts` — `buildPostMatchDirectorContext`,
  `selectGenomeStyleFromIntent`, `selectGenomeStyleFromLocal`,
  `buildAnalysisSummary`, `buildLocalSummary`.
- `MatchDebriefPanel.tsx` — after each match: local debrief → optional
  `/api/ai/director` call → `/api/ai/genome?style=...` → `engine.setChampionOverride`
  + `setUseChampionGenome(true)`. Shows grade, player model, traits, analysis,
  and the selected next-genome style.
- `intent/IntentOutputValidator.ts` — validates the Qwen payload returned by
  `/api/ai/director`. This is the only gamedesigner-adjacent module on the live path.

### Live server routes (all called via `fetch` from components)
| Route | Behavior |
| --- | --- |
| `/api/ai/champion` | Reads `ChampionGenome.json`; shows the loaded genome in the HUD |
| `/api/ai/director` | Proxies `ETERNAL_MODEL_ENDPOINT`, validates with `IntentOutputValidator` (post-match only) |
| `/api/ai/ga-stats` | Reads `data/genome_libraries/GenomeLibrary_v2_summary.json` |
| `/api/ai/genome` | Reads `champions/{style}.json` for the next-genome pick |
| `/api/ai/llm-info` | Model/info endpoint |

### Live UI components (mounted)
`EternalGame`, `StoryIntro`, `DestructionEnding`, `DirectorPanel` (+`DirectorTimeline`),
`DirectorNarration`, `DirectorChipStrip`, `DirectorNotification`, `LiveAIDirector`,
`AIInsightsPanel`, `AIGenomeHud`, `AIDecisionTicker`, `MatchDebriefPanel`,
`AboutAI`.

### Live data assets
- `champions/*.json` — frozen style genomes: `adaptive`, `aggressive`, `balanced`,
  `counter`, `mindGame`, `patient`, `pressure`, `rushdown`, `zoner`, plus `library.json`.
- `ChampionGenome.json` — frozen champion genome served by `/api/ai/champion`.
- `best_genome.json`, `EvolutionReport.json` — offline-GA artifacts.

---

## 3. The Director reality (correcting prior docs)

Prior README claim: *"a live Qwen-powered AI Director"* that *"drives weather,
lighting, camera, hazards… over authored / GA genomes"* and *"Single-player
prefers live Qwen: intro holds only while status is `thinking`."*

Audit result:

- The engine method `setDirectorThinking()` sets `status: "thinking"` and is
  intended to hold the intro for a live plan. **It is never called** from any
  component or route (grep: 0 results).
- `applyAIIntent()` and `setDirectorFallback()` are likewise **never called**.
- Every match start path (`startMatchWith`, `nextOpponent`, `startPractice`,
  `startTwoPlayer`, `applyClassicDirectorForFight`) calls
  `applyDirectorPlan()` / `applyOfflineDirector()`, i.e. the **Classic /
  deterministic** Director.
- `EternalGame.tsx` explicitly comments: *"Qwen is NEVER called during gameplay
  — only after a match (MatchDebriefPanel) for analysis + next-genome selection.
  Combat uses Classic Director only."*

Conclusion: combat direction is 100% rule-based. The "live Qwen Director"
section of the prior README described code that is present but **dormant**.

---

## 4. The adaptive loop (what actually adapts)

1. `MatchDebriefPanel` mounts after a match.
2. `computeAIDebrief` derives a deterministic player model (grade + archetype +
   traits) from the engine snapshot.
3. A `post_match_analysis` context is POSTed to `/api/ai/director`. If
   `ETERNAL_MODEL_ENDPOINT` is set and responds within 12s, Qwen returns an
   intent + reasoning used for the written paragraph and a genome-style hint
   (`selectGenomeStyleFromIntent`). Otherwise `selectGenomeStyleFromLocal(ai)`
   picks the style deterministically (`qwenStatus: "local"`).
4. `champions/{style}.json` is fetched and staged via `engine.setChampionOverride`
   + `setUseChampionGenome(true)` — applied to the **next** opponent only (never
   mid-combat).
5. The panel renders: grade, player model (archetype + observations), player
   traits, one-paragraph summary, and "Next opponent genome: <style>".

This satisfies the project goal of *"select a genome after rounds and do
analysis shown after each round"* — it is rule-based with an optional LLM assist.

---

## 5. Offline tooling (REAL, not gameplay)

These modules compile and are exercised by `scripts/*.ts` and research
harnesses, but are **not** on the runtime path:

- `evolution/` — `GenomeDirector`, `GenomeLibrary`, `FrozenGenomeLibrary`,
  `EvolutionManager`, `CrossoverEngine`, `MutationEngine`, `SelectionStrategy`,
  `Population`, `SimulationRunner`, `SelfPlayRunner`, `FitnessEvaluator`,
  `DatasetLogger`, `ConvergenceDetector`, `GenealogyEngine`,
  `NarrativeTraitEngine`, `ResearchReport*`. Note `GenomeDirector.selectGenome`
  is **not** called by the runtime; the live next-genome pick reads
  `champions/{style}.json` directly via the route.
- `offline-ga/` — `OfflineEvolutionTrainer`, `Fitness`, `Selection`,
  `CheckpointStore`, `SimulatorAdapter`. Only `train-offline-ga.ts` is wired into
  `package.json` (`train:offline-ga`).
- `simulator/` — `HeadlessEngine`, `SimulationRunner`, `BatchExecutor`,
  `BenchmarkSuite`, `MatchTypes`, `ExperimentManager`, `DatasetSink`. Headless
  only; the browser uses the real `engine.ts`, not `HeadlessEngine`.
- `research/` — `EvaluationHarness` (references `DirectorEngineV3/V5`,
  `GameDesignDatasetLogger`), `Dashboard`, `LargeScaleBench`, `MatchupMatrix`,
  `ExperimentTracker`.
- `gamedesigner/` — `GameDesigner`, `GameDesignerPipeline` (instantiates
  `DirectorEngineV4`), `IntentGameDesigner`, `GameDesignContextBuilder`,
  `GameDesignDatasetLogger`, `TrainingReadinessExporter`, etc. This is the
  **training-time** pipeline that *produces* the fine-tuned model served by
  `ETERNAL_MODEL_ENDPOINT`. It is not imported by the runtime or the live routes.
- `intent/` — `MassiveDatasetGenerator` (instantiates `DirectorEngineV3/V5`),
  `DatasetBuildOrchestrator`, `IntentSchema`, `IntentTranslator`,
  `IntentContextBuilder`. Dataset-generation tooling; only `IntentOutputValidator`
  is live.
- `training/`, `active/`, `distillation/`, `prediction/`, `profiler/`, `world/`,
  `campaign/`, `narrative/` — helper trees feeding dataset/research tooling.

### Scripts (offline)
Only `train-offline-ga.ts` is referenced by `package.json`. The other 19 scripts
(`build-intent-dataset`, `evolve-champion`, `evolve-library`, `evolve-widow`,
`freeze-genomes`, `ga-vs-ga`, `generate-*`, `run-*`, `smoke-test-*`, `verify-e2e`)
are runnable manually but are not wired into npm scripts and are not invoked by
the runtime.

---

## 6. Dead / unused code

- **Components never mounted:** `EvolutionPanel.tsx`,
  `DirectorActionVisualizer.tsx`, `DirectorIntentCard.tsx`.
- **Dormant in-combat Director methods:** `engine.setDirectorThinking`,
  `engine.applyAIIntent`, `engine.setDirectorFallback` (no callers).
- `DirectorEngineV1` base + `DirectorEngineV2/V3/V4/V5` are only used by the
  offline `gamedesigner`/`intent`/`research` tooling — not by the live game.

---

## 7. Artifacts & non-source directories

- `best_genome.json`, `ChampionGenome.json`, `EvolutionReport.json` — generated
  artifacts (offline GA / evolve scripts).
- `examples/`, `paper/`, `modal/` (deploy script only), `mini-services/`,
  `download/`, `eval_results/`, `tool-results/`, `agent-ctx/`, `data/` — docs,
  reports, and research outputs; not imported by the runtime.
- `tests/` — Bun test suites (e.g. `tests/director`).
- `docs/` — secondary guides and reports.

---

## 8. How to read this for contribution

- To change **combat feel / Director presentation**, edit `engine.ts`,
  `ai.ts`, `director/DirectorRuntime.ts`, `config/*`, and the live `Director*`
  / `AI*` components.
- To change **how the opponent adapts between matches**, edit
  `postMatchAnalysis.ts`, `directorJournal.ts`, `MatchDebriefPanel.tsx`, and the
  `champions/*.json` genomes.
- To change **the trained model or datasets**, work in `scripts/`,
  `evolution/`, `offline-ga/`, `simulator/`, `gamedesigner/`, `intent/`,
  `training/` — these never affect the deployed game unless you re-train and
  redeploy `modal/modal_inference.py` and point `ETERNAL_MODEL_ENDPOINT` at it.
