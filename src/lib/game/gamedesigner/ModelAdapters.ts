// ============================================================================
// PHASE 6: MODEL ABSTRACTION
//
// Swappable adapters for the Game Designer. Each adapter implements the
// existing `AIModel` interface (src/lib/game/ai/types.ts) so it can plug
// into the existing InferenceManager without changes.
//
// Supported model families:
//   - Gemma       (Ollama, remote, local)
//   - Qwen        (Ollama, remote, local)
//   - Phi         (Ollama, remote, local)
//   - Llama       (Ollama, remote, local)
//   - Mistral     (Ollama, remote, local)
//   - TinyLlama   (Ollama, local)
//   - ONNX        (local runtime, no inference in MVP — see ONNXAdapterStub)
//   - GGUF        (local runtime, no inference in MVP — see GGUFAdapterStub)
//   - RemoteAPI   (OpenAI-compatible)
//
// NO INFERENCE IS PERFORMED. These are stubs and HTTP adapters ready for
// real models to be plugged in. They emit structured fallbacks when no
// real model is configured. Combat code is never touched.
// ============================================================================

import type { AIModel, AIModelMetadata, InferenceRequest, InferenceResult } from "../ai/types";

// --------------------------------------------------------------------------
// Shared Ollama base — used by Gemma, Qwen, Phi, Llama, Mistral, TinyLlama
// --------------------------------------------------------------------------

abstract class OllamaFamilyAdapter implements AIModel {
  protected loaded = false;
  protected baseUrl: string;

  constructor(
    public readonly model: string,
    baseUrl: string = "http://localhost:11434",
  ) {
    this.baseUrl = baseUrl;
  }

  async load(): Promise<void> { this.loaded = true; }
  async unload(): Promise<void> { this.loaded = false; }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  abstract metadata(): AIModelMetadata;

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.loaded) await this.load();
    const start = Date.now();
    const messages: { role: string; content: string }[] = [
      { role: "system", content: request.prompt.system + "\n\n" + request.prompt.developer },
    ];
    for (const shot of request.prompt.fewShot) {
      messages.push({ role: "user", content: shot.input });
      messages.push({ role: "assistant", content: shot.output });
    }
    messages.push({ role: "user", content: request.prompt.user });

    try {
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
        modelId: this.metadata().id,
        fromCache: false,
        requestId: request.requestId,
      };
    } catch (e) {
      // Network failure → deterministic stub (NOT a gameplay change).
      // The GameDesignOutputValidator will reject the stub if the model is
      // expected to be the source of truth.
      const stub = this.deterministicStub();
      return {
        text: JSON.stringify(stub),
        latencyMs: Date.now() - start,
        modelId: `${this.metadata().id}:offline-stub`,
        fromCache: false,
        requestId: request.requestId,
      };
    }
  }

  /**
   * Deterministic stub used when the model is unreachable. Keeps the
   * system functional offline. The GameDesignOutputValidator still
   * validates the result.
   */
  protected deterministicStub(): Record<string, unknown> {
    return {
      intent: "Offline fallback: no model reachable.",
      reasoning: "Model unreachable. Returning a safe default plan.",
      targetEmotion: "confidence",
      targetIntensity: 0.5,
      targetDifficulty: "normal",
      targetLearningGoal: "Engage the player.",
      recommendedGenome: "aggressive",
      recommendedWeather: "clear",
      recommendedLighting: "normal",
      recommendedMusic: "ancient",
      recommendedCamera: "wide",
      recommendedCrowd: "silent",
      recommendedHazards: [],
      recommendedNarrativeEvent: "",
      recommendedExperiment: null,
      confidence: 0.2,
    };
  }
}

// --------------------------------------------------------------------------
// Gemma — Google's open model family. Default: gemma2:2b
// --------------------------------------------------------------------------
export class GemmaAdapter extends OllamaFamilyAdapter {
  constructor(model: string = "gemma2:2b", baseUrl?: string) {
    super(model, baseUrl);
  }
  metadata(): AIModelMetadata {
    return {
      id: `gemma:${this.model}`,
      label: `Gemma (${this.model})`,
      type: "local",
      maxTokens: 4096,
      contextWindow: 8192,
      supportsJSON: true,
      version: this.model,
    };
  }
}

