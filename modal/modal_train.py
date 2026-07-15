#!/usr/bin/env python3
# =============================================================================
# Project Eternal — Modal Training Script
# =============================================================================
# Fine-tunes a small LLM (Gemma 3 270M by default) on the intent dataset
# using QLoRA on Modal's GPU infrastructure.
#
# Usage:
#   modal run modal_train.py
#   modal run modal_train.py --target-epochs 5 --learning-rate 0.0003
#   modal run modal_train.py --resume-from /data/checkpoints/checkpoint-1500
#
# After training, the model is exported to:
#   - /data/checkpoints/eternal-{model_name}/final  (LoRA + tokenizer)
#   - /data/exports/eternal-{model_name}/merged     (merged model)
#   - HuggingFace Hub (if push_to_hub is enabled)
# =============================================================================

import os
import json
import argparse
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import modal

# ----------------------------------------------------------------------------
#  Modal app + image
# ----------------------------------------------------------------------------

app = modal.App("eternal-trainer")

# Default image — install all training deps
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements("requirements.txt")
    .add_local_file("configs/training_config.yaml", "/root/configs/training_config.yaml", copy=True)
    .add_local_file("configs/lora_config.yaml", "/root/configs/lora_config.yaml", copy=True)
    .env({"ETERNAL_BUILD_TAG": "v2-full-dataset"})
)

# Persistent volume for data + checkpoints
volume = modal.Volume.from_name("eternal-data", create_if_missing=True)

# ----------------------------------------------------------------------------
#  Argparse
# ----------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train Project Eternal Game Designer model")
    p.add_argument("--config", default="/root/configs/training_config.yaml")
    p.add_argument("--lora-config", default="/root/configs/lora_config.yaml")

    # Common overrides
    p.add_argument("--model-name", default=None, help="HF model id (overrides config)")
    p.add_argument("--train-path", default=None)
    p.add_argument("--validation-path", default=None)
    p.add_argument("--test-path", default=None)
    p.add_argument("--output-dir", default=None)
    p.add_argument("--target-epochs", type=int, default=None)
    p.add_argument("--per-device-batch-size", type=int, default=None)
    p.add_argument("--gradient-accumulation-steps", type=int, default=None)
    p.add_argument("--learning-rate", type=float, default=None)
    p.add_argument("--lora-r", type=int, default=None)
    p.add_argument("--lora-alpha", type=int, default=None)
    p.add_argument("--max-samples", type=int, default=None)
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--resume-from", default=None)
    p.add_argument("--gpu", default=None, help="Override Modal GPU (e.g. A100, H100, A10G)")
    p.add_argument("--push-to-hub", action="store_true")
    p.add_argument("--hub-repo-id", default=None)
    return p.parse_args()


# ----------------------------------------------------------------------------
#  Config loading + overrides
# ----------------------------------------------------------------------------

import yaml


def load_yaml(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def apply_overrides(cfg: Dict[str, Any], args: argparse.Namespace) -> Dict[str, Any]:
    """Apply CLI overrides onto the loaded config."""
    if args.model_name:
        cfg["model"]["name"] = args.model_name
    if args.train_path:
        cfg["dataset"]["train_path"] = args.train_path
    if args.validation_path:
        cfg["dataset"]["validation_path"] = args.validation_path
    if args.test_path:
        cfg["dataset"]["test_path"] = args.test_path
    if args.output_dir:
        cfg["training"]["output_dir"] = args.output_dir
    if args.target_epochs is not None:
        cfg["training"]["num_train_epochs"] = args.target_epochs
    if args.per_device_batch_size is not None:
        cfg["training"]["per_device_train_batch_size"] = args.per_device_batch_size
        cfg["training"]["per_device_eval_batch_size"] = args.per_device_batch_size
    if args.gradient_accumulation_steps is not None:
        cfg["training"]["gradient_accumulation_steps"] = args.gradient_accumulation_steps
    if args.learning_rate is not None:
        cfg["training"]["learning_rate"] = args.learning_rate
    if args.lora_r is not None:
        cfg["lora"]["r"] = args.lora_r
    if args.lora_alpha is not None:
        cfg["lora"]["alpha"] = args.lora_alpha
    if args.max_samples is not None:
        cfg["dataset"]["max_samples"] = args.max_samples
    if args.seed is not None:
        cfg["training"]["seed"] = args.seed
        cfg["dataset"]["seed"] = args.seed
    if args.resume_from:
        cfg["training"]["resume_from_checkpoint"] = args.resume_from
    if args.gpu:
        cfg["modal"]["gpu"] = args.gpu
    if args.push_to_hub:
        cfg["huggingface"]["push_to_hub"] = True
    if args.hub_repo_id:
        cfg["huggingface"]["hub_repo_id"] = args.hub_repo_id
    return cfg


# ----------------------------------------------------------------------------
#  Dataset loading
# ----------------------------------------------------------------------------

def load_jsonl(path: str, max_samples: Optional[int] = None) -> List[Dict[str, Any]]:
    samples = []
    # Use utf-8-sig to strip a leading BOM if present
    with open(path, "r", encoding="utf-8-sig") as f:
        for i, line in enumerate(f):
            if max_samples is not None and i >= max_samples:
                break
            line = line.strip()
            if not line:
                continue
            try:
                samples.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"[load_jsonl] Skipping malformed line {i+1} in {path}: {e}")
                continue
    return samples


