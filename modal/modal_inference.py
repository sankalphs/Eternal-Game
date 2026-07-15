#!/usr/bin/env python3
# =============================================================================
# Project Eternal — Modal Inference Script
# =============================================================================
# Deploys the fine-tuned Game Designer model as a Modal web endpoint.
# The endpoint accepts the same GameDesignContext that the existing
# AI infrastructure produces and returns an IntentOutput.
#
# The Director (DirectorEngineV5) consumes the IntentOutput via its
# IntentTranslator and produces the final DirectorPlanV3.
#
# Usage:
#   modal deploy modal_inference.py
#   curl -X POST https://<endpoint>/generate -d '{"context": {...}}'
# =============================================================================

import os
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import modal

# ----------------------------------------------------------------------------
#  Modal app
# ----------------------------------------------------------------------------

app = modal.App("eternal-inference")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements(str(Path(__file__).with_name("requirements.txt")))
)

volume = modal.Volume.from_name("eternal-data", create_if_missing=True)


# ----------------------------------------------------------------------------
#  Model class
# ----------------------------------------------------------------------------

class IntentModel:
    """Wrapper around the fine-tuned model. Lazy-loads on first call."""

    def __init__(self, model_dir: str, base_model_name: Optional[str] = None,
                 merged: bool = True, torch_dtype: str = "bfloat16"):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.model_dir = model_dir
        self.merged = merged
        self.torch_dtype = getattr(torch, torch_dtype)

        print(f"[Eternal Inference] Loading from {model_dir} (merged={merged})")
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.model = AutoModelForCausalLM.from_pretrained(
            model_dir,
            device_map="auto",
            torch_dtype=self.torch_dtype,
        )
        self.model.eval()
        print(f"[Eternal Inference] Model loaded")

    def generate(self, messages: List[Dict[str, str]], max_new_tokens: int = 256,
                 temperature: float = 0.4, top_p: float = 0.95, top_k: int = 40,
                 do_sample: bool = True) -> str:
        import torch
        try:
            prompt = self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
            )
        except Exception:
            prompt = (
                f"<system>{messages[0]['content']}</system>\n"
                f"<user>{messages[1]['content']}</user>\n"
                f"<assistant>"
            )
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                top_p=top_p,
                top_k=top_k,
                do_sample=do_sample,
                repetition_penalty=1.05,
                pad_token_id=self.tokenizer.pad_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
            )
        new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
        text = self.tokenizer.decode(new_tokens, skip_special_tokens=True)
        return text.strip()


# ----------------------------------------------------------------------------
#  Inference function
# ----------------------------------------------------------------------------

@app.function(
    image=image,
    gpu="A10G",  # Override via deployment config
    cpu=4.0,
    memory=16384,
    timeout=600,
    volumes={"/data": volume},
    secrets=[],
    scaledown_window=300,  # 5 min idle before shutdown
)
@modal.fastapi_endpoint(method="POST", label="eternal-game-designer")
def generate(request: Dict[str, Any]) -> Dict[str, Any]:
    """HTTP endpoint for the fine-tuned Game Designer model."""
    start = time.time()

    # Lazy-load the model on first call
    global _model
    if "_model" not in globals():
        model_dir = os.environ.get("ETERNAL_MODEL_DIR", "/data/checkpoints/eternal-game-designer-10k/merged")
        _model = IntentModel(model_dir)

    # Parse request
    context = request.get("context")
    if not context:
        return {"error": "missing 'context' field", "status": 400}

    # Build the prompt (same format as the JS PromptLibrary v4)
    from_prompt = request.get("prompt_version", "v4")
    messages = build_prompt_messages(context, from_prompt)

    # Generate
    try:
        raw = _model.generate(
            messages,
            max_new_tokens=int(request.get("max_new_tokens", 256)),
            temperature=float(request.get("temperature", 0.4)),
            top_p=float(request.get("top_p", 0.95)),
            top_k=int(request.get("top_k", 40)),
            do_sample=bool(request.get("do_sample", True)),
        )
    except Exception as e:
        return {"error": str(e), "status": 500}

    # Parse the output
    parsed = parse_intent_output(raw)

    return {
        "raw": raw,
        "intent": parsed,
        "latency_ms": int((time.time() - start) * 1000),
        "model": os.environ.get("ETERNAL_MODEL_DIR", "unknown"),
        "status": 200,
    }


# ----------------------------------------------------------------------------
#  Prompt builder (mirrors the JS PromptLibrary v4)
# ----------------------------------------------------------------------------