// --------------------------------------------------------------------------
// Qwen — Alibaba's open model family. Default: qwen2.5:3b
// --------------------------------------------------------------------------
export class QwenAdapter extends OllamaFamilyAdapter {
  constructor(model: string = "qwen2.5:3b", baseUrl?: string) {
    super(model, baseUrl);
  }
  metadata(): AIModelMetadata {
    return {
      id: `qwen:${this.model}`,
      label: `Qwen (${this.model})`,
      type: "local",
      maxTokens: 4096,
      contextWindow: 32768,
      supportsJSON: true,
      version: this.model,
    };
  }
}

// --------------------------------------------------------------------------
// Phi — Microsoft's small model family. Default: phi3:mini
// --------------------------------------------------------------------------
export class PhiAdapter extends OllamaFamilyAdapter {
  constructor(model: string = "phi3:mini", baseUrl?: string) {
    super(model, baseUrl);
  }
  metadata(): AIModelMetadata {
    return {
      id: `phi:${this.model}`,
      label: `Phi (${this.model})`,
      type: "local",
      maxTokens: 2048,
      contextWindow: 4096,
      supportsJSON: true,
      version: this.model,
    };
  }
}

// --------------------------------------------------------------------------
// Llama — Meta's open model family. Default: llama3.2:3b
// --------------------------------------------------------------------------
export class LlamaAdapter extends OllamaFamilyAdapter {
  constructor(model: string = "llama3.2:3b", baseUrl?: string) {
    super(model, baseUrl);
  }
  metadata(): AIModelMetadata {
    return {
      id: `llama:${this.model}`,
      label: `Llama (${this.model})`,
      type: "local",
      maxTokens: 4096,
      contextWindow: 8192,
      supportsJSON: true,
      version: this.model,
    };
  }
}

// --------------------------------------------------------------------------
// Mistral — Default: mistral:7b
// --------------------------------------------------------------------------
export class MistralAdapter extends OllamaFamilyAdapter {
  constructor(model: string = "mistral:7b", baseUrl?: string) {
    super(model, baseUrl);
  }
  metadata(): AIModelMetadata {
    return {
      id: `mistral:${this.model}`,
      label: `Mistral (${this.model})`,
      type: "local",
      maxTokens: 4096,
      contextWindow: 8192,
      supportsJSON: true,
      version: this.model,
    };
  }
}

// --------------------------------------------------------------------------
// TinyLlama — for very small context windows. Default: tinyllama:1.1b
// --------------------------------------------------------------------------
export class TinyLlamaAdapter extends OllamaFamilyAdapter {
  constructor(model: string = "tinyllama:1.1b", baseUrl?: string) {
    super(model, baseUrl);
  }
  metadata(): AIModelMetadata {
    return {
      id: `tinyllama:${this.model}`,
      label: `TinyLlama (${this.model})`,
      type: "local",
      maxTokens: 1024,
      contextWindow: 2048,
      supportsJSON: true,
      version: this.model,
    };
  }
}

// --------------------------------------------------------------------------
// ONNX — stub for a future local ONNX runtime. No inference in MVP.
// The interface is fully implemented so a real runtime can drop in.
// --------------------------------------------------------------------------
export class ONNXAdapterStub implements AIModel {
  private loaded = false;
  private modelPath: string;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  async load(): Promise<void> {
    // Real impl would: ort.InferenceSession.create(this.modelPath)
    this.loaded = true;
  }
  async unload(): Promise<void> { this.loaded = false; }
  async health(): Promise<boolean> { return this.loaded; }

  metadata(): AIModelMetadata {
    return {
      id: `onnx:${this.modelPath.split(/[\\/]/).pop() ?? "model"}`,
      label: `ONNX (${this.modelPath.split(/[\\/]/).pop() ?? "model"})`,
      type: "local",
      maxTokens: 1024,
      contextWindow: 2048,
      supportsJSON: true,
      version: "stub",
    };
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.loaded) await this.load();
    return {
      text: JSON.stringify({
        intent: "ONNX stub: no inference performed.",
        reasoning: "ONNX runtime not yet wired. The pipeline will fall back.",
        targetEmotion: "confidence",
        targetIntensity: 0.5,
        targetDifficulty: "normal",
        targetLearningGoal: "Engage the player.",
        recommendedGenome: "aggressive",
        recommendedWeather: "clear",
        recommendedLighting: "normal",
        recommendedMusic: "ancient",
        recommendedCamera: "wide",
        recommendedCrowd: "silent",
        recommendedHazards: [],
        recommendedNarrativeEvent: "",
        recommendedExperiment: null,
        confidence: 0.0,
      }),
      latencyMs: 0,
      modelId: this.metadata().id,
      fromCache: false,
      requestId: request.requestId,
    };
  }
}

