# REPRODUCIBILITY — How to reproduce a result

Project Eternal is built for full reproducibility. Every artifact
in the pipeline is versioned and hashed. This document explains
how to reproduce a specific training run end-to-end.

## Reproducing a dataset

Given a frozen library (`GenomeLibrary_v1.json`), the dataset
generator is fully deterministic given the same seed and config.

```bash
bun run scripts/build-intent-dataset.ts \
  --out ./data/intent_dataset \
  --frozen ./data/genome_libraries/GenomeLibrary_v1.json \
  --target 100000 \
  --seed 42
```

The output is byte-identical across runs (modulo non-determinism
in the host platform's PRNG, which we mitigate with Mulberry32).

## Reproducing a training run

Given a dataset and a config file, the training run is reproducible
modulo CUDA non-determinism.

```bash
# Pin the dataset
cp ./data/intent_dataset/train.jsonl ./snapshots/train.jsonl
cp ./data/intent_dataset/validation.jsonl ./snapshots/validation.jsonl

# Pin the config
cp modal/configs/training_config.yaml ./snapshots/training_config.yaml
cp modal/configs/lora_config.yaml ./snapshots/lora_config.yaml

# Train
modal run modal/modal_train.py \
  --config ./snapshots/training_config.yaml \
  --lora-config ./snapshots/lora_config.yaml \
  --model-name google/gemma-3-270m-it \
  --train-path /data/intent_dataset/train.jsonl \
  --validation-path /data/intent_dataset/validation.jsonl \
  --output-dir /data/checkpoints/snapshot-001 \
  --seed 42
```

For full CUDA determinism, set `CUBLAS_WORKSPACE_CONFIG=:4096:8`
in the Modal container.

## Reproducing an evaluation

```bash
# Pin the test set
cp ./data/intent_dataset/test.jsonl ./snapshots/test.jsonl

# Run evaluation
bun run scripts/run-evaluation.ts \
  --endpoint $ETERNAL_MODEL_ENDPOINT \
  --contexts 200 \
  --seed 42 \
  --out ./eval_results/snapshot-001
```

The harness uses the same seed for synthetic context generation,
so the contexts are identical across runs.

## Versioning

Every run produces a `version_manifest.json` that records:

- The dataset version (id, count, paths)
- The genome version (library, entries)
- The teacher version (kind, identifier, fitness, ELO)
- The prompt version (id, label, outputSchema)
- The model version (family, base, parameters, peft, quantization)
- The training config version (epochs, lr, batch, optim, ...)
- The distillation version (method, n, temperature, quality)
- The experiment version (id, seed, gitCommit, wandbRunId, ...)

The manifest is stored at the root of the output directory and
in the model card on HuggingFace.

## Comparing runs

Two runs are comparable iff their version manifests match
(ignoring `experiment.id`, `experiment.startedAt`, etc.).

```ts
import { deserializeManifest } from "./src/lib/game/intent";

const a = deserializeManifest(fs.readFileSync("./run-a/manifest.json", "utf-8"));
const b = deserializeManifest(fs.readFileSync("./run-b/manifest.json", "utf-8"));

const comparable =
  a.dataset.id === b.dataset.id &&
  a.genome.libraryVersion === b.genome.libraryVersion &&
  a.prompt.id === b.prompt.id &&
  a.model.baseModel === b.model.baseModel &&
  a.trainingConfig.seed === b.trainingConfig.seed;
```

## What is NOT deterministic

- **CUDA matmul.** For bitwise-reproducible training, set
  `CUBLAS_WORKSPACE_CONFIG=:4096:8` and use
  `torch.use_deterministic_algorithms(True)`.
- **Network latency.** Affects the timing of HTTP endpoint calls.
  Use the same machine / network for fair comparisons.
- **HuggingFace downloads.** Use a pinned revision
  (`--revision <commit_hash>`) to avoid surprise updates.

## Hashing

The `VersionManifest` includes:

- `datasetHash` — SHA-256 of the dataset config
- `configHash` — SHA-256 of the prompt + model + training + distillation configs
- `codeHash` — SHA-256 of the codebase timestamp (not a true content
  hash, but useful for distinguishing builds)

For a true content hash of the codebase, use:

```bash
git rev-parse HEAD
```

and store it in `experiment.gitCommit` (the build script does this
automatically if run inside a git repo).

## End-to-end reproduction

To reproduce every result in this repository from scratch:

1. Clone the repository.
2. `pip install -r modal/requirements.txt`
3. `bun install`
4. `modal token new`
5. `bash modal/launch_modal.sh` (this runs the full pipeline)
6. The script writes everything to `./data/` and `./eval_results/`.

The output is versioned, hashed, and reproducible.