def load_jsonl_multi(paths, max_samples: Optional[int] = None) -> List[Dict[str, Any]]:
    """Load multiple jsonl files and concatenate results."""
    all_samples = []
    for p in paths:
        all_samples.extend(load_jsonl(p, max_samples))
    return all_samples


def expand_train_paths(path: str) -> list:
    """If a path points to a directory or a glob, expand to all jsonl files inside.
    Otherwise, return [path].
    Supports comma-separated lists and glob patterns."""
    if not path:
        return []
    if "," in path:
        # Comma-separated list
        out = []
        for p in path.split(","):
            out.extend(expand_train_paths(p.strip()))
        return out
    if "*" in path or "?" in path:
        import glob as _glob
        matches = sorted(_glob.glob(path))
        if matches:
            return matches
    if os.path.isdir(path):
        files = sorted(
            os.path.join(path, f) for f in os.listdir(path) if f.endswith(".jsonl")
        )
        if files:
            return files
    return [path]
    return samples


# ----------------------------------------------------------------------------
#  Tokenization + chat formatting
# ----------------------------------------------------------------------------

def build_chat_messages(record: Dict[str, Any]) -> List[Dict[str, str]]:
    """Convert a training record into chat messages (system + user + assistant)."""
    user_text = record["input"]["userText"]
    system_text = record["input"]["systemText"]
    assistant_text = record["output"]["targetText"]

    return [
        {"role": "system", "content": system_text},
        {"role": "user", "content": user_text},
        {"role": "assistant", "content": assistant_text},
    ]


# ----------------------------------------------------------------------------
#  Training function (runs on Modal GPU)
# ----------------------------------------------------------------------------

