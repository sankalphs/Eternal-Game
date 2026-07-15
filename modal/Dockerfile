# =============================================================================
# Project Eternal — Qwen 1.5B Game Designer
# =============================================================================
# Production deployment of the fine-tuned Game Designer.
#
# This Dockerfile builds a minimal image that:
#   1. Loads the Qwen 1.5B fine-tuned model from /data/exports/eternal-game-designer/merged
#   2. Exposes a /generate HTTP endpoint that accepts a GameDesignContext
#      and returns an IntentOutput.
#   3. Falls back to a deterministic mock if the model is missing.
#
# Build:   docker build -t eternal-game-designer:qwen-1.5b -f modal/Dockerfile .
# Run:     docker run -p 8000:8000 -v /path/to/merged:/data/exports/eternal-game-designer/merged:ro eternal-game-designer:qwen-1.5b
# Test:    curl -X POST localhost:8000/generate -H "Content-Type: application/json" -d @sample.json
# =============================================================================

FROM python:3.11-slim

WORKDIR /app

# Install PyTorch CPU for the minimal inference path.
# For GPU inference, override the base image (e.g. pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime).
RUN pip install --no-cache-dir \
    torch==2.4.0+cpu \
    --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir \
    transformers==4.44.2 \
    safetensors==0.4.4 \
    accelerate==0.34.2 \
    tokenizers==0.19.1 \
    fastapi==0.115.0 \
    uvicorn==0.30.6 \
    pydantic==2.8.2 \
    pyyaml==6.0.1

COPY modal/eval/inference_server.py /app/inference_server.py
COPY modal/configs /app/configs

ENV MODEL_DIR=/data/exports/eternal-game-designer/merged \
    MODEL_VERSION=1.0.0 \
    MODEL_FAMILY=qwen \
    PORT=8000 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "inference_server:app", "--host", "0.0.0.0", "--port", "8000"]
