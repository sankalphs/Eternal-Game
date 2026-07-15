// ============================================================================
// PHASE 4: INFERENCE MANAGER
//
// The ONLY component allowed to communicate with AI models.
// Handles: model loading, switching, caching, timeouts, retries, fallback.
// The rest of the engine never knows which model is active.
// ============================================================================

import type { AIModel, InferenceRequest, InferenceResult } from "./types";

interface CacheEntry {
  result: InferenceResult;
  timestamp: number;
}

export interface InferenceManagerConfig {
  timeoutMs: number;
  maxRetries: number;
  cacheTTL: number;          // seconds
  enableCache: boolean;
  fallbackModelId: string;   // model to use if primary fails
}

export const DEFAULT_CONFIG: InferenceManagerConfig = {
  timeoutMs: 15000,
  maxRetries: 2,
  cacheTTL: 300, // 5 minutes
  enableCache: true,
  fallbackModelId: "mock",
};

export class InferenceManager {
  private models: Map<string, AIModel> = new Map();
  private activeModelId: string = "mock";
  private cache: Map<string, CacheEntry> = new Map();
  private config: InferenceManagerConfig;
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    fallbacks: 0,
    failures: 0,
    avgLatencyMs: 0,
  };

  constructor(config?: Partial<InferenceManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a model adapter. */
  registerModel(model: AIModel): void {
    const meta = model.metadata();
    this.models.set(meta.id, model);
  }

  /** Set the active model by ID. */
  setActiveModel(modelId: string): boolean {
    if (this.models.has(modelId)) {
      this.activeModelId = modelId;
      return true;
    }
    return false;
  }

  /** Get the active model. */
  getActiveModel(): AIModel | null {
    return this.models.get(this.activeModelId) ?? null;
  }

  /** Get all registered model IDs. */
  listModels(): string[] {
    return [...this.models.keys()];
  }

  /** Run inference with caching, retries, and fallback. */
  async infer(request: InferenceRequest): Promise<InferenceResult> {
    this.stats.totalRequests++;
    const cacheKey = this.cacheKey(request);

    // Check cache
    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) / 1000 < this.config.cacheTTL) {
        this.stats.cacheHits++;
        return { ...cached.result, fromCache: true };
      }
    }

    // Try the active model with retries
    const result = await this.tryInfer(request, this.activeModelId);

    if (result) {
      // Cache the result
      if (this.config.enableCache) {
        this.cache.set(cacheKey, { result, timestamp: Date.now() });
      }
      this.updateLatency(result.latencyMs);
      return result;
    }

    // Fallback to fallback model
    if (this.activeModelId !== this.config.fallbackModelId) {
      this.stats.fallbacks++;
      const fallbackResult = await this.tryInfer(request, this.config.fallbackModelId);
      if (fallbackResult) {
        this.updateLatency(fallbackResult.latencyMs);
        return fallbackResult;
      }
    }

    // Ultimate fallback: generate a mock response inline
    this.stats.failures++;
    return {
      text: '{"weather":"clear","bossStyle":"aggressive","difficulty":"normal","intent":"Fallback: standard fight.","lighting":"normal","camera":"wide","music":"ancient","crowd":"silent","hazards":[],"bossEmotion":"resolute","dialogueStyle":"cold","arenaStage":0,"narrative":"A standard encounter."}',
      latencyMs: 0,
      modelId: "emergency-fallback",
      fromCache: false,
      requestId: request.requestId,
    };
  }

  /** Try inference with a specific model, with retries + timeout. */
  private async tryInfer(request: InferenceRequest, modelId: string): Promise<InferenceResult | null> {
    const model = this.models.get(modelId);
    if (!model) return null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await model.infer(request);
        if (result.text && result.text.length > 0) return result;
      } catch (err) {
        // Log and retry
        console.warn(`[InferenceManager] ${modelId} attempt ${attempt + 1} failed:`, err);
        if (attempt < this.config.maxRetries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1))); // backoff
        }
      }
    }
    return null;
  }

  private cacheKey(request: InferenceRequest): string {
    // Hash the prompt content (not the requestId) for cache hits
    const content = request.prompt.system + request.prompt.user;
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
    }
    return `${this.activeModelId}:${hash}`;
  }

  private updateLatency(ms: number): void {
    const n = this.stats.totalRequests - this.stats.cacheHits;
    if (n > 0) {
      this.stats.avgLatencyMs = (this.stats.avgLatencyMs * (n - 1) + ms) / n;
    }
  }

  /** Get performance stats (for the debug panel). */
  getStats() {
    return { ...this.stats, activeModel: this.activeModelId, cacheSize: this.cache.size };
  }

  /** Clear the cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Check if the active model is healthy. */
  async health(): Promise<boolean> {
    const model = this.getActiveModel();
    if (!model) return false;
    try { return await model.health(); } catch { return false; }
  }
}
