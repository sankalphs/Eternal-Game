# Deployment Guide — Qwen 1.5B Game Designer

This is the canonical deployment guide for the fine-tuned Qwen 1.5B
Game Designer. It covers all three deployment paths:

1. **Modal endpoint** (recommended for production)
2. **Docker container** (recommended for self-hosted production)
3. **Local Node.js runtime** (recommended for dev/offline)

The model is the same in all three paths: a Qwen 2.5 1.5B fine-tuned
with QLoRA on the Project Eternal intent dataset.

## Prerequisites

- A fine-tuned model checkpoint. Either:
  - Pushed to HuggingFace Hub by the Modal training run, OR
  - Downloaded locally: `huggingface-cli download your-org/eternal-game-designer-v1`
- (Modal path only) `modal token new` + secrets for `huggingface` and `wandb`
- (Docker path only) Docker 24+ with NVIDIA Container Toolkit (for GPU)

## What the model does

Given a `GameDesignContext` (player profile, prediction, campaign,
world, genome library, narrative, emotional curve, boss memory,
difficulty, arena), the model produces a **5-field IntentOutput**:

```json
{
  "intent": "Break the overconfidence built from three straight wins",
  "reasoning": "Three wins, overconfident mood, aggression profile...",
  "expectedPlayerReaction": "Player starts spacing and observing",
  "highLevelPlan": "A patient counter encounter that punishes dash-ins",
  "confidence": 0.91
}
```

The deterministic Director (`DirectorEngineV5` + `IntentTranslator`)
translates this intent into the final `DirectorPlanV3` (weather,
camera, hazards, boss style, difficulty, dialogue, cinematics). The soundtrack is fixed.
The LLM is never allowed to output those values directly.

## Path 1: Modal endpoint (production)

```bash
# 1. Build the dataset (if not done already)
bun run eternal:dataset --out ./data/intent_dataset \
  --frozen ./data/genome_libraries/GenomeLibrary_v1.json \
  --target 100000

# 2. Train + push to Hub (set HUB_REPO_ID to your repo)
HUB_REPO_ID=YourOrg/eternal-game-designer-v1 \
  bash modal/launch_modal.sh

# 3. The endpoint is deployed automatically. Copy the URL.

# 4. In the game, set:
export ETERNAL_MODEL_ENDPOINT=https://your-endpoint.modal.run
export ETERNAL_MODEL_FAMILY=qwen
export ETERNAL_MODEL_VERSION=1.0.0
```

The `AdapterFactory` picks up `ETERNAL_MODEL_ENDPOINT` and instantiates
a `FineTunedAdapter` that POSTs to the endpoint. The Director V5
translates the intent response into gameplay.

### Health check

```bash
curl -X POST "$ETERNAL_MODEL_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"context": {"topline": {"currentMood": "overconfident"}, "playerEstimate": {"skill": 0.5}}}'
```

You should get back an `IntentOutput` JSON in <500ms.

### Cold starts

Modal's default container idle timeout is 5 minutes. The first
request after a long idle may take 10-30s while the model loads.
Subsequent requests are fast.

To avoid cold starts in production, edit `modal/modal_inference.py`
and set `container_idle_timeout=3600` (1 hour).

## Path 2: Docker container (self-hosted)

```bash
# 1. Export the merged model
python modal/eval/export_hf.py \
  --adapter-dir ./data/checkpoints/eternal-game-designer/final \
  --base-model Qwen/Qwen2.5-1.5B-Instruct \
  --output-dir ./data/exports/eternal-game-designer/merged

# 2. Build the image
docker build -t eternal-game-designer:qwen-1.5b -f modal/Dockerfile .

# 3. Run with GPU
docker run -d --name eternal-gd \
  --gpus all \
  -p 8000:8000 \
  -v /path/to/merged:/data/exports/eternal-game-designer/merged:ro \
  -e MODEL_VERSION=1.0.0 \
  -e MODEL_FAMILY=qwen \
  eternal-game-designer:qwen-1.5b

# 4. Or run CPU-only (much slower, ~5s per request)
docker run -d --name eternal-gd-cpu \
  -p 8000:8000 \
  -v /path/to/merged:/data/exports/eternal-game-designer/merged:ro \
  eternal-game-designer:qwen-1.5b

# 5. In the game, point to localhost:
export ETERNAL_MODEL_ENDPOINT=http://localhost:8000/generate
```

