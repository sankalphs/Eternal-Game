// ============================================================================
// PHASE 4: BATCH SCHEDULER
//
// Extends InferenceManager with request scheduling. Multiple AI requests
// are merged whenever possible. Supports priority, deadline, cancellation,
// and cache-aware scheduling.
// ============================================================================

import type { InferenceManager } from "./InferenceManager";
import type { InferenceResult, InferenceRequestLike, BatchedRequest, BatchScheduleConfig, BatchStats } from "./research-types";

export class BatchScheduler {
  private queue: BatchedRequest[] = [];
  private config: BatchScheduleConfig;
  private stats: BatchStats = {
    totalBatches: 0, avgBatchSize: 0, totalRequests: 0,
    batchedRequests: 0, cancelledRequests: 0, avgWaitMs: 0,
  };
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private totalWaitMs = 0;

  constructor(private inference: InferenceManager, config?: Partial<BatchScheduleConfig>) {
    this.config = {
      maxBatchSize: 4,
      batchWindowMs: 100,  // wait 100ms to collect batch
      enableBatching: true,
      ...config,
    };
  }

  /**
   * Submit a request. If batching is enabled, it may be merged with others.
   * Returns a promise that resolves when the request is processed.
   */
  async submit(request: InferenceRequestLike, priority = 5, deadlineMs = 5000): Promise<InferenceResult> {
    this.stats.totalRequests++;
    const deadline = Date.now() + deadlineMs;

    return new Promise<InferenceResult>((resolve, reject) => {
      const batched: BatchedRequest = {
        id: request.requestId,
        request,
        priority,
        deadline,
        resolve,
        reject,
      };

      this.queue.push(batched);

      if (this.config.enableBatching) {
        // Sort by priority (0 = highest priority = first)
        this.queue.sort((a, b) => a.priority - b.priority);

        // If we have enough requests, flush immediately
        if (this.queue.length >= this.config.maxBatchSize) {
          this.flush();
        } else {
          // Schedule a flush after the batch window
          if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), this.config.batchWindowMs);
          }
        }
      } else {
        // No batching — process immediately
        this.processSingle(batched);
      }
    });
  }

  /**
   * Cancel a pending request.
   */
  cancel(requestId: string): boolean {
    const idx = this.queue.findIndex(r => r.id === requestId);
    if (idx >= 0) {
      const [removed] = this.queue.splice(idx, 1);
      removed.reject(new Error("Cancelled"));
      this.stats.cancelledRequests++;
      return true;
    }
    return false;
  }

  /**
   * Flush the current queue as a batch.
   */
  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const batch = this.queue.splice(0, this.config.maxBatchSize);
    if (batch.length === 0) return;

    this.stats.totalBatches++;
    this.stats.batchedRequests += batch.length;

    // Check cache for each request — if cached, resolve immediately
    const uncached: BatchedRequest[] = [];
    for (const req of batch) {
      // The InferenceManager handles caching internally, so we just pass through.
      // But we track wait time here.
      const waitMs = Date.now() - (req.deadline - 5000);
      this.totalWaitMs += Math.max(0, waitMs);
      uncached.push(req);
    }

    // Process all requests in the batch (sequentially for now — the InferenceManager
    // handles caching/retries/fallback for each)
    for (const req of uncached) {
      await this.processSingle(req);
    }

    // Update stats
    this.stats.avgBatchSize = this.stats.totalBatches > 0
      ? this.stats.batchedRequests / this.stats.totalBatches
      : 0;
    this.stats.avgWaitMs = this.stats.totalRequests > 0
      ? this.totalWaitMs / this.stats.totalRequests
      : 0;
  }

  private async processSingle(req: BatchedRequest): Promise<void> {
    try {
      // Check if deadline has passed
      if (Date.now() > req.deadline) {
        req.reject(new Error("Deadline exceeded"));
        return;
      }

      const result = await this.inference.infer({
        prompt: req.request.prompt,
        maxTokens: req.request.maxTokens,
        temperature: req.request.temperature,
        requestId: req.request.requestId,
      });
      req.resolve(result);
    } catch (err) {
      req.reject(err);
    }
  }

  getStats(): BatchStats {
    return { ...this.stats };
  }

  /** Update config at runtime. */
  setConfig(config: Partial<BatchScheduleConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
