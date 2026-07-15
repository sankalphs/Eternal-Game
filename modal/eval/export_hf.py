#!/usr/bin/env python3
# =============================================================================
# Project Eternal — HuggingFace Export
# =============================================================================
# Exports a local model directory (with LoRA adapter) as a fully merged
# HuggingFace model. Optionally pushes to the Hub.
#
# Usage:
#   python export_hf.py --adapter-dir ./checkpoints/eternal/final \\
#                       --output-dir ./exports/eternal/merged \\
#                       --base-model google/gemma-3-270m-it \\
#                       [--push --hub-repo-id YourOrg/eternal-game-designer]
# =============================================================================

import os
import json
import argparse
from pathlib import Path
from typing import Optional


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export LoRA adapter as merged HF model")
    p.add_argument("--adapter-dir", required=True, help="Path to the LoRA adapter directory")
    p.add_argument("--base-model", required=True, help="Base model id (HF)")
    p.add_argument("--output-dir", required=True, help="Where to save the merged model")
    p.add_argument("--torch-dtype", default="bfloat16")
    p.add_argument("--push", action="store_true")
    p.add_argument("--hub-repo-id", default=None)
    p.add_argument("--hub-private", action="store_true")
    p.add_argument("--model-card", default=None, help="Path to a model card markdown file")
    return p.parse_args()


def main():
    args = parse_args()
    import torch
    from peft import AutoPeftModelForCausalLM
    from transformers import AutoTokenizer

    print(f"[Export] Loading adapter from {args.adapter_dir}")
    model = AutoPeftModelForCausalLM.from_pretrained(
        args.adapter_dir,
        device_map="auto",
        torch_dtype=getattr(torch, args.torch_dtype),
    )

    print("[Export] Merging LoRA into base model...")
    merged = model.merge_and_unload()

    print(f"[Export] Saving merged model to {args.output_dir}")
    os.makedirs(args.output_dir, exist_ok=True)
    merged.save_pretrained(args.output_dir, safe_serialization=True)

    tokenizer = AutoTokenizer.from_pretrained(args.adapter_dir)
    tokenizer.save_pretrained(args.output_dir)

    # Save model card
    if args.model_card and os.path.exists(args.model_card):
        with open(args.model_card, "r", encoding="utf-8") as f:
            card = f.read()
        with open(os.path.join(args.output_dir, "README.md"), "w", encoding="utf-8") as f:
            f.write(card)
    else:
        # Default card
        card = default_model_card(args)
        with open(os.path.join(args.output_dir, "README.md"), "w", encoding="utf-8") as f:
            f.write(card)

    # Save metadata
    meta = {
        "base_model": args.base_model,
        "adapter_dir": args.adapter_dir,
        "torch_dtype": args.torch_dtype,
        "exported_at": str(__import__("datetime").datetime.utcnow().isoformat()),
    }
    with open(os.path.join(args.output_dir, "export_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[Export] Done. Model saved to {args.output_dir}")

    # Push to HF Hub
    if args.push:
        if not args.hub_repo_id:
            print("[Export] ERROR: --push requires --hub-repo-id")
            return 1
        from huggingface_hub import HfApi
        print(f"[Export] Pushing to hub: {args.hub_repo_id}")
        api = HfApi()
        api.create_repo(
            repo_id=args.hub_repo_id,
            private=args.hub_private,
            exist_ok=True,
        )
        api.upload_folder(
            folder_path=args.output_dir,
            repo_id=args.hub_repo_id,
            commit_message="Export Project Eternal fine-tuned model",
        )
        print(f"[Export] Pushed: https://huggingface.co/{args.hub_repo_id}")

    return 0


def default_model_card(args) -> str:
    return f"""---
license: apache-2.0
tags:
- project-eternal
- game-design
- intent-only
- lora
- gemma
- qwen
- phi
- llama
- mistral
---

# Project Eternal — Game Designer (Intent-Only)

This is a fine-tuned model for **Project Eternal**, a cinematic shadow fighting game.

## What it does

Given the current game state (player profile, prediction, campaign, world, genome
library, narrative, emotional curve, boss memory, difficulty, arena), the model
outputs a **high-level intent** describing what the next fight should achieve.

The output is **always** a JSON object with these five fields:

```json
{{
  "intent": "<short label of what this fight is FOR>",
  "reasoning": "<1-5 sentences explaining the choice>",
  "expectedPlayerReaction": "<what the player will likely do>",
  "highLevelPlan": "<1-3 sentence abstract plan>",
  "confidence": <0..1>
}}
```

The model **never** outputs weather, camera, music, lighting, hazards, boss style,
difficulty, or dialogue. The deterministic Director (DirectorEngineV5 +
IntentTranslator) translates the intent into those values.

## Training

- **Base model:** {args.base_model}
- **Adapter source:** `{args.adapter_dir}`
- **Method:** QLoRA (4-bit loading + LoRA)
- **Output dtype:** {args.torch_dtype}

## Usage

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

model = AutoModelForCausalLM.from_pretrained("REPLACE_WITH_REPO_ID", device_map="auto")
tokenizer = AutoTokenizer.from_pretrained("REPLACE_WITH_REPO_ID")

messages = [
    {{"role": "system", "content": "..."}},
    {{"role": "user", "content": "..."}},
]
prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
out = model.generate(**inputs, max_new_tokens=256, temperature=0.4)
print(tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True))
```

## Limitations

- The model is fine-tuned for Project Eternal's specific domain.
- It is NOT a general-purpose chat model.
- It is intended to be used as a high-level game designer, not a gameplay engine.

## License

Apache 2.0
"""


if __name__ == "__main__":
    raise SystemExit(main())
