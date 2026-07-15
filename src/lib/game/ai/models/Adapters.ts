// ============================================================================
// PHASE 10: MODEL ABSTRACTION
//
// The AIModel interface. The engine interacts ONLY with this interface.
// Never directly with any specific model. Adapters implement this interface
// for each supported model backend.
// ============================================================================

import type { AIModel, AIModelMetadata, InferenceRequest, InferenceResult } from "../types";

// ---- Mock Adapter ----
// Produces deterministic, valid DirectorPlan JSON without any model.
// Used for testing, offline development, and as the ultimate fallback.
export class MockAdapter implements AIModel {
  private loaded = false;

  async load(): Promise<void> { this.loaded = true; }
  async unload(): Promise<void> { this.loaded = false; }
  async health(): Promise<boolean> { return this.loaded; }
  metadata(): AIModelMetadata {
    return {
      id: "mock", label: "Mock Model (deterministic)", type: "mock",
      maxTokens: 2048, contextWindow: 8192, supportsJSON: true, version: "1.0.0",
    };
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.loaded) await this.load();
    const start = Date.now();

    // Parse the context from the user prompt to produce a contextual mock response
    const contextMatch = request.prompt.user.match(/\{[\s\S]*\}/);
    let ctx: any = {};
    try { ctx = contextMatch ? JSON.parse(contextMatch[0]) : {}; } catch { /* ignore */ }

    const features = ctx.features ?? {};
    const prediction = ctx.prediction ?? {};
    const world = ctx.worldState ?? {};
    const campaign = ctx.campaign ?? {};

    // Generate a deterministic but contextual plan
    const aggression = features.aggression ?? 0.5;
    const patience = features.patience ?? 0.5;
    const corruption = world.corruption ?? 0;
    const emotion = campaign.currentEmotion ?? "confidence";

    let weather = "clear";
    if (corruption > 0.5) weather = "ash";
    else if (emotion === "fear" || emotion === "hopelessness") weather = "fog";
    else if (emotion === "rage") weather = "blood_moon";

    let bossStyle = "aggressive";
    if (prediction.kickSpam > 0.6) bossStyle = "counter";
    else if (prediction.blockTurtle > 0.6) bossStyle = "rushdown";
    else if (patience > 0.6) bossStyle = "patient";

    let difficulty = "normal";
    if (features.skill > 0.7) difficulty = "hard";
    if (features.skill > 0.85) difficulty = "brutal";

    const mockOutput = {
      weather,
      lighting: corruption > 0.5 ? "dark" : emotion === "wonder" ? "bright" : "normal",
      camera: emotion === "fear" ? "close" : "wide",
      music: emotion === "hopelessness" ? "hopeless" : emotion === "victory" ? "victory" : "ancient",
      crowd: corruption > 0.4 ? "burning_city" : "silent",
      hazards: prediction.blockTurtle > 0.6 ? ["poison_mist"] : corruption > 0.5 ? ["fire_rain"] : [],
      bossStyle,
      bossEmotion: emotion === "rage" ? "enraged" : "resolute",
      dialogueStyle: emotion === "rage" ? "rage" : "cold",
      difficulty,
      arenaStage: Math.min(5, Math.floor(corruption * 5)),
      narrative: `The ${emotion} settles over the arena.`,
      intent: `Create a ${emotion} experience for a player who is ${aggression > 0.6 ? "aggressive" : "patient"}.`,
    };

    return {
      text: JSON.stringify(mockOutput),
      latencyMs: Date.now() - start,
      modelId: "mock",
      fromCache: false,
      requestId: request.requestId,
    };
  }
}

// ---- Ollama Adapter (local models: Gemma, Qwen, Phi, TinyLlama, etc.) ----
// Connects to a local Ollama server running on the user's machine.
export class OllamaAdapter implements AIModel {
  private loaded = false;
  private model: string;
  private baseUrl: string;

  constructor(model: string = "gemma2:2b", baseUrl: string = "http://localhost:11434") {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async load(): Promise<void> { this.loaded = true; }
  async unload(): Promise<void> { this.loaded = false; }
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch { return false; }
  }
  metadata(): AIModelMetadata {
    return {
      id: `ollama:${this.model}`, label: `Ollama (${this.model})`, type: "local",
      maxTokens: 2048, contextWindow: 8192, supportsJSON: true, version: this.model,
    };
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.loaded) await this.load();
    const start = Date.now();

    // Build the Ollama chat request
    const messages = [
      { role: "system", content: request.prompt.system + "\n\n" + request.prompt.developer },
    ];
    for (const shot of request.prompt.fewShot) {
      messages.push({ role: "user", content: shot.input });
      messages.push({ role: "assistant", content: shot.output });
    }
    messages.push({ role: "user", content: request.prompt.user });

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: "json",
        options: { temperature: request.temperature, num_predict: request.maxTokens },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json();
    const text = data.message?.content ?? "";

    return {
      text,
      latencyMs: Date.now() - start,
      modelId: `ollama:${this.model}`,
      fromCache: false,
      requestId: request.requestId,
    };
  }
}

// ---- Remote API Adapter (for cloud-hosted models) ----
// Generic adapter for any OpenAI-compatible API endpoint.
export class RemoteAPIAdapter implements AIModel {
  private loaded = false;
  private model: string;
  private endpoint: string;
  private apiKey: string;

  constructor(model: string, endpoint: string, apiKey: string) {
    this.model = model;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  async load(): Promise<void> { this.loaded = true; }
  async unload(): Promise<void> { this.loaded = false; }
  async health(): Promise<boolean> { return this.loaded; }
  metadata(): AIModelMetadata {
    return {
      id: `remote:${this.model}`, label: `Remote (${this.model})`, type: "remote",
      maxTokens: 2048, contextWindow: 16384, supportsJSON: true, version: "1.0",
    };
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.loaded) await this.load();
    const start = Date.now();

    const messages = [
      { role: "system", content: request.prompt.system + "\n\n" + request.prompt.developer },
      ...request.prompt.fewShot.flatMap(shot => [
        { role: "user" as const, content: shot.input },
        { role: "assistant" as const, content: shot.output },
      ]),
      { role: "user", content: request.prompt.user },
    ];

    const res = await fetch(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      text,
      latencyMs: Date.now() - start,
      modelId: `remote:${this.model}`,
      fromCache: false,
      requestId: request.requestId,
    };
  }
}
