// ============================================================================
// PROJECT ETERNAL — FINE-TUNED MODEL ADAPTER
//
// The runtime adapter for the fine-tuned Game Designer model. It can
// load from EITHER:
//   - A Modal endpoint URL (the recommended production path)
//   - A locally-exported HuggingFace model (for offline / dev use)
//
// The adapter implements the existing AIModel interface so it can plug
// into the existing AIPipeline / InferenceManager without any change
// to gameplay code. Only the AIModelAdapter changes.
//
// The adapter ALWAYS emits IntentOutput (not the legacy GameDesignPlan).
// The Director (V5) consumes the IntentOutput via its IntentTranslator
// and produces the final DirectorPlanV3. The combat engine, physics,
// and renderer are never touched.
// ============================================================================

import type { AIModel, AIModelMetadata, InferenceRequest, InferenceResult } from "../types";

// --------------------------------------------------------------------------
//  Local HF model — runtime
// --------------------------------------------------------------------------
//
// We support two local backends:
//   1. transformers.js (browser + Node, no native deps)
//   2. transformers (Python, via subprocess; not used in MVP)
//
// The MVP ships with an HTTP-mode default. The local-mode is
// implemented via a thin shim that uses a sidecar Python process
// (transformers/transformers.js). For Bun, the recommended path is
// Modal endpoint + local HF model files for fallback.
// --------------------------------------------------------------------------

export type LocalRuntime = "transformers_js" | "transformers_py" | "onnx" | "none";

export interface FineTunedAdapterConfig {
  /** Either an endpoint URL (production) or a local model path (dev). */
  endpointUrl?: string;
  /** Path to a local HF model directory. */
  localModelPath?: string;
  /** Local runtime to use. */
  localRuntime?: LocalRuntime;
  /** Model family — used for the chat template. */
  modelFamily?: "gemma" | "gemma3" | "qwen" | "phi" | "llama" | "mistral" | "tinyllama" | "other";
  /** Model version label. */
  modelVersion?: string;
  /** Max new tokens. */
  maxNewTokens?: number;
  /** Sampling temperature. */
  temperature?: number;
  /** Top-p. */
  topP?: number;
  /** Top-k. */
  topK?: number;
  /** API key (for self-hosted Modal). */
  apiKey?: string;
  /** Request timeout (ms). */
  timeoutMs?: number;
  /** Number of retries on transient failures. */
  retries?: number;
}

// --------------------------------------------------------------------------
//  The adapter
// --------------------------------------------------------------------------

export class FineTunedAdapter implements AIModel {
  private loaded = false;
  private config: Required<FineTunedAdapterConfig>;
  // Local runtime (if loaded)
  private localRuntime: LocalRuntimeHandle | null = null;

