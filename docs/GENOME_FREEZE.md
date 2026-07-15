# GENOME FREEZE — How to freeze a genome library

## What is a frozen library?

A frozen library is a permanent, immutable collection of the BEST
genomes from a completed evolution run. Frozen libraries are the
teacher policies for the fine-tuning dataset. They are stored as
JSON files with the naming convention `GenomeLibrary_vN.json`.

Once frozen, a library is NEVER evolved again. New versions are
appended (`v1`, `v2`, `v3`, ...). The old version stays untouched
so previous experiments are always reproducible.

## When to freeze

Freeze a library when the GA has converged. Convergence is detected
by `ConvergenceDetector` based on three signals:

1. **Fitness plateau** — top fitness stops improving over the last
   N generations.
2. **Population diversity collapse** — the average pairwise distance
   between genomes drops below a threshold.
3. **ELO stabilisation** — the rating delta over the last N matches
   is below a threshold.

The detector requires that fitness plateau is mandatory. Diversity
collapse and ELO stabilisation are alternative signals. When two of
three are positive, the library is ready to freeze.

## How to freeze

### Step 1: Run the GA to convergence

Use the existing evolution framework. The `GenomeLibrary` class
produces an `IGenomeLibrary` once the run is done:

```bash
bun run scripts/evolve-library.ts
```

This writes `champions/library.json` (or similar).

### Step 2: Freeze

```bash
bun run scripts/freeze-genomes.ts \
  --in champions/library.json \
  --out ./data/genome_libraries \
  --version v1 \
  --top 1 \
  --notes "first frozen library from convergence run 2026-06-29"
```

This writes `data/genome_libraries/GenomeLibrary_v1.json` and a
small summary file.

### Step 3: Use the frozen library in dataset generation

```bash
bun run scripts/build-intent-dataset.ts \
  --out ./data/intent_dataset \
  --frozen ./data/genome_libraries/GenomeLibrary_v1.json \
  --target 100000
```

The `MassiveDatasetGenerator` will use the frozen library as the
teacher for the `ga_vs_frozen_champion` and `student_vs_champion`
pipelines.

## Versioning

Frozen libraries have a `version` field (`v1`, `v2`, ...) and a
`lineage` field that records all previous versions. When a new
library is frozen, the previous library is passed via
`--previous` and the lineage is updated.

## Storage layout

```
data/genome_libraries/
├── GenomeLibrary_v1.json
├── GenomeLibrary_v1_summary.json
├── GenomeLibrary_v2.json
├── GenomeLibrary_v2_summary.json
└── ...
```

## Comparison

`GenomeFreezer.diff(a, b)` produces a `FrozenLibraryDiff` that
reports added, removed, and common entries, plus ELO deltas. Used
by the evaluation harness to compare library versions.
