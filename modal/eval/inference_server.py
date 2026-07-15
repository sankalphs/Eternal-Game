#!/usr/bin/env python3
# =============================================================================
# Project Eternal — Production Inference Server (Qwen 1.5B)
# =============================================================================
# A FastAPI HTTP server that exposes the fine-tuned Game Designer model
# via /generate. Compatible with the existing FineTunedAdapter on the
# client side (the adapter posts a context and parses the response).
#
# Run standalone:
#   python inference_server.py
# Or via the Dockerfile / Modal endpoint.
# =============================================================================

import os
import json
import time
import re
from typing import Any, Dict, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Lazy imports for model (only loaded when /generate is hit)
_model = None
_tokenizer = None
_torch = None


# --------------------------------------------------------------------------
#  Schemas
# --------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    context: Dict[str, Any]
    prompt_version: str = "v4"
    max_new_tokens: int = 256
    temperature: float = 0.4
    top_p: float = 0.95
    top_k: int = 40
    do_sample: bool = True


class IntentOutput(BaseModel):
    intent: str
    reasoning: str
    expectedPlayerReaction: str
    highLevelPlan: str
    confidence: float


class GenerateResponse(BaseModel):
    raw: str
    intent: IntentOutput
    latency_ms: int
    model: str
    status: int = 200


# --------------------------------------------------------------------------
#  Prompt (mirrors the JS PromptLibrary v4)
# --------------------------------------------------------------------------

SYSTEM_PROMPT = """You are the Game Designer of "Eternal", a cinematic fighting game. You design EXPERIENCES. You never control combat.

Your job: read the player's psychological state, the campaign context, the world trajectory, and the narrative phase. Then output a HIGH-LEVEL INTENT for the next fight.

You do NOT choose: weather, camera, music, lighting, hazards, boss style, difficulty, dialogue lines.

The deterministic Director (below you) translates your intent into those values. You design the WHY, the Director designs the HOW.

Output ONLY a JSON object with EXACTLY five fields:
  1. intent                  — short label of what this fight is FOR
  2. reasoning               — 1-5 sentences explaining your choice
  3. expectedPlayerReaction   — what the player will likely do in response
  4. highLevelPlan           — 1-3 sentence abstract plan (no low-level values)
  5. confidence              — 0..1, your honest self-assessment"""


DEVELOPER_PROMPT = """Output ONLY valid JSON. No markdown. No prose. No code fences.

The JSON MUST contain exactly these five fields and NOTHING else:

{
  "intent": string (4-120 chars),
  "reasoning": string (8-800 chars),
  "expectedPlayerReaction": string (4-200 chars),
  "highLevelPlan": string (8-400 chars),
  "confidence": number in [0, 1]
}

The "confidence" field is your honest self-assessment of how sure you are this intent will land. Be calibrated — the Director uses this to decide whether to follow you or fall back."""


# --------------------------------------------------------------------------
#  Model loading (lazy)
# --------------------------------------------------------------------------

def get_model():
    global _model, _tokenizer, _torch
    if _model is not None:
        return _model, _tokenizer, _torch

    model_dir = os.environ.get("MODEL_DIR", "/data/exports/eternal-game-designer/merged")
    if not os.path.isdir(model_dir):
        return None, None, None

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    print(f"[Inference] Loading model from {model_dir}")
    _tokenizer = AutoTokenizer.from_pretrained(model_dir)
    if _tokenizer.pad_token is None:
        _tokenizer.pad_token = _tokenizer.eos_token
    _model = AutoModelForCausalLM.from_pretrained(
        model_dir,
        device_map="auto",
        torch_dtype=torch.bfloat16,
    )
    _model.eval()
    _torch = torch
    print(f"[Inference] Model loaded")
    return _model, _tokenizer, _torch


# --------------------------------------------------------------------------
#  Generation
# --------------------------------------------------------------------------