// --------------------------------------------------------------------------
// GGUF — stub for a future llama.cpp runtime. No inference in MVP.
// --------------------------------------------------------------------------
export class GGUFAdapterStub implements AIModel {
  private loaded = false;
  private modelPath: string;
  private contextSize: number;

  constructor(modelPath: string, contextSize: number = 2048) {
    this.modelPath = modelPath;
    this.contextSize = contextSize;
  }

  async load(): Promise<void> {
    // Real impl would: llama.loadModel(this.modelPath)
    this.loaded = true;
  }
  async unload(): Promise<void> { this.loaded = false; }
  async health(): Promise<boolean> { return this.loaded; }

  metadata(): AIModelMetadata {
    return {
      id: `gguf:${this.modelPath.split(/[\\/]/).pop() ?? "model.gguf"}`,
      label: `GGUF (${this.modelPath.split(/[\\/]/).pop() ?? "model.gguf"})`,
      type: "local",
      maxTokens: 1024,
      contextWindow: this.contextSize,
      supportsJSON: true,
      version: "stub",
    };
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.loaded) await this.load();
    return {
      text: JSON.stringify({
        intent: "GGUF stub: no inference performed.",
        reasoning: "GGUF runtime not yet wired. The pipeline will fall back.",
        targetEmotion: "confidence",
        targetIntensity: 0.5,
        targetDifficulty: "normal",
        targetLearningGoal: "Engage the player.",
        recommendedGenome: "aggressive",
        recommendedWeather: "clear",
        recommendedLighting: "normal",
        recommendedMusic: "ancient",
        recommendedCamera: "wide",
        recommendedCrowd: "silent",
        recommendedHazards: [],
        recommendedNarrativeEvent: "",
        recommendedExperiment: null,
        confidence: 0.0,
      }),
      latencyMs: 0,
      modelId: this.metadata().id,
      fromCache: false,
      requestId: request.requestId,
    };
  }
}

// --------------------------------------------------------------------------
// Remote API — OpenAI-compatible endpoint. Generic.
// --------------------------------------------------------------------------
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
      id: `remote:${this.model}`,
      label: `Remote (${this.model})`,
      type: "remote",
      maxTokens: 2048,
      contextWindow: 16384,
      supportsJSON: true,
      version: "1.0",
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
      modelId: this.metadata().id,
      fromCache: false,
      requestId: request.requestId,
    };
  }
}

// --------------------------------------------------------------------------
// Factory: build an adapter from a string id
// --------------------------------------------------------------------------
export type GameDesignerModelId =
  | "gemma" | "qwen" | "phi" | "llama" | "mistral" | "tinyllama"
  | "onnx" | "gguf" | "remote" | "mock";

export interface ModelAdapterOptions {
  model?: string;
  baseUrl?: string;
  modelPath?: string;
  contextSize?: number;
  endpoint?: string;
  apiKey?: string;
}

export function createModelAdapter(
  id: GameDesignerModelId,
  opts?: ModelAdapterOptions,
): AIModel {
  switch (id) {
    case "gemma": return new GemmaAdapter(opts?.model ?? "gemma2:2b", opts?.baseUrl);
    case "qwen": return new QwenAdapter(opts?.model ?? "qwen2.5:3b", opts?.baseUrl);
    case "phi": return new PhiAdapter(opts?.model ?? "phi3:mini", opts?.baseUrl);
    case "llama": return new LlamaAdapter(opts?.model ?? "llama3.2:3b", opts?.baseUrl);
    case "mistral": return new MistralAdapter(opts?.model ?? "mistral:7b", opts?.baseUrl);
    case "tinyllama": return new TinyLlamaAdapter(opts?.model ?? "tinyllama:1.1b", opts?.baseUrl);
    case "onnx": return new ONNXAdapterStub(opts?.modelPath ?? "./model.onnx");
    case "gguf": return new GGUFAdapterStub(opts?.modelPath ?? "./model.gguf", opts?.contextSize);
    case "remote": {
      if (!opts?.endpoint || !opts?.apiKey) {
        throw new Error("RemoteAPIAdapter requires endpoint and apiKey");
      }
      return new RemoteAPIAdapter(opts.model ?? "gpt-4o-mini", opts.endpoint, opts.apiKey);
    }
    case "mock":
    default:
      return new DeterministicMockAdapter();
  }
}

