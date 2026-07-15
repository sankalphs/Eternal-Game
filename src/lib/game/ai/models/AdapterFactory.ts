// ============================================================================
// PROJECT ETERNAL — AI MODEL ADAPTER FACTORY
//
// The single entry point for choosing the AIModel used by the AI
// pipeline. It picks among (in priority order):
//
//   1. FineTunedAdapter (if ETERNAL_MODEL_ENDPOINT or
//      ETERNAL_MODEL_PATH is set) — the new default
//   2. RemoteAPIAdapter (if ETERNAL_REMOTE_API_* is set) — legacy
//   3. OllamaAdapter (if ETERNAL_OLLAMA_URL is set) — legacy
//   4. MockAdapter (always works, deterministic, no network)
//
// The factory NEVER modifies gameplay. It just returns the right
// AIModel implementation.
// ============================================================================

import { MockAdapter, OllamaAdapter, RemoteAPIAdapter } from "./Adapters";
import { FineTunedAdapter, type FineTunedAdapterConfig } from "./FineTunedAdapter";
import type { AIModel } from "../types";

export type AdapterKind = "fine_tuned" | "remote_api" | "ollama" | "mock";

export interface AdapterSelection {
  kind: AdapterKind;
  model: AIModel;
  config: Record<string, unknown>;
}

export function createAIModelAdapter(overrides: Partial<FineTunedAdapterConfig> = {}): AIModel {
  return selectAdapter(overrides).model;
}

export function selectAdapter(overrides: Partial<FineTunedAdapterConfig> = {}): AdapterSelection {
  // 1. Fine-tuned model (production)
  const endpointUrl = overrides.endpointUrl ?? process.env.ETERNAL_MODEL_ENDPOINT ?? "";
  const localModelPath = overrides.localModelPath ?? process.env.ETERNAL_MODEL_PATH ?? "";
  if (endpointUrl || localModelPath) {
    const config: FineTunedAdapterConfig = {
      endpointUrl,
      localModelPath,
      localRuntime: (overrides.localRuntime ?? process.env.ETERNAL_MODEL_RUNTIME as never) ?? "transformers_js",
      modelFamily: (overrides.modelFamily ?? process.env.ETERNAL_MODEL_FAMILY as never) ?? "gemma3",
      modelVersion: overrides.modelVersion ?? process.env.ETERNAL_MODEL_VERSION ?? "1.0.0",
      maxNewTokens: overrides.maxNewTokens ?? parseInt(process.env.ETERNAL_MODEL_MAX_TOKENS ?? "256", 10),
      temperature: overrides.temperature ?? parseFloat(process.env.ETERNAL_MODEL_TEMPERATURE ?? "0.4"),
      topP: overrides.topP ?? 0.95,
      topK: overrides.topK ?? 40,
      apiKey: overrides.apiKey ?? process.env.ETERNAL_MODEL_API_KEY ?? "",
      timeoutMs: overrides.timeoutMs ?? 60_000,
      retries: overrides.retries ?? 2,
    };
    return {
      kind: "fine_tuned",
      model: new FineTunedAdapter(config),
      config: config as unknown as Record<string, unknown>,
    };
  }

  // 2. Remote API (legacy)
  const remoteUrl = process.env.ETERNAL_REMOTE_API_URL ?? "";
  if (remoteUrl) {
    return {
      kind: "remote_api",
      model: new RemoteAPIAdapter(
        process.env.ETERNAL_REMOTE_API_MODEL ?? "gpt-4o-mini",
        remoteUrl,
        process.env.ETERNAL_REMOTE_API_KEY ?? "",
      ),
      config: { url: remoteUrl },
    };
  }

  // 3. Ollama (legacy / dev)
  const ollamaUrl = process.env.ETERNAL_OLLAMA_URL ?? "http://localhost:11434";
  if (process.env.ETERNAL_USE_OLLAMA === "1") {
    return {
      kind: "ollama",
      model: new OllamaAdapter(process.env.ETERNAL_OLLAMA_MODEL ?? "gemma3:270m", ollamaUrl),
      config: { url: ollamaUrl },
    };
  }

  // 4. Mock (always works)
  return {
    kind: "mock",
    model: new MockAdapter(),
    config: { deterministic: true },
  };
}