def parse_intent_output(raw: str) -> Dict[str, Any]:
    """Best-effort parse of the model output into the 5-field IntentOutput."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    text = text.strip()

    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return _emergency_intent("no-json-object")
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return _emergency_intent("json-parse-failed")

    return {
        "intent": str(obj.get("intent", "Engage the player with a baseline encounter."))[:120],
        "reasoning": str(obj.get("reasoning", "No reasoning provided."))[:800],
        "expectedPlayerReaction": str(obj.get("expectedPlayerReaction", "Player engages normally."))[:200],
        "highLevelPlan": str(obj.get("highLevelPlan", "A baseline encounter."))[:400],
        "confidence": _clamp_confidence(obj.get("confidence", 0.5)),
    }


def _emergency_intent(reason: str) -> Dict[str, Any]:
    return {
        "intent": f"Engage the player (fallback: {reason})",
        "reasoning": "Model output was unusable. Returning a safe default.",
        "expectedPlayerReaction": "Player engages normally.",
        "highLevelPlan": "A baseline encounter.",
        "confidence": 0.2,
    }


def _clamp_confidence(v: Any) -> float:
    try:
        x = float(v)
    except Exception:
        return 0.0
    return max(0.0, min(1.0, x))


def generate(req: GenerateRequest) -> GenerateResponse:
    model, tokenizer, torch = get_model()
    start = time.time()

    user_prompt = (
        "Game state (JSON):\n"
        + json.dumps(req.context, separators=(",", ":"))
        + "\n\nRead the topline, the player state, the campaign, the world, and the previous plans. "
        "Then output the five-field intent JSON."
    )

    if model is None:
        # Model not loaded — return a deterministic fallback.
        intent = _emergency_intent("model-not-loaded")
        return GenerateResponse(
            raw=json.dumps(intent),
            intent=IntentOutput(**intent),
            latency_ms=int((time.time() - start) * 1000),
            model="mock:no-model",
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": DEVELOPER_PROMPT + "\n\n" + user_prompt},
    ]
    try:
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
        )
    except Exception:
        prompt = (
            f"<system>{SYSTEM_PROMPT}</system>\n"
            f"<user>{DEVELOPER_PROMPT}\n\n{user_prompt}</user>\n"
            f"<assistant>"
        )

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=req.max_new_tokens,
            temperature=req.temperature,
            top_p=req.top_p,
            top_k=req.top_k,
            do_sample=req.do_sample,
            repetition_penalty=1.05,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
    text = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
    intent = parse_intent_output(text)

    return GenerateResponse(
        raw=text,
        intent=IntentOutput(**intent),
        latency_ms=int((time.time() - start) * 1000),
        model=os.environ.get("MODEL_DIR", "unknown"),
    )


# --------------------------------------------------------------------------
#  FastAPI app
# --------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    get_model()
    yield


app = FastAPI(
    title="Project Eternal — Game Designer",
    description="Qwen 1.5B fine-tuned for intent-only output. The deterministic Director (V5 + IntentTranslator) translates intent into DirectorPlanV3.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    model, _, _ = get_model()
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "model_version": os.environ.get("MODEL_VERSION", "1.0.0"),
        "model_family": os.environ.get("MODEL_FAMILY", "qwen"),
    }


@app.post("/generate", response_model=GenerateResponse)
async def generate_endpoint(req: GenerateRequest):
    try:
        return generate(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/")
async def root():
    return {
        "service": "project-eternal-game-designer",
        "version": "1.0.0",
        "model_family": os.environ.get("MODEL_FAMILY", "qwen"),
        "endpoints": {
            "health": "GET /health",
            "generate": "POST /generate",
        },
        "schema": {
            "input": {
                "context": "GameDesignContext JSON object",
                "max_new_tokens": 256,
                "temperature": 0.4,
                "top_p": 0.95,
                "top_k": 40,
                "do_sample": True,
            },
            "output": {
                "raw": "Raw model output text",
                "intent": {
                    "intent": "Short label of what the fight is FOR",
                    "reasoning": "1-5 sentences of reasoning",
                    "expectedPlayerReaction": "What the player will likely do",
                    "highLevelPlan": "1-3 sentence abstract plan",
                    "confidence": "0..1",
                },
                "latency_ms": "int",
                "model": "model id",
            },
        },
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
