#!/usr/bin/env bash
# =============================================================================
# Project Eternal — LOCAL Launch Script (no Modal required)
# =============================================================================
# Runs the full pipeline locally:
#   1. Build the dataset (1k samples for quick testing)
#   2. Train a tiny model locally (or skip)
#   3. Run evaluation against the mock adapter
#   4. Smoke test the AdapterFactory
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${DATA_DIR:-./data/intent_dataset_local}"
FROZEN_LIBRARY="${FROZEN_LIBRARY:-./data/genome_libraries/GenomeLibrary_v1.json}"
TARGET_SAMPLES="${TARGET_SAMPLES:-1000}"
SEED="${SEED:-42}"
EVAL_CONTEXTS="${EVAL_CONTEXTS:-50}"

cd "$PROJECT_ROOT"

echo "============================================================"
echo "[Eternal Local] LOCAL pipeline (no Modal)"
echo "============================================================"
echo "DATA_DIR          = $DATA_DIR"
echo "FROZEN_LIBRARY    = $FROZEN_LIBRARY"
echo "TARGET_SAMPLES    = $TARGET_SAMPLES"
echo "SEED              = $SEED"
echo "EVAL_CONTEXTS     = $EVAL_CONTEXTS"
echo "============================================================"

# Step 0: freeze the genome library if not present
mkdir -p "$(dirname "$FROZEN_LIBRARY")"
if [[ ! -f "$FROZEN_LIBRARY" && -f champions/library.json ]]; then
  echo "[Eternal Local] Freezing live library..."
  bun run scripts/freeze-genomes.ts \
    --in champions/library.json \
    --out "$(dirname "$FROZEN_LIBRARY")" \
    --version v1 \
    --notes "frozen from live evolution run $(date -u +%Y-%m-%d)"
fi

# Step 1: generate a small dataset
echo "[Eternal Local] Generating $TARGET_SAMPLES samples..."
if [[ -f "$FROZEN_LIBRARY" ]]; then
  bun run scripts/build-intent-dataset.ts \
    --out "$DATA_DIR" \
    --target "$TARGET_SAMPLES" \
    --frozen "$FROZEN_LIBRARY" \
    --seed "$SEED"
else
  bun run scripts/build-intent-dataset.ts \
    --out "$DATA_DIR" \
    --target "$TARGET_SAMPLES" \
    --seed "$SEED"
fi

# Step 2: run evaluation against the mock adapter
echo "[Eternal Local] Running evaluation (mock adapter)..."
mkdir -p eval_results
bun run scripts/run-evaluation.ts \
  --contexts "$EVAL_CONTEXTS" \
  --seed "$SEED" \
  --out ./eval_results

# Step 3: smoke test the AdapterFactory
echo "[Eternal Local] Smoke testing AdapterFactory..."
bun run scripts/smoke-test-adapter.ts

echo "============================================================"
echo "[Eternal Local] Done"
echo "============================================================"
echo "Dataset:     $DATA_DIR"
echo "Evaluation:  ./eval_results"
echo "Adapter:     ./eval_results/adapter_smoke.json"
echo "============================================================"