  constructor(config: FineTunedAdapterConfig) {
    this.config = {
      endpointUrl: config.endpointUrl ?? "",
      localModelPath: config.localModelPath ?? "",
      localRuntime: config.localRuntime ?? "transformers_js",
      modelFamily: config.modelFamily ?? "gemma3",
      modelVersion: config.modelVersion ?? "1.0.0",
      maxNewTokens: config.maxNewTokens ?? 256,
      temperature: config.temperature ?? 0.4,
      topP: config.topP ?? 0.95,
      topK: config.topK ?? 40,
      apiKey: config.apiKey ?? "",
      timeoutMs: config.timeoutMs ?? 60_000,
      retries: config.retries ?? 2,
    };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.config.endpointUrl) {
      // HTTP mode — nothing to load; just probe
      await this.probeEndpoint();
    } else if (this.config.localModelPath) {
      this.localRuntime = await loadLocalRuntime(this.config);
    } else {
      throw new Error("FineTunedAdapter: must set endpointUrl OR localModelPath");
    }
    this.loaded = true;
  }

  async unload(): Promise<void> {
    if (this.localRuntime) {
      await this.localRuntime.unload();
      this.localRuntime = null;
    }
    this.loaded = false;
  }

  async health(): Promise<boolean> {
    if (!this.loaded) return false;
    if (this.config.endpointUrl) {
      try {
        const res = await fetch(this.config.endpointUrl, {
          method: "POST",
          headers: this.endpointHeaders(),
          body: JSON.stringify({ health: true }),
          signal: AbortSignal.timeout(5_000),
        });
        return res.ok;
      } catch {
        return false;
      }
    }
    return this.localRuntime !== null;
  }

  metadata(): AIModelMetadata {
    return {
      id: this.config.endpointUrl
        ? `eternal-ft:${this.config.modelFamily}:${this.config.modelVersion}@endpoint`
        : `eternal-ft:${this.config.modelFamily}:${this.config.modelVersion}@local`,
      label: `Project Eternal Fine-Tuned (${this.config.modelFamily} ${this.config.modelVersion})`,
      type: this.config.endpointUrl ? "remote" : "local",
      maxTokens: this.config.maxNewTokens,
      contextWindow: 8192,
      supportsJSON: true,
      version: this.config.modelVersion,
    };
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.loaded) await this.load();
    const start = Date.now();

    // Extract the context JSON from the user prompt
    const context = extractContext(request.prompt.user);

    if (this.config.endpointUrl) {
      return this.inferEndpoint(request, context, start);
    }
    return this.inferLocal(request, context, start);
  }

  // --------------------------------------------------------------------------
  //  Endpoint mode
  // --------------------------------------------------------------------------
  private async inferEndpoint(
    request: InferenceRequest,
    context: unknown,
    start: number,
  ): Promise<InferenceResult> {
    const payload = {
      context,
      max_new_tokens: request.maxTokens ?? this.config.maxNewTokens,
      temperature: request.temperature ?? this.config.temperature,
      top_p: this.config.topP,
      top_k: this.config.topK,
      do_sample: (request.temperature ?? this.config.temperature) > 0,
    };

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const res = await fetch(this.config.endpointUrl, {
          method: "POST",
          headers: this.endpointHeaders(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        if (!res.ok) {
          throw new Error(`Endpoint error ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        const text = data.intent ? JSON.stringify(data.intent) : (data.raw ?? data.text ?? "");
        return {
          text,
          latencyMs: Date.now() - start,
          modelId: `eternal-ft:${this.config.modelVersion}@endpoint`,
          fromCache: false,
          requestId: request.requestId,
        };
      } catch (e) {
        lastErr = e;
        if (attempt < this.config.retries) {
          await sleep(500 * (attempt + 1));
        }
      }
    }
    throw new Error(
      `FineTunedAdapter: endpoint failed after ${this.config.retries + 1} attempts: ${String(lastErr)}`,
    );
  }

  private endpointHeaders(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) h["Authorization"] = `Bearer ${this.config.apiKey}`;
    return h;
  }

  private async probeEndpoint(): Promise<void> {
    // Best-effort health probe; non-fatal on failure
    try {
      const res = await fetch(this.config.endpointUrl, {
        method: "POST",
        headers: this.endpointHeaders(),
        body: JSON.stringify({ health: true }),
        signal: AbortSignal.timeout(5_000),
      });
      // 200 or 400 are both fine — the endpoint is reachable
      if (!res.ok && res.status >= 500) {
        throw new Error(`Endpoint unhealthy: ${res.status}`);
      }
    } catch (e) {
      // Don't throw — the adapter will retry on the first infer()
      console.warn(`[FineTunedAdapter] probe failed: ${e}`);
    }
  }

  // --------------------------------------------------------------------------
  //  Local mode
  // --------------------------------------------------------------------------
  private async inferLocal(
    request: InferenceRequest,
    context: unknown,
    start: number,
  ): Promise<InferenceResult> {
    if (!this.localRuntime) {
      throw new Error("FineTunedAdapter: local runtime not loaded");
    }
    const messages = [
      { role: "system" as const, content: request.prompt.system + "\n\n" + request.prompt.developer },
      ...request.prompt.fewShot.flatMap(shot => [
        { role: "user" as const, content: shot.input },
        { role: "assistant" as const, content: shot.output },
      ]),
      { role: "user" as const, content: request.prompt.user },
    ];
    const text = await this.localRuntime.generate(messages, {
      maxNewTokens: request.maxTokens ?? this.config.maxNewTokens,
      temperature: request.temperature ?? this.config.temperature,
      topP: this.config.topP,
      topK: this.config.topK,
    });
    return {
      text,
      latencyMs: Date.now() - start,
      modelId: `eternal-ft:${this.config.modelVersion}@local`,
      fromCache: false,
      requestId: request.requestId,
    };
  }
}

// --------------------------------------------------------------------------
//  Local runtime — abstract handle
// --------------------------------------------------------------------------

interface LocalRuntimeHandle {
  generate(messages: Array<{ role: string; content: string }>, options: {
    maxNewTokens: number;
    temperature: number;
    topP: number;
    topK: number;
  }): Promise<string>;
  unload(): Promise<void>;
}

// transformers.js runtime — uses dynamic import for portability
async function loadLocalRuntime(cfg: Required<FineTunedAdapterConfig>): Promise<LocalRuntimeHandle> {
  if (cfg.localRuntime === "transformers_js") {
    return loadTransformersJsRuntime(cfg);
  }
  if (cfg.localRuntime === "transformers_py") {
    return loadTransformersPyRuntime(cfg);
  }
  if (cfg.localRuntime === "onnx") {
    return loadOnnxRuntime(cfg);
  }
  throw new Error(`FineTunedAdapter: unsupported local runtime ${cfg.localRuntime}`);
}

async function loadTransformersJsRuntime(cfg: Required<FineTunedAdapterConfig>): Promise<LocalRuntimeHandle> {
  // Lazy import so the rest of the adapter works in any environment.
  // The package is optional — only needed when localRuntime === "transformers_js".
  // We hide it behind a runtime variable so Next.js/Turbopack does NOT
  // try to resolve the module at build time.
  const transformersModuleName = "@huggingface/transformers";
  const mod: any = await import(/* webpackIgnore: true */ transformersModuleName).catch(() => ({}));
  const { pipeline, env } = mod as { pipeline?: any; env?: any };
  if (!pipeline) {
    throw new Error("FineTunedAdapter: @huggingface/transformers is not installed");
  }
  env.localModelPath = cfg.localModelPath;
  env.allowRemoteModels = false;
  // Pick the right pipeline based on family
  const modelId = cfg.localModelPath;
  const pipe = await pipeline("text-generation", modelId, { dtype: "q4" });
  return {
    async generate(messages, options) {
      const out = await pipe(messages, {
        max_new_tokens: options.maxNewTokens,
        temperature: options.temperature,
        top_p: options.topP,
        top_k: options.topK,
        do_sample: options.temperature > 0,
      });
      // transformers.js returns [{generated_text: [...]}]
      const text = Array.isArray(out) ? (out[0]?.generated_text?.[out[0]?.generated_text?.length - 1]?.content ?? "")
                                       : String(out);
      return text;
    },
    async unload() { /* no-op for transformers.js */ },
  };
}

async function loadTransformersPyRuntime(cfg: Required<FineTunedAdapterConfig>): Promise<LocalRuntimeHandle> {
  // Spawn a subprocess that runs a small Python script. The subprocess
  // loads the model and generates on demand via stdin/stdout JSON.
  return {
    async generate(messages, options) {
      const { spawn } = await import("node:child_process");
      const proc = spawn("python", ["-m", "eternal.local_runner"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const payload = JSON.stringify({
        model_path: cfg.localModelPath,
        messages,
        max_new_tokens: options.maxNewTokens,
        temperature: options.temperature,
        top_p: options.topP,
        top_k: options.topK,
      });
      return new Promise<string>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        proc.on("close", (code: number) => {
          if (code === 0) {
            try {
              const out = JSON.parse(stdout);
              resolve(out.text ?? "");
            } catch (e) { reject(e); }
          } else {
            reject(new Error(`local_runner exit ${code}: ${stderr}`));
          }
        });
        proc.stdin.write(payload);
        proc.stdin.end();
      });
    },
    async unload() { /* subprocess exits per request */ },
  };
}

async function loadOnnxRuntime(cfg: Required<FineTunedAdapterConfig>): Promise<LocalRuntimeHandle> {
  // Use onnxruntime-web / onnxruntime-node if installed
  // This is a thin wrapper; for the MVP we throw a clear error
  throw new Error("FineTunedAdapter: ONNX runtime not yet implemented in MVP");
}

// --------------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function extractContext(userPrompt: string): unknown {
  // The PromptLibrary v4 puts the JSON in a "Game state (JSON):\n{...}" block
  const m = userPrompt.match(/Game state \(JSON\):\s*([\s\S]+)$/);
  if (m) {
    try {
      return JSON.parse(m[1].trim());
    } catch { /* fallthrough */ }
  }
  // Fallback: look for the first {...} block
  const j = userPrompt.match(/\{[\s\S]*\}/);
  if (j) {
    try { return JSON.parse(j[0]); } catch { /* ignore */ }
  }
  return {};
}
