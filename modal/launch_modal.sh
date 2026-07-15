#!/usr/bin/env bash
# =============================================================================
# Project Eternal — Modal Launch Script
# =============================================================================
# Run the full pipeline:
#   1. Build the dataset (if not already built)
#   2. Train the model on Modal
#   3. Deploy the inference endpoint on Modal
#   4. Smoke-test the endpoint
# =============================================================================

set -euo pipefail

# ---- Configuration ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${DATA_DIR:-./data/intent_dataset}"
FROZEN_LIBRARY="${FROZEN_LIBRARY:-./data/genome_libraries/GenomeLibrary_v1.json}"
TARGET_SAMPLES="${TARGET_SAMPLES:-100000}"
SEED="${SEED:-42}"
MODEL_NAME="${MODEL_NAME:-Qwen/Qwen2.5-1.5B-Instruct}"
GPU="${GPU:-A100}"
EPOCHS="${EPOCHS:-3}"
LR="${LR:-0.00015}"
LORA_R="${LORA_R:-64}"
LORA_ALPHA="${LORA_ALPHA:-128}"
HUB_REPO_ID="${HUB_REPO_ID:-eternal/qwen2.5-1.5b-intent-game-designer}"
SKIP_TRAIN="${SKIP_TRAIN:-0}"
SKIP_DEPLOY="${SKIP_DEPLOY:-0}"
SKIP_DATASET="${SKIP_DATASET:-0}"

cd "$PROJECT_ROOT"

echo "============================================================"
echo "[Eternal Launch] Project Eternal fine-tune launch"
echo "============================================================"
echo "MODEL             = $MODEL_NAME"
echo "DATA_DIR          = $DATA_DIR"
echo "FROZEN_LIBRARY    = $FROZEN_LIBRARY"
echo "TARGET_SAMPLES    = $TARGET_SAMPLES"
echo "SEED              = $SEED"
echo "GPU               = $GPU"
echo "EPOCHS            = $EPOCHS"
echo "LR                = $LR"
echo "LORA_R            = $LORA_R"
echo "LORA_ALPHA        = $LORA_ALPHA"
echo "HUB_REPO_ID       = $HUB_REPO_ID"
echo "============================================================"

# ---- Step 0: freeze the genome library (if not present) ----
mkdir -p "$(dirname "$FROZEN_LIBRARY")"
if [[ ! -f "$FROZEN_LIBRARY" && -f champions/library.json ]]; then
  echo "[Eternal Launch] Freezing live library into $FROZEN_LIBRARY"
  bun run scripts/freeze-genomes.ts \
    --in champions/library.json \
    --out "$(dirname "$FROZEN_LIBRARY")" \
    --version v1 \
    --notes "frozen from live evolution run $(date -u +%Y-%m-%d)"
fi

# ---- Step 1: build the dataset (if needed) ----
if [[ "$SKIP_DATASET" != "1" && ( ! -f "$DATA_DIR/train.jsonl" || ! -f "$DATA_DIR/validation.jsonl" || ! -f "$DATA_DIR/test.jsonl" ) ]]; then
  echo "[Eternal Launch] Dataset not found. Building..."
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
else
  echo "[Eternal Launch] Dataset already present (or SKIP_DATASET=1): $DATA_DIR"
fi

# ---- Step 2: upload the dataset to the Modal volume ----
echo "[Eternal Launch] Uploading dataset to Modal volume..."
modal volume put eternal-data "$DATA_DIR" "/intent_dataset" || true

# ---- Step 3: train ----
if [[ "$SKIP_TRAIN" != "1" ]]; then
  echo "[Eternal Launch] Training on Modal ($GPU)..."
  HUB_ARGS=""
  if [[ -n "$HUB_REPO_ID" ]]; then
    HUB_ARGS="--push-to-hub --hub-repo-id $HUB_REPO_ID"
  fi

  modal run modal/modal_train.py \
    --model-name "$MODEL_NAME" \
    --train-path "/data/intent_dataset/train.jsonl" \
    --validation-path "/data/intent_dataset/validation.jsonl" \
    --test-path "/data/intent_dataset/test.jsonl" \
    --output-dir "/data/checkpoints/eternal-game-designer" \
    --target-epochs "$EPOCHS" \
    --learning-rate "$LR" \
    --lora-r "$LORA_R" \
    --lora-alpha "$LORA_ALPHA" \
    --gpu "$GPU" \
    --seed "$SEED" \
    $HUB_ARGS
fi

# ---- Step 4: deploy inference endpoint ----
if [[ "$SKIP_DEPLOY" != "1" ]]; then
  echo "[Eternal Launch] Deploying inference endpoint..."
  modal deploy modal/modal_inference.py
fi

# ---- Step 5: smoke test ----
echo "[Eternal Launch] Smoke testing endpoint..."
ENDPOINT_URL=$(modal app list --json 2>/dev/null | jq -r '.[] | select(.name=="eternal-inference") | .web_endpoints[0].url' 2>/dev/null || echo "")
if [[ -n "$ENDPOINT_URL" ]]; then
  curl -X POST "$ENDPOINT_URL" \
    -H "Content-Type: application/json" \
    -d '{
      "context": {
        "topline": {
          "recentWinStreak": 3,
          "currentMood": "overconfident",
          "biggestWeakness": "panicRoll",
          "recommendedPosture": "punish"
        },
        "emotionalCurve": {"currentEmotion": "confidence", "trajectory": "rising"},
        "currentChapter": {"chapterIndex": 4, "emotion": "tension"},
        "worldState": {"corruption": 0.45, "hopeLevel": 0.4}
      }
    }'
  echo
else
  echo "[Eternal Launch] No endpoint URL found (deployment may have failed)"
fi

echo "============================================================"
echo "[Eternal Launch] Done"
echo "============================================================"
echo "Next steps:"
echo "  1. Set ETERNAL_MODEL_ENDPOINT to the deployed URL"
echo "  2. Run: bun run eternal:eval --endpoint \$ETERNAL_MODEL_ENDPOINT"
echo "  3. Or for local: ETERNAL_MODEL_PATH=./data/exports/eternal-game-designer/merged bun run dev"
echo "============================================================"