// --------------------------------------------------------------------------
// Deterministic mock — used as the default and as the offline fallback.
// Produces a high-quality, topline-driven GameDesignPlan deterministically.
// No gameplay values, only design intent.
// --------------------------------------------------------------------------
export class DeterministicMockAdapter implements AIModel {
  private loaded = false;
  async load(): Promise<void> { this.loaded = true; }
  async unload(): Promise<void> { this.loaded = false; }
  async health(): Promise<boolean> { return this.loaded; }

  metadata(): AIModelMetadata {
    return {
      id: "mock",
      label: "Deterministic Mock (topline-driven)",
      type: "mock",
      maxTokens: 2048,
      contextWindow: 8192,
      supportsJSON: true,
      version: "1.0.0",
    };
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.loaded) await this.load();
    const start = Date.now();
    const plan = this.buildFromUserPrompt(request.prompt.user);
    return {
      text: JSON.stringify(plan),
      latencyMs: Date.now() - start,
      modelId: "mock",
      fromCache: false,
      requestId: request.requestId,
    };
  }

  private buildFromUserPrompt(userPrompt: string): Record<string, unknown> {
    // Pull the topline from the embedded JSON.
    const match = userPrompt.match(/\{[\s\S]*\}/);
    let topline: { currentMood?: string; recommendedPosture?: string; dominantStrategy?: string; biggestWeakness?: string; currentEmotion?: string; trajectory?: string } = {};
    try {
      if (match) {
        const parsed = JSON.parse(match[0]);
        topline = parsed.topline ?? {};
        if (!topline.currentEmotion && parsed.emotionalCurve) {
          topline.currentEmotion = parsed.emotionalCurve.currentEmotion;
        }
      }
    } catch { /* ignore */ }

    return MockPlanGenerator.generate(topline);
  }
}

/**
 * Pure function — given a topline, produce a valid GameDesignPlan.
 * Lives next to the mock adapter for testability and replay.
 */
