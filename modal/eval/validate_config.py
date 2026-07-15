#!/usr/bin/env python3
# =============================================================================
# MODAL CONFIG VALIDATION
#
# Verifies that the Modal training/inference/eval configs are valid and
# correctly set up for Qwen 1.5B.
#
# Usage: python modal/eval/validate_config.py
# =============================================================================

import sys
import yaml
from pathlib import Path

CONFIG_DIR = Path(__file__).parent.parent / "configs"
ERRORS = []
WARNINGS = []


def check(condition, message, severity="error"):
    if not condition:
        if severity == "error":
            ERRORS.append(message)
        else:
            WARNINGS.append(message)


def validate_training_config():
    path = CONFIG_DIR / "training_config.yaml"
    if not path.exists():
        ERRORS.append(f"Missing: {path}")
        return None
    with open(path) as f:
        cfg = yaml.safe_load(f)

    model = cfg.get("model", {})
    check(model.get("family") in ("gemma", "gemma3", "qwen", "phi", "llama", "mistral", "tinyllama"),
          f"model.family must be one of the supported families, got {model.get('family')}")
    check(model.get("name") and "/" in model.get("name", ""),
          f"model.name should be a HuggingFace model id, got {model.get('name')}")
    check(model.get("max_length", 0) >= 1024,
          f"model.max_length should be at least 1024, got {model.get('max_length')}")

    quant = cfg.get("quantization", {})
    check(quant.get("load_in_4bit") in (True, False),
          "quantization.load_in_4bit must be a boolean")

    lora = cfg.get("lora", {})
    check(lora.get("r", 0) > 0, f"lora.r must be > 0, got {lora.get('r')}")
    check(lora.get("alpha", 0) > 0, f"lora.alpha must be > 0, got {lora.get('alpha')}")

    training = cfg.get("training", {})
    check(training.get("num_train_epochs", 0) > 0, "training.num_train_epochs must be > 0")
    check(training.get("per_device_train_batch_size", 0) > 0,
          "training.per_device_train_batch_size must be > 0")
    check(training.get("learning_rate", 0) > 0, "training.learning_rate must be > 0")
    check(training.get("seed", -1) >= 0, "training.seed must be >= 0")

    modal = cfg.get("modal", {})
    check(modal.get("gpu") in ("T4", "A10G", "A100", "H100", "L4", "L40S", "any"),
          f"modal.gpu should be a valid GPU, got {modal.get('gpu')}")

    return cfg


def validate_lora_config():
    path = CONFIG_DIR / "lora_config.yaml"
    if not path.exists():
        ERRORS.append(f"Missing: {path}")
        return None
    with open(path) as f:
        cfg = yaml.safe_load(f)

    lora = cfg.get("lora", {})
    check(lora.get("enabled") in (True, False), "lora.enabled must be a boolean")
    if lora.get("enabled"):
        check(lora.get("r", 0) > 0, f"lora.r must be > 0, got {lora.get('r')}")
        check(lora.get("alpha", 0) > 0, f"lora.alpha must be > 0, got {lora.get('alpha')}")
        check(lora.get("alpha", 0) >= lora.get("r", 999),
              f"lora.alpha ({lora.get('alpha')}) should be >= lora.r ({lora.get('r')})")
    return cfg


def main():
    print("=" * 60)
    print("Modal Config Validation - Project Eternal")
    print("=" * 60)

    training = validate_training_config()
    lora = validate_lora_config()

    if training and lora:
        # Check consistency
        t_lora = training.get("lora", {})
        l_lora = lora.get("lora", {})
        check(t_lora.get("r") == l_lora.get("r"),
              f"training_config.lora.r ({t_lora.get('r')}) != lora_config.lora.r ({l_lora.get('r')})")
        check(t_lora.get("alpha") == l_lora.get("alpha"),
              f"training_config.lora.alpha ({t_lora.get('alpha')}) != lora_config.lora.alpha ({l_lora.get('alpha')})")

    print()
    if ERRORS:
        print(f"[ERR] {len(ERRORS)} ERRORS:")
        for e in ERRORS:
            print(f"  - {e}")
    if WARNINGS:
        print(f"[WARN] {len(WARNINGS)} WARNINGS:")
        for w in WARNINGS:
            print(f"  - {w}")
    if not ERRORS and not WARNINGS:
        print("[OK] All configs valid for Qwen 1.5B (or whatever model is configured)")
        if training:
            print(f"  Model: {training['model']['name']}")
            print(f"  Family: {training['model']['family']}")
            print(f"  GPU: {training['modal']['gpu']}")
            print(f"  Epochs: {training['training']['num_train_epochs']}")
            print(f"  LoRA r={training['lora']['r']}, alpha={training['lora']['alpha']}")
        return 0
    return 1 if ERRORS else 0


if __name__ == "__main__":
    sys.exit(main())