### Health check

```bash
curl http://localhost:8000/health
# {"status":"ok","model_loaded":true,"model_version":"1.0.0","model_family":"qwen"}
```

### Resource requirements

| GPU | VRAM | Latency | Throughput |
|---|---|---|---|
| T4 | 16GB | ~300ms | 3 req/s |
| A10G | 24GB | ~150ms | 7 req/s |
| A100 | 40GB | ~80ms | 12 req/s |
| H100 | 80GB | ~50ms | 20 req/s |

CPU-only (PyTorch): ~5s per request, single-threaded.

## Path 3: Local Node.js runtime (dev / offline)

The `FineTunedAdapter` supports three local runtimes:
- `transformers_js` (Node, uses `@huggingface/transformers`)
- `transformers_py` (Node, spawns a Python subprocess)
- `onnx` (not yet implemented)

```bash
# 1. Install @huggingface/transformers
bun add @huggingface/transformers

# 2. Export the merged model (see above)

# 3. Configure
export ETERNAL_MODEL_PATH=./data/exports/eternal-game-designer/merged
export ETERNAL_MODEL_RUNTIME=transformers_js
export ETERNAL_MODEL_FAMILY=qwen
export ETERNAL_MODEL_VERSION=1.0.0

# 4. Run the game
bun run dev
```

The model is loaded lazily on the first inference call. The first
load takes 5-10 seconds; subsequent calls are fast.

## Verifying the deployment

After deploying, run the evaluation:

```bash
# Against Modal endpoint
bun run scripts/run-evaluation.ts --endpoint $ETERNAL_MODEL_ENDPOINT

# Against local Docker
bun run scripts/run-evaluation.ts --endpoint http://localhost:8000/generate

# Against a local model
bun run scripts/run-evaluation.ts --local-model $ETERNAL_MODEL_PATH
```

You should see all 6 metrics improve over the V3 baseline with
statistical significance (p < 0.05). See `docs/EVALUATION.md` for
how to interpret the results.

## Switching models

To deploy a different model size (Gemma 1B, Gemma 4B, Phi, etc.),
just retrain with a different `--model-name`. The adapter, the
endpoint, and the deployment pipeline are all model-agnostic.

```bash
# Gemma 1B
modal run modal/modal_train.py --model-name google/gemma-3-1b-it

# Phi-3 mini
modal run modal/modal_train.py --model-name microsoft/Phi-3-mini-4k-instruct

# Larger model — needs A100 or H100
modal run modal/modal_train.py --model-name meta-llama/Llama-3-8B-Instruct --gpu A100
```

## Fallback chain

The `AdapterFactory` tries the following in order:
1. `ETERNAL_MODEL_ENDPOINT` → FineTunedAdapter (HTTP)
2. `ETERNAL_MODEL_PATH` → FineTunedAdapter (local)
3. `ETERNAL_REMOTE_API_URL` → RemoteAPIAdapter (legacy)
4. `ETERNAL_USE_OLLAMA=1` → OllamaAdapter (legacy)
5. (default) MockAdapter (deterministic baseline)

If the fine-tuned adapter fails (e.g., the endpoint is down), the
Director V5 falls back to the deterministic V3 baseline. The
deterministic Director is always the source of truth.

## Monitoring

The Modal dashboard shows request count, latency, and error rate.
For Docker / local, the FastAPI server logs to stdout. The
`/health` endpoint reports model status.

For production observability, integrate with Datadog/Sentry by
adding middleware to `inference_server.py`.

## Rolling back

To roll back to a previous model version:

```bash
# Revert the endpoint to an older checkpoint
export ETERNAL_MODEL_DIR=/data/checkpoints/eternal-game-designer-v0
# Redeploy
modal deploy modal/modal_inference.py

# Or use the V3 Director only
unset ETERNAL_MODEL_ENDPOINT
unset ETERNAL_MODEL_PATH
# The game will use the V3 Director's deterministic plan.
```