@app.function(
    image=image,
    gpu="A10G",  # overridden at run time via config
    cpu=8.0,
    memory=32768,
    timeout=14400,
    volumes={"/data": volume},
    secrets=[],
)
def train(cfg: Dict[str, Any], lora_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Train the model. Runs on Modal GPU."""
    import torch
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        TrainingArguments,
        Trainer,
        DataCollatorForLanguageModeling,
        set_seed,
    )
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from datasets import Dataset
    from transformers import BitsAndBytesConfig

    print("=" * 60)
    print("[Eternal Trainer] Booting")
    print("=" * 60)
    print(f"[Eternal Trainer] Model: {cfg['model']['name']}")
    print(f"[Eternal Trainer] Family: {cfg['model']['family']}")

    # 2. Set seeds
    set_seed(cfg["training"]["seed"])

    # 3. Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(
        cfg["model"]["name"],
        revision=cfg["model"].get("revision"),
        trust_remote_code=cfg["model"].get("trust_remote_code", False),
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # 4. Load model
    bnb_config = None
    if cfg["quantization"]["load_in_4bit"]:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=cfg["quantization"]["load_in_4bit"],
            bnb_4bit_quant_type=cfg["quantization"]["bnb_4bit_quant_type"],
            bnb_4bit_use_double_quant=cfg["quantization"]["bnb_4bit_use_double_quant"],
            bnb_4bit_compute_dtype=getattr(torch, cfg["quantization"]["bnb_4bit_compute_dtype"]),
        )

    model = AutoModelForCausalLM.from_pretrained(
        cfg["model"]["name"],
        revision=cfg["model"].get("revision"),
        quantization_config=bnb_config,
        device_map="auto",
        torch_dtype=getattr(torch, cfg["model"].get("torch_dtype", "bfloat16")),
        attn_implementation=cfg["model"].get("attn_implementation", "eager"),
        trust_remote_code=cfg["model"].get("trust_remote_code", False),
    )

    if cfg["quantization"]["load_in_4bit"]:
        model = prepare_model_for_kbit_training(
            model, use_gradient_checkpointing=cfg["training"].get("gradient_checkpointing", False),
        )

    # 5. LoRA
    if lora_cfg["lora"]["enabled"]:
        target_modules = lora_cfg["lora"].get("target_modules")
        if target_modules is None:
            target_modules = auto_target_modules(model, cfg["model"]["family"])
        lora_config = LoraConfig(
            r=lora_cfg["lora"]["r"],
            lora_alpha=lora_cfg["lora"]["alpha"],
            lora_dropout=lora_cfg["lora"]["dropout"],
            bias=lora_cfg["lora"]["bias"],
            task_type=lora_cfg["lora"]["task_type"],
            target_modules=target_modules,
            layers_to_transform=lora_cfg["lora"].get("layers_to_transform"),
            modules_to_save=lora_cfg["lora"].get("modules_to_save"),
        )
        model = get_peft_model(model, lora_config)
        model.print_trainable_parameters()

    # 6. Load datasets (support split files / comma-separated / glob)
    train_paths = expand_train_paths(cfg["dataset"]["train_path"])
    if len(train_paths) > 1:
        print(f"[Eternal Trainer] Loading train from {len(train_paths)} files:")
        for p in train_paths:
            print(f"  - {p}")
        train_records = load_jsonl_multi(train_paths, cfg["dataset"].get("max_samples"))
    else:
        print(f"[Eternal Trainer] Loading train: {train_paths[0]}")
        train_records = load_jsonl(train_paths[0], cfg["dataset"].get("max_samples"))
    if cfg["dataset"].get("shuffle", True):
        import random
        random.Random(cfg["dataset"]["seed"]).shuffle(train_records)

    val_records = []
    if cfg["dataset"].get("validation_path"):
        val_records = load_jsonl(cfg["dataset"]["validation_path"])

    print(f"[Eternal Trainer] Train samples: {len(train_records)}")
    print(f"[Eternal Trainer] Val   samples: {len(val_records)}")

    # 7. Tokenize
    def tokenize(record):
        messages = build_chat_messages(record)
        # Use the tokenizer's chat template if available
        try:
            text = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=False,
            )
        except Exception:
            # Manual fallback
            text = (
                f"<system>{messages[0]['content']}</system>\n"
                f"<user>{messages[1]['content']}</user>\n"
                f"<assistant>{messages[2]['content']}</assistant>"
            )
        tokens = tokenizer(
            text,
            max_length=cfg["model"]["max_length"],
            truncation=True,
            padding=False,
            return_tensors=None,
        )
        tokens["labels"] = tokens["input_ids"].copy()
        return tokens

    print("[Eternal Trainer] Tokenizing...")
    t0 = time.time()
    train_records = [tokenize(r) for r in train_records]
    val_records = [tokenize(r) for r in val_records]
    print(f"[Eternal Trainer] Tokenized in {time.time() - t0:.1f}s")

    # 8. Datasets
    train_dataset = Dataset.from_list(train_records)
    val_dataset = Dataset.from_list(val_records) if val_records else None

    if cfg["training"].get("group_by_length", True):
        train_dataset = train_dataset.map(lambda x: {"length": len(x["input_ids"])})

    # 9. Data collator (custom: pad input_ids, attention_mask, and labels to longest in batch)
    from dataclasses import dataclass
    from typing import List, Dict as _Dict
    import torch as _torch

    @dataclass
    class CausalLMCollator:
        tokenizer: any
        pad_to_multiple_of: int = 8

        def __call__(self, features: List[_Dict]) -> _Dict:
            max_len = max(len(f["input_ids"]) for f in features)
            if self.pad_to_multiple_of:
                max_len = ((max_len + self.pad_to_multiple_of - 1) // self.pad_to_multiple_of) * self.pad_to_multiple_of
            pad_id = self.tokenizer.pad_token_id
            batch = {"input_ids": [], "attention_mask": [], "labels": []}
            for f in features:
                ids = list(f["input_ids"])
                mask = list(f.get("attention_mask", [1] * len(ids)))
                labels = list(f["labels"])
                pad_n = max_len - len(ids)
                ids = ids + [pad_id] * pad_n
                mask = mask + [0] * pad_n
                labels = labels + [-100] * pad_n
                batch["input_ids"].append(ids)
                batch["attention_mask"].append(mask)
                batch["labels"].append(labels)
            return {k: _torch.tensor(v, dtype=_torch.long) for k, v in batch.items()}

    data_collator = CausalLMCollator(tokenizer=tokenizer)

    # 10. Training args
    output_dir = cfg["training"]["output_dir"]
    os.makedirs(output_dir, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=cfg["training"]["num_train_epochs"],
        per_device_train_batch_size=cfg["training"]["per_device_train_batch_size"],
        per_device_eval_batch_size=cfg["training"]["per_device_eval_batch_size"],
        gradient_accumulation_steps=cfg["training"]["gradient_accumulation_steps"],
        gradient_checkpointing=cfg["training"].get("gradient_checkpointing", False),
        learning_rate=cfg["training"]["learning_rate"],
        weight_decay=cfg["training"]["weight_decay"],
        warmup_ratio=cfg["training"]["warmup_ratio"],
        lr_scheduler_type=cfg["training"]["lr_scheduler_type"],
        optim=cfg["training"]["optim"],
        max_grad_norm=cfg["training"]["max_grad_norm"],
        logging_steps=cfg["training"]["logging_steps"],
        save_steps=cfg["training"]["save_steps"],
        save_total_limit=cfg["training"]["save_total_limit"],
        eval_steps=cfg["training"]["eval_steps"],
        evaluation_strategy=cfg["training"].get("evaluation_strategy", "steps"),
        report_to=cfg["training"].get("report_to", "none"),
        bf16=cfg["training"].get("bf16", True),
        fp16=cfg["training"].get("fp16", False),
        tf32=cfg["training"].get("tf32", True),
        seed=cfg["training"]["seed"],
        data_seed=cfg["training"]["data_seed"],
        dataloader_num_workers=cfg["training"].get("dataloader_num_workers", 2),
        remove_unused_columns=cfg["training"].get("remove_unused_columns", False),
        ddp_find_unused_parameters=cfg["training"].get("ddp_find_unused_parameters", False),
        group_by_length=cfg["training"].get("group_by_length", True),
        length_column_name=cfg["training"].get("length_column_name", "length"),
    )

    # 11. Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        data_collator=data_collator,
    )

    # 12. Train
    print("[Eternal Trainer] Starting training...")
    train_result = trainer.train(
        resume_from_checkpoint=cfg["training"].get("resume_from_checkpoint"),
    )

    # 13. Save final adapter
    final_dir = os.path.join(output_dir, "final")
    trainer.model.save_pretrained(final_dir)
    tokenizer.save_pretrained(final_dir)
    print(f"[Eternal Trainer] Saved final adapter: {final_dir}")

    # 14. Merge LoRA into base model and save merged
    if lora_cfg["lora"]["enabled"]:
        from peft import AutoPeftModelForCausalLM
        print("[Eternal Trainer] Merging LoRA into base model...")
        merged_dir = os.path.join(output_dir, "merged")
        # Reload base in fp16/bf16 (no quant) for merging
        del model
        del trainer
        torch.cuda.empty_cache()
        merged = AutoPeftModelForCausalLM.from_pretrained(
            final_dir,
            device_map="auto",
            torch_dtype=getattr(torch, cfg["model"].get("torch_dtype", "bfloat16")),
        )
        merged = merged.merge_and_unload()
        merged.save_pretrained(merged_dir, safe_serialization=True)
        tokenizer.save_pretrained(merged_dir)
        print(f"[Eternal Trainer] Saved merged model: {merged_dir}")
    else:
        merged_dir = final_dir

    # 15. Push to HuggingFace Hub (if enabled)
    push_to_hub = cfg["huggingface"].get("push_to_hub", False)
    hub_repo_id = cfg["huggingface"].get("hub_repo_id")
    if push_to_hub and hub_repo_id:
        print(f"[Eternal Trainer] Pushing to HuggingFace: {hub_repo_id}")
        from huggingface_hub import HfApi
        api = HfApi()
        api.create_repo(
            repo_id=hub_repo_id,
            private=cfg["huggingface"].get("hub_private", True),
            exist_ok=True,
        )
        api.upload_folder(
            folder_path=merged_dir,
            repo_id=hub_repo_id,
            commit_message=f"Project Eternal fine-tune ({cfg['model']['name']})",
        )
        print(f"[Eternal Trainer] Pushed: https://huggingface.co/{hub_repo_id}")

    # 16. Persist metadata
    meta = {
        "model_name": cfg["model"]["name"],
        "model_family": cfg["model"]["family"],
        "lora": lora_cfg["lora"],
        "training": {
            "epochs": cfg["training"]["num_train_epochs"],
            "learning_rate": cfg["training"]["learning_rate"],
            "per_device_batch_size": cfg["training"]["per_device_train_batch_size"],
            "gradient_accumulation_steps": cfg["training"]["gradient_accumulation_steps"],
            "seed": cfg["training"]["seed"],
        },
        "dataset": {
            "train_samples": len(train_records),
            "val_samples": len(val_records),
        },
        "final_dir": final_dir,
        "merged_dir": merged_dir,
        "trained_at": int(time.time()),
        "train_runtime": train_result.metrics.get("train_runtime", 0),
        "train_loss": train_result.metrics.get("train_loss", 0),
    }
    meta_path = os.path.join(output_dir, "training_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"[Eternal Trainer] Saved training meta: {meta_path}")

    # 17. Commit the volume
    volume.commit()
    print("[Eternal Trainer] Volume committed")

    return meta


# ----------------------------------------------------------------------------
#  Auto-target-modules (per family)
# ----------------------------------------------------------------------------

def auto_target_modules(model, family: str) -> List[str]:
    """Return the LoRA target modules appropriate for the model family."""
    family = family.lower()
    if family in ("gemma", "gemma3", "qwen", "llama", "mistral", "tinyllama"):
        return ["q_proj", "k_proj", "v_proj", "o_proj",
                "gate_proj", "up_proj", "down_proj"]
    if family == "phi":
        return ["qkv_proj", "o_proj", "gate_up_proj", "down_proj"]
    # Fallback: scan for linear layers with these names
    common = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    found = set()
    for name, module in model.named_modules():
        if isinstance(module, torch.nn.Linear):
            short = name.split(".")[-1]
            if short in common:
                found.add(short)
    return sorted(found) if found else common


# ----------------------------------------------------------------------------
#  Entry point
# ----------------------------------------------------------------------------

@app.local_entrypoint()
def main(
    config: str = "configs/training_config.yaml",
    lora_config: str = "configs/lora_config.yaml",
    model_name: str = None,
    train_path: str = None,
    validation_path: str = None,
    test_path: str = None,
    output_dir: str = None,
    target_epochs: int = None,
    per_device_batch_size: int = None,
    gradient_accumulation_steps: int = None,
    learning_rate: float = None,
    lora_r: int = None,
    lora_alpha: int = None,
    max_samples: int = None,
    seed: int = None,
    resume_from: str = None,
    gpu: str = None,
    push_to_hub: bool = False,
    hub_repo_id: str = None,
    hub_private: bool = True,
):
    args = argparse.Namespace(
        config=config,
        lora_config=lora_config,
        model_name=model_name,
        train_path=train_path,
        validation_path=validation_path,
        test_path=test_path,
        output_dir=output_dir,
        target_epochs=target_epochs,
        per_device_batch_size=per_device_batch_size,
        gradient_accumulation_steps=gradient_accumulation_steps,
        learning_rate=learning_rate,
        lora_r=lora_r,
        lora_alpha=lora_alpha,
        max_samples=max_samples,
        seed=seed,
        resume_from=resume_from,
        gpu=gpu,
        push_to_hub=push_to_hub,
        hub_repo_id=hub_repo_id,
        hub_private=hub_private,
    )
    cfg = load_yaml(args.config)
    cfg = apply_overrides(cfg, args)

    # Persist the resolved config into the volume (no-op on local, kept for reference)
    try:
        os.makedirs("/data/configs", exist_ok=True)
        with open("/data/configs/resolved_training_config.yaml", "w") as f:
            yaml.safe_dump(cfg, f)
        with open("/data/configs/resolved_lora_config.yaml", "w") as f:
            yaml.safe_dump(load_yaml(args.lora_config), f)
    except (OSError, FileNotFoundError):
        pass

    print(f"[Eternal Trainer] Training {cfg['model']['name']} on {cfg['modal']['gpu']}.")
    meta = train.remote(cfg, load_yaml(args.lora_config))
    print("=" * 60)
    print("[Eternal Trainer] Done")
    print("=" * 60)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