export class MockPlanGenerator {
  static generate(topline: {
    currentMood?: string;
    recommendedPosture?: string;
    dominantStrategy?: string;
    biggestWeakness?: string;
    currentEmotion?: string;
    trajectory?: string;
  }): Record<string, unknown> {
    const posture = topline.recommendedPosture ?? "challenge";
    const mood = topline.currentMood ?? "focused";
    const weakness = topline.biggestWeakness ?? "none";
    const currentEmotion = topline.currentEmotion ?? "confidence";

    // Posture → genome
    const genomeByPosture: Record<string, string> = {
      challenge: "rushdown",
      teach: "mind_game",
      reward: "patient",
      punish: "counter",
      rest: "defensive",
    };

    // Posture → atmosphere
    const atmosphereByPosture: Record<string, { weather: string; lighting: string; music: string; camera: string; crowd: string }> = {
      challenge: { weather: "ash", lighting: "dark", music: "percussion", camera: "handheld", crowd: "running" },
      teach:     { weather: "fireflies", lighting: "bright", music: "ancient", camera: "cinematic", crowd: "monks" },
      reward:    { weather: "clear", lighting: "bright", music: "epic", camera: "wide", crowd: "cheering" },
      punish:    { weather: "fog", lighting: "dim", music: "ancient", camera: "cinematic", crowd: "silent" },
      rest:      { weather: "cherry_blossoms", lighting: "bright", music: "peaceful", camera: "wide", crowd: "silent" },
    };

    // Posture → difficulty delta
    const difficultyByPosture: Record<string, string> = {
      challenge: "hard",
      teach: "normal",
      reward: "normal",
      punish: "brutal",
      rest: "easy",
    };

    // Counter the weakness
    const counterGenome: Record<string, string> = {
      kickSpam: "counter",
      blockTurtle: "rushdown",
      panicRoll: "punisher",
      earlyRush: "counter",
      superSave: "aggressive",
      whiffPunish: "defensive",
    };

    const genome = counterGenome[weakness] ?? genomeByPosture[posture] ?? "aggressive";
    const atmo = atmosphereByPosture[posture] ?? atmosphereByPosture.challenge;
    const difficulty = difficultyByPosture[posture] ?? "normal";

    // Target emotion — step from current in the direction of the posture
    const targetEmotion = MockPlanGenerator.shiftEmotion(currentEmotion, posture);

    // Hazards — counter the weakness where possible
    const hazardsByWeakness: Record<string, string[]> = {
      kickSpam: ["fog"],
      blockTurtle: ["fire_rain"],
      panicRoll: ["earthquake"],
      earlyRush: ["fog"],
    };
    const hazards = hazardsByWeakness[weakness] ?? [];

    // Narrative event — pick based on mood and posture
    const narrativeByPosture: Record<string, string> = {
      challenge: "ArenaDamaged",
      teach: "MythCreated",
      reward: "HeroSpared",
      punish: "WeatherChanged",
      rest: "MonksEscaped",
    };
    const narrativeEvent = narrativeByPosture[posture] ?? "WeatherChanged";

    // Experiment — only sometimes
    const experiment = posture === "punish" ? "low_visibility" : null;

    const reasoning = `Posture=${posture}, mood=${mood}, weakness=${weakness}, current=${currentEmotion}. ` +
      `Counter the weakness with a ${genome} genome and shift the atmosphere to ${atmo.weather}/${atmo.lighting} so the change is felt, not announced.`;

    return {
      intent: MockPlanGenerator.intentFor(posture, mood),
      reasoning,
      targetEmotion,
      targetIntensity: 0.6,
      targetDifficulty: difficulty,
      targetLearningGoal: MockPlanGenerator.learningGoalFor(posture, weakness),
      recommendedGenome: genome,
      recommendedWeather: atmo.weather,
      recommendedLighting: atmo.lighting,
      recommendedMusic: atmo.music,
      recommendedCamera: atmo.camera,
      recommendedCrowd: atmo.crowd,
      recommendedHazards: hazards,
      recommendedNarrativeEvent: narrativeEvent,
      recommendedExperiment: experiment,
      confidence: 0.55,
    };
  }

  private static intentFor(posture: string, mood: string): string {
    switch (posture) {
      case "challenge": return `Challenge the ${mood} player. Raise the stakes.`;
      case "teach": return `Teach the player a new pattern.`;
      case "reward": return `Reward the player. Rebuild confidence.`;
      case "punish": return `Punish the overconfident player.`;
      case "rest": return `Give the player a moment of rest.`;
      default: return `Engage the player.`;
    }
  }

  private static learningGoalFor(posture: string, weakness: string): string {
    if (posture === "punish") return `Break the habit: ${weakness}.`;
    if (posture === "teach") return `Develop counterplay to ${weakness}.`;
    if (posture === "reward") return `Reinforce a successful pattern.`;
    if (posture === "challenge") return `Generalise skills under pressure.`;
    return `Rest and observe.`;
  }

  private static shiftEmotion(current: string, posture: string): string {
    const shifts: Record<string, Record<string, string>> = {
      challenge: {
        confidence: "determination",
        wonder: "suspicion",
        fear: "rage",
        hopelessness: "determination",
        rage: "rage",
        serene: "curiosity",
      },
      punish: {
        confidence: "fear",
        wonder: "suspicion",
        fear: "hopelessness",
        rage: "rage",
        determination: "rage",
      },
      reward: {
        fear: "determination",
        hopelessness: "serene",
        despair: "triumph",
        frustration: "hope",
        rage: "determination",
      },
      teach: {
        confidence: "curiosity",
        rage: "curiosity",
        determination: "wonder",
      },
      rest: {
        rage: "serene",
        chaos: "serene",
        fear: "wonder",
      },
    };
    return shifts[posture]?.[current] ?? current;
  }
}
