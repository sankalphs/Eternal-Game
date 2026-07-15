# DEPLOYMENT — How to deploy the fine-tuned model

## Overview

The fine-tuned Game Designer is deployed in two ways:

1. **Modal endpoint** (recommended for production). The model runs
   on Modal's GPU infrastructure and is accessed via HTTPS.
2. **Local model** (for offline / dev). The model is loaded into
   the game process via `transformers.js` or a Python subprocess.

In both cases, the game's code does NOT change. The
`AdapterFactory` picks the right adapter based on environment
variables.

## Option 1: Modal endpoint (production)

### Deploy

```bash
modal deploy modal/modal_inference.py
```

The endpoint URL is printed to stdout. Copy it.

### Configure the game

```bash
export ETERNAL_MODEL_ENDPOINT=https://your-endpoint.modal.run
export ETERNAL_MODEL_VERSION=1.0.0
export ETERNAL_MODEL_FAMILY=gemma3
```

### Verify

The game will use the endpoint automatically. To verify:

```bash
curl -X POST "$ETERNAL_MODEL_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "topline": {"currentMood": "overconfident"},
      "playerEstimate": {"skill": 0.5}
    }
  }'
```

The response should be:

```json
{
  "raw": "...",
  "intent": {
    "intent": "Break the overconfidence",
    "reasoning": "...",
    "expectedPlayerReaction": "...",
    "highLevelPlan": "...",
    "confidence": 0.85
  },
  "latency_ms": 234,
  "status": 200
}
```

### Cold starts

Modal's container has a 5-minute idle timeout. The first request
after a long idle period may take 10-30 seconds while the model
loads. Subsequent requests are fast (~200-500ms).

To avoid cold starts in production, set
`container_idle_timeout=3600` (1 hour) in `modal_inference.py`.

## Option 2: Local model (offline / dev)

### Export the merged model

```bash
python modal/eval/export_hf.py \
  --adapter-dir ./data/checkpoints/eternal-game-designer/final \
  --base-model google/gemma-3-270m-it \
  --output-dir ./data/exports/eternal-game-designer/merged
```

### Install dependencies

```bash
bun add @huggingface/transformers
```

### Configure the game

```bash
export ETERNAL_MODEL_PATH=./data/exports/eternal-game-designer/merged
export ETERNAL_MODEL_RUNTIME=transformers_js
```

### Run

The model is loaded lazily on the first inference call. The first
load takes 5-10 seconds; subsequent calls are fast.

## Fallback chain

The `AdapterFactory` tries the following in order:

1. `ETERNAL_MODEL_ENDPOINT` → FineTunedAdapter (HTTP)
2. `ETERNAL_MODEL_PATH` → FineTunedAdapter (local)
3. `ETERNAL_REMOTE_API_URL` → RemoteAPIAdapter (legacy)
4. `ETERNAL_USE_OLLAMA=1` → OllamaAdapter (legacy)
5. (default) MockAdapter

If the fine-tuned adapter fails (e.g., the Modal endpoint is down),
the factory does NOT automatically fall back. The game handles the
failure by using the V3 Director's plan as the fallback. This is
intentional: the deterministic Director is always the source of
truth.

## Versioning the deployed model

Every deployed model has a `modelVersion` string (e.g. "1.0.0").
The version is included in the metadata returned by the endpoint
and the adapter. To roll back to a previous version, redeploy:

```bash
# Pin the model directory
export ETERNAL_MODEL_DIR=/data/checkpoints/eternal-game-designer-v0
modal deploy modal/modal_inference.py
```

## Monitoring

The Modal dashboard shows request count, latency, and error rate.
For local inference, log via `console.log` in the adapter. The
adapter emits the following events:

- `[FineTunedAdapter] probe failed: <error>` — endpoint unhealthy
- `[FineTunedAdapter:local] loading model from <path>` — local load
- Latency is included in every `InferenceResult`

For production, integrate with your existing observability stack
(Datadog, Sentry, etc.) by adding a thin wrapper around the
adapter.

## Rolling back

To roll back to a previous version, you have two options:

1. **Revert the endpoint.** Redeploy with the old model directory.
2. **Use the V3 Director only.** Unset `ETERNAL_MODEL_ENDPOINT` and
   the game will fall back to the V3 Director. The V3 Director is
   always available.

## Health checks

```bash
# Modal endpoint
curl -X POST "$ETERNAL_MODEL_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"health": true}'

# Local model
ls -la "$ETERNAL_MODEL_PATH"
```

If the endpoint is down or the local model is missing, the game
gracefully falls back to the V3 Director.