def build_prompt_messages(context: Dict[str, Any], version: str) -> List[Dict[str, str]]:
    system_prompt = (
        'You are the Game Designer of "Eternal", a cinematic shadow fighting game. '
        "You design EXPERIENCES. You never control combat.\n\n"
        "Your job: read the player's psychological state, the campaign context, the world "
        "trajectory, and the narrative phase. Then output a HIGH-LEVEL INTENT for the next fight.\n\n"
        "You do NOT choose: weather, camera, music, lighting, hazards, boss style, difficulty, dialogue lines.\n\n"
        "The deterministic Director (below you) translates your intent into those values. "
        "You design the WHY, the Director designs the HOW.\n\n"
        "Output ONLY a JSON object with EXACTLY five fields:\n"
        "  1. intent                  — short label of what this fight is FOR\n"
        "  2. reasoning               — 1-5 sentences explaining your choice\n"
        "  3. expectedPlayerReaction   — what the player will likely do in response\n"
        "  4. highLevelPlan           — 1-3 sentence abstract plan (no low-level values)\n"
        "  5. confidence              — 0..1, your honest self-assessment"
    )

    developer_prompt = (
        "Output ONLY valid JSON. No markdown. No prose. No code fences.\n\n"
        "The JSON MUST contain exactly these five fields and NOTHING else:\n"
        "{\n"
        '  "intent": string (4-120 chars),\n'
        '  "reasoning": string (8-800 chars),\n'
        '  "expectedPlayerReaction": string (4-200 chars),\n'
        '  "highLevelPlan": string (8-400 chars),\n'
        '  "confidence": number in [0, 1]\n'
        "}"
    )

    user_prompt = (
        "Game state (JSON):\n"
        + json.dumps(context, separators=(",", ":"))
        + "\n\nRead the topline, the player state, the campaign, the world, and the previous plans. "
        "Then output the five-field intent JSON."
    )

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": developer_prompt + "\n\n" + user_prompt},
    ]


# ----------------------------------------------------------------------------
#  Output parser
# ----------------------------------------------------------------------------

def parse_intent_output(raw: str) -> Dict[str, Any]:
    """Parse the raw model output into a structured IntentOutput. Best-effort."""
    text = raw.strip()
    # Strip code fences
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    text = text.strip()

    # Find first JSON object
    import re as _re
    m = _re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {
            "intent": "Engage the player with a baseline encounter.",
            "reasoning": "Model output was unparseable.",
            "expectedPlayerReaction": "Player engages normally.",
            "highLevelPlan": "A baseline encounter.",
            "confidence": 0.0,
        }
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return {
            "intent": "Engage the player with a baseline encounter.",
            "reasoning": "Model output was unparseable JSON.",
            "expectedPlayerReaction": "Player engages normally.",
            "highLevelPlan": "A baseline encounter.",
            "confidence": 0.0,
        }

    # Validate / clean
    return {
        "intent": str(obj.get("intent", "Engage the player with a baseline encounter."))[:120],
        "reasoning": str(obj.get("reasoning", "No reasoning provided."))[:800],
        "expectedPlayerReaction": str(obj.get("expectedPlayerReaction", "Player engages normally."))[:200],
        "highLevelPlan": str(obj.get("highLevelPlan", "A baseline encounter."))[:400],
        "confidence": float(obj.get("confidence", 0.5)),
    }


# ----------------------------------------------------------------------------
#  Local CLI mode
# ----------------------------------------------------------------------------

@app.function(
    image=image,
    gpu="A10G",
    cpu=4.0,
    memory=16384,
    timeout=600,
    volumes={"/data": volume},
    secrets=[],
    scaledown_window=300,
)
def _run_local_test(context: Dict[str, Any], model_dir: str) -> Dict[str, Any]:
    """Run inference on Modal GPU (used by the local entrypoint for testing)."""
    model = IntentModel(model_dir)
    messages = build_prompt_messages(context, "v4")
    raw = model.generate(messages, max_new_tokens=200)
    parsed = parse_intent_output(raw)
    return {"raw": raw, "parsed": parsed}


@app.local_entrypoint()
def main(context_path: str = "", model_dir: str = "/data/checkpoints/eternal-game-designer-10k/merged"):
    """Test the model on Modal GPU (without deploying the web endpoint)."""
    if context_path and os.path.exists(context_path):
        with open(context_path, "r") as f:
            context = json.load(f)
    else:
        # Default test context
        context = {
            "topline": {
                "recentWinStreak": 3,
                "currentMood": "overconfident",
                "biggestWeakness": "panicRoll",
                "recommendedPosture": "punish",
            },
            "emotionalCurve": {"currentEmotion": "confidence", "trajectory": "rising"},
            "currentChapter": {"chapterIndex": 4, "emotion": "tension"},
            "worldState": {"corruption": 0.45, "hopeLevel": 0.4},
        }

    result = _run_local_test.remote(context, model_dir)
    print("=" * 60)
    print("[Eternal Inference] Raw output:")
    print(result["raw"])
    print("=" * 60)
    print("[Eternal Inference] Parsed:")
    print(json.dumps(result["parsed"], indent=2))


if __name__ == "__main__":
    import re
    main()
