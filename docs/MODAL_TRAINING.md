# MODAL TRAINING — How to train on Modal

## Prerequisites

1. **Modal account.** Sign up at https://modal.com and install:
   ```bash
   pip install modal
   modal token new
   ```

2. **HuggingFace token (optional).** Only needed if you want to
   push the trained model to the Hub:
   ```bash
   modal secret create huggingface HF_TOKEN=hf_xxxxxxxx
   ```

3. **Weights & Biases account (optional).** Only needed for
   experiment tracking:
   ```bash
   modal secret create wandb WANDB_API_KEY=xxxxxxxx
   ```

## Step-by-step

### 1. Build the dataset

```bash
bun run scripts/build-intent-dataset.ts \
  --out ./data/intent_dataset \
  --frozen ./data/genome_libraries/GenomeLibrary_v1.json \
  --target 100000
```

This writes:
- `data/intent_dataset/train.jsonl`
- `data/intent_dataset/validation.jsonl`
- `data/intent_dataset/test.jsonl`
- `data/intent_dataset/statistics.json`
- `data/intent_dataset/dataset_report.json`
- `data/intent_dataset/README.md`

### 2. Upload the dataset to the Modal volume

```bash
modal volume put eternal-data ./data/intent_dataset /intent_dataset
```

The `eternal-data` volume is a persistent Modal volume that the
training container can read.

### 3. Train

```bash
modal run modal/modal_train.py \
  --model-name google/gemma-3-270m-it \
  --train-path /data/intent_dataset/train.jsonl \
  --validation-path /data/intent_dataset/validation.jsonl \
  --output-dir /data/checkpoints/eternal-game-designer \
  --target-epochs 3 \
  --learning-rate 0.0002 \
  --gpu A10G
```

This:
- Loads the model with 4-bit quantization (QLoRA).
- Adds LoRA adapters (r=32, alpha=64) to all attention + MLP layers.
- Trains for 3 epochs.
- Saves the LoRA adapter to `/data/checkpoints/eternal-game-designer/final`.
- Merges the LoRA into the base model and saves to `.../merged`.
- Optionally pushes to HuggingFace if `--push-to-hub` is set.
- Commits the volume.

The training takes ~2-4 hours on an A10G for 100k samples.

### 4. Resume from a checkpoint

```bash
modal run modal/modal_train.py \
  --resume-from /data/checkpoints/eternal-game-designer/checkpoint-1500
```

The trainer will load the checkpoint and continue from step 1500.

### 5. Deploy the inference endpoint

```bash
modal deploy modal/modal_inference.py
```

This deploys a web endpoint that accepts a GameDesignContext and
returns an IntentOutput. The endpoint URL is printed to stdout.

## Customisation

### Switch the model

To use a different model, change `--model-name`. The trainer
auto-detects the LoRA target modules based on the model family
(gemma, qwen, phi, llama, mistral, tinyllama, other).

```bash
modal run modal/modal_train.py --model-name Qwen/Qwen2.5-0.5B-Instruct
modal run modal/modal_train.py --model-name microsoft/Phi-3-mini-4k-instruct
modal run modal/modal_train.py --model-name TinyLlama/TinyLlama-1.1B-Chat-v1.0
```

### Adjust hyperparameters

All hyperparameters are in `modal/configs/training_config.yaml`
and `modal/configs/lora_config.yaml`. You can pass overrides via
CLI flags (see `modal run modal/modal_train.py --help`).

### Use full fine-tuning instead of LoRA

Edit `modal/configs/lora_config.yaml` and set `lora.enabled: false`.
Then set `training.optim: adamw_torch` in `training_config.yaml`.

### Use Weights & Biases

Set `wandb.enabled: true` in `training_config.yaml`. W&B is
automatically configured via the `wandb` Modal secret.

### Push to HuggingFace

```bash
modal run modal/modal_train.py \
  --push-to-hub \
  --hub-repo-id YourOrg/eternal-game-designer-v1
```

## Local evaluation (no Modal deployment)

```bash
# Export the merged model
python modal/eval/export_hf.py \
  --adapter-dir ./data/checkpoints/eternal-game-designer/final \
  --base-model google/gemma-3-270m-it \
  --output-dir ./data/exports/eternal-game-designer/merged

# Evaluate
python modal/eval/evaluate_model.py \
  --test-path ./data/intent_dataset/test.jsonl \
  --model-dir ./data/exports/eternal-game-designer/merged \
  --output-dir ./eval_results
```

## Troubleshooting

- **Out of memory** → reduce `--per-device-batch-size` or use a
  larger GPU (A100 instead of A10G).
- **Slow training** → check `nvidia-smi` on the Modal dashboard.
- **Checkpoint corruption** → delete `/data/checkpoints/eternal-game-designer`
  and restart.
- **Endpoint 500 errors** → check the Modal logs with
  `modal app logs eternal-inference`.
