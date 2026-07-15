# MODEL SWITCHING — How to switch between models

The fine-tuning pipeline is model-agnostic. The same code trains
Gemma, Qwen, Phi, Llama, Mistral, TinyLlama, and any other
HuggingFace causal LM.

## Switch the base model

Pass a different `--model-name` to `modal_train.py`:

```bash
# Gemma 3 270M (default)
modal run modal/modal_train.py --model-name google/gemma-3-270m-it

# Gemma 1B
modal run modal/modal_train.py --model-name google/gemma-3-1b-it

# Qwen 0.5B
modal run modal/modal_train.py --model-name Qwen/Qwen2.5-0.5B-Instruct

# Phi-3 mini
modal run modal/modal_train.py --model-name microsoft/Phi-3-mini-4k-instruct

# Llama 3.2 1B
modal run modal/modal_train.py --model-name meta-llama/Llama-3.2-1B-Instruct

# Mistral 7B (requires A100 or H100)
modal run modal/modal_train.py --model-name mistralai/Mistral-7B-Instruct-v0.3 --gpu A100

# TinyLlama
modal run modal/modal_train.py --model-name TinyLlama/TinyLlama-1.1B-Chat-v1.0
```

## Family-specific LoRA targets

The trainer auto-detects the LoRA target modules based on the
model family. The mapping is:

| Family | Target modules |
|---|---|
| gemma, gemma3, qwen, llama, mistral, tinyllama | q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj |
| phi | qkv_proj, o_proj, gate_up_proj, down_proj |
| other | auto-detected by scanning linear layers |

To override the auto-detection, edit
`modal/configs/lora_config.yaml`:

```yaml
lora:
  target_modules:
    - q_proj
    - k_proj
    - v_proj
    - o_proj
```

## Switch the runtime (local inference)

The `FineTunedAdapter` supports three local runtimes:

```bash
# transformers.js (browser + Node)
export ETERNAL_MODEL_PATH=./exports/eternal/merged
export ETERNAL_MODEL_RUNTIME=transformers_js

# Python subprocess (transformers)
export ETERNAL_MODEL_RUNTIME=transformers_py

# ONNX runtime (not yet implemented in MVP)
export ETERNAL_MODEL_RUNTIME=onnx
```

In TypeScript:

```ts
import { FineTunedAdapter } from "./src/lib/game/ai/models/Adapters";

const model = new FineTunedAdapter({
  localModelPath: "./exports/eternal/merged",
  localRuntime: "transformers_js",
  modelFamily: "gemma3",
  modelVersion: "1.0.0",
});
```

## Switching at runtime

The `AdapterFactory` (in `src/lib/game/ai/models/AdapterFactory.ts`)
picks the right adapter based on environment variables:

```bash
# Use Modal endpoint (production)
export ETERNAL_MODEL_ENDPOINT=https://your-modal-endpoint.modal.run

# Use local model (dev / offline)
export ETERNAL_MODEL_PATH=./exports/eternal/merged
export ETERNAL_MODEL_RUNTIME=transformers_js

# Use legacy remote API
export ETERNAL_REMOTE_API_URL=https://api.openai.com/v1
export ETERNAL_REMOTE_API_KEY=sk-...

# Use Ollama
export ETERNAL_USE_OLLAMA=1
export ETERNAL_OLLAMA_URL=http://localhost:11434
export ETERNAL_OLLAMA_MODEL=gemma3:270m

# (default) Use mock
```

The factory selects the first match in priority order. No code
change is needed to switch.

## Memory considerations

| Model | Approx. VRAM (QLoRA) | Recommended GPU |
|---|---|---|
| Gemma 3 270M | 2 GB | T4, A10G |
| Gemma 3 1B | 4 GB | A10G |
| Qwen 0.5B | 3 GB | A10G |
| Phi-3 mini | 6 GB | A10G |
| Llama 3.2 1B | 4 GB | A10G |
| Mistral 7B | 16 GB | A100 |
| Llama 3 8B | 18 GB | A100 |
| Llama 3 70B | 80 GB | H100 × 4 |

For tiny GPUs (T4, L4), stick to 270M-1B. For mid-tier (A10G, L40S),
go up to 3B. For high-end (A100, H100), go up to 70B with sharding.
