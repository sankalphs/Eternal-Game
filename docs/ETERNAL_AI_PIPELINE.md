# Project Eternal — AI Research Pipeline

**Production-quality fine-tuning pipeline for the Project Eternal Game Designer model.**

Project Eternal is a cinematic shadow fighting game. The deterministic
Director (V3) is the source of truth for gameplay. The LLM Game Designer
sits above it and produces **only high-level intent** — never low-level
gameplay values. The Director (V5) translates intent into the final
DirectorPlanV3.

## What this pipeline does

1. **Refactor** the legacy LLM target from low-level design choices
   (weather, camera, hazards, boss style, difficulty) to
   high-level intent (intent / reasoning / expectedPlayerReaction /
   highLevelPlan / confidence).

2. **Freeze** the best GA-evolved genomes into permanent teacher
   policies. Frozen libraries are never evolved again — new versions
   are appended (GenomeLibrary_v1.json, GenomeLibrary_v2.json, ...).

3. **Generate** 100,000+ high-quality training samples via 11
   pipelines (GA vs GA, GA vs archetypes, GA vs frozen champions,
   student vs champion, student vs distilled teacher, student vs GA,
   director intent evaluation, replay evaluation, active learning,
   offline distillation, research validation).

4. **Train** a small LLM (Gemma 3 270M by default, swappable to 1B,
   Qwen, Phi, Llama, Mistral, TinyLlama) on Modal with QLoRA.

5. **Deploy** the fine-tuned model as a Modal endpoint and replace the
   MockAdapter in the game with the new `FineTunedAdapter`.

6. **Evaluate** the fine-tuned model against the V3 baseline on 9
   metrics with statistical significance tests. Output is a
   publication-quality Markdown + JSON report.

7. **Version** every artifact (Dataset, Genome, Teacher, Prompt,
   Model, TrainingConfig, Distillation, Experiment) and store the
   version manifest in every checkpoint.

## The new training target

The model produces ONLY:

```json
{
  "intent": "<short label of what this fight is FOR>",
  "reasoning": "<1-5 sentences explaining the choice>",
  "expectedPlayerReaction": "<what the player will likely do>",
  "highLevelPlan": "<1-3 sentence abstract plan>",
  "confidence": <0..1>
}
```

The model NEVER outputs weather, camera, lighting, hazards,
boss style, difficulty, or dialogue. The deterministic
`IntentTranslator` converts the intent into concrete Director
overrides. The Director (V3) applies the overrides and produces the
final plan.

## Quick start

```bash
# 1. Install Modal
pip install modal
modal token new

# 2. Build the dataset (100k samples)
bun run scripts/build-intent-dataset.ts --out ./data/intent_dataset

# 3. Freeze the genome library
bun run scripts/freeze-genomes.ts \
  --in champions/library.json \
  --out ./data/genome_libraries \
  --version v1

# 4. Train on Modal
modal run modal/modal_train.py \
  --model-name google/gemma-3-270m-it \
  --train-path /data/intent_dataset/train.jsonl \
  --validation-path /data/intent_dataset/validation.jsonl \
  --output-dir /data/checkpoints/eternal-game-designer

# 5. Deploy the inference endpoint
modal deploy modal/modal_inference.py

# 6. Set the endpoint in the game
export ETERNAL_MODEL_ENDPOINT=https://your-modal-endpoint.modal.run

# 7. Evaluate
bun run scripts/run-evaluation.ts --endpoint $ETERNAL_MODEL_ENDPOINT
```

## Repository layout

```
src/lib/game/
├── intent/                          # NEW — the intent layer
│   ├── IntentSchema.ts              # Schema for the 5-field output
│   ├── IntentTranslator.ts          # Deterministic intent → Director overrides
│   ├── IntentOutputValidator.ts     # Validates and cleans the LLM output
│   ├── IntentContextBuilder.ts      # Builds the input context
│   ├── IntentTrainingSample.ts      # The new training sample format
│   ├── IntentQualityEngine.ts       # Quality scoring for samples
│   ├── MassiveDatasetGenerator.ts   # 11 pipelines × 100k samples
│   ├── MassiveDatasetExporter.ts    # train/val/test JSONL split
│   ├── DatasetBuildOrchestrator.ts  # High-level orchestrator
│   └── VersionManifest.ts           # Versioning for every artifact
│
├── gamedesigner/                    # MODIFIED — intent-only mode
│   ├── PromptLibrary.ts             # v4 = intent-only prompt
│   ├── IntentGameDesigner.ts        # NEW — produces IntentOutput
│   └── GameDesigner.ts              # LEGACY — kept for v1-v3 prompts
│
├── director/                        # MODIFIED
│   ├── DirectorEngineV3.ts          # UNTOUCHED — deterministic baseline
│   └── DirectorEngineV5.ts          # NEW — intent-aware director
│
├── evolution/                       # MODIFIED
│   ├── Genome.ts                    # UNTOUCHED — existing
│   ├── EvolutionManager.ts          # UNTOUCHED — existing
│   ├── FrozenGenomeLibrary.ts       # NEW — permanent teacher policies
│   └── ConvergenceDetector.ts       # NEW — GA convergence gate
│
├── ai/models/                       # MODIFIED
│   ├── Adapters.ts                  # MockAdapter + OllamaAdapter (legacy)
│   ├── FineTunedAdapter.ts          # NEW — Modal endpoint + local HF
│   └── AdapterFactory.ts            # NEW — picks the right adapter
│
├── research/                        # MODIFIED
│   └── EvaluationHarness.ts         # NEW — V3 vs V5 with 9 metrics
│
└── (everything else)                # UNTOUCHED

scripts/                             # NEW — operational scripts
├── build-intent-dataset.ts          # Generate 100k samples
├── freeze-genomes.ts                # Freeze a live library
└── run-evaluation.ts                # Compare V3 vs V5

modal/                               # NEW — Modal training infrastructure
├── modal_train.py                   # Fine-tune on Modal
├── modal_inference.py               # Deploy as endpoint
├── launch_modal.sh                  # End-to-end launch
├── requirements.txt                 # Pinned deps
├── configs/
│   ├── training_config.yaml         # Training hyperparams
│   └── lora_config.yaml             # LoRA / QLoRA config
└── eval/
    ├── evaluate_model.py            # Single-model evaluation
    └── export_hf.py                 # Merge LoRA + push to Hub
```

## Architecture invariants

- The combat engine, physics, and rendering are NEVER modified.
- The deterministic Director (V3) is the source of truth for gameplay.
- The LLM emits ONLY intent. The Director translates intent to gameplay.
- Every training sample is graded and filtered; only gold + high pass.
- Every artifact is versioned. The version manifest is in every checkpoint.
- Every experiment is reproducible given the same config + seed.

## Documentation

- `docs/REFACTOR_NOTES.md` — migration from legacy GameDesignPlan to intent
- `docs/GENOME_FREEZE.md` — how to freeze a library
- `docs/MODAL_TRAINING.md` — how to train on Modal
- `docs/EVALUATION.md` — how to evaluate
- `docs/MODEL_SWITCHING.md` — how to switch between models
- `docs/DEPLOYMENT.md` — deployment guide
- `docs/REPRODUCIBILITY.md` — full reproducibility guide
