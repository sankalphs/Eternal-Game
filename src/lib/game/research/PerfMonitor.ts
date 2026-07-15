// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — PERFORMANCE MONITOR
//
// PHASE 12 of the publication-quality evaluation layer.
//
// Validates the simulator itself. Measures:
//
//   - Matches per second
//   - CPU utilization (best-effort)
//   - Memory usage (RSS in bytes)
//   - Serialization time
//   - Checkpoint overhead
//   - Replay speed
//   - Dataset generation throughput
//
// Detects bottlenecks automatically (e.g. "serialization > 30% of
// wall time").
//
// Reuses:
//   - process.hrtime / process.memoryUsage (Node only; best-effort)
// ============================================================================

import type { PerfMeasurement } from "./types";

// ----------------------------------------------------------------------------
// Lightweight shims that work in both Node and the browser
// ----------------------------------------------------------------------------

interface PerfNode {
  hrtime: (t?: [number, number]) => [number, number];
  memoryUsage: () => { rss: number; heapTotal: number; heapUsed: number };
  cpuUsage: () => { user: number; system: number };
  resourceUsage: () => { cpu: { user: number; system: number } } | undefined;
}

function getNode(): PerfNode | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const req = (0, eval)("require");
    return req("process") as any;
  } catch {
    return null;
  }
}

function memoryBytes(): number {
  const node = getNode();
  if (!node) return 0;
  try { return node.memoryUsage().rss; } catch { return 0; }
}

function cpuUsageSnapshot(): { user: number; system: number } {
  const node = getNode();
  if (!node) return { user: 0, system: 0 };
  try { return node.cpuUsage(); } catch { return { user: 0, system: 0 }; }
}

function elapsedMs(start: [number, number]): number {
  const node = getNode();
  if (!node) {
    return (typeof performance !== "undefined" ? performance.now() : Date.now());
  }
  const diff = node.hrtime(start);
  return diff[0] * 1000 + diff[1] / 1e6;
}

// ----------------------------------------------------------------------------
// Measurement
// ----------------------------------------------------------------------------

export interface PerfRunResult {
  measurement: PerfMeasurement;
  /** Per-stage timings (ms). */
  stages: Record<string, number>;
  /** Detected bottlenecks. */
  bottlenecks: string[];
}

export class PerfMonitor {
  private node: PerfNode | null = getNode();
  /** Recent CPU measurements for utilization. */
  private lastCpu: { user: number; system: number } | null = null;
  private lastCpuWallMs = 0;
  private stages: Record<string, number> = {};
  private stageStarts: Record<string, [number, number]> = {};
  private totalMatches = 0;
  private totalSamples = 0;
  private serializationMs = 0;
  private checkpointMs = 0;
  private startedAt: [number, number] | null = null;

  /** Start a stage timer. */
  startStage(name: string): void {
    this.stageStarts[name] = this.now();
  }

  /** End a stage timer (accumulates ms). */
  endStage(name: string): void {
    const start = this.stageStarts[name];
    if (!start) return;
    const ms = elapsedMs(start);
    this.stages[name] = (this.stages[name] ?? 0) + ms;
    delete this.stageStarts[name];
  }

  /** Record a match. */
  recordMatch(): void { this.totalMatches++; }

  /** Record a sample. */
  recordSample(): void { this.totalSamples++; }

  /** Record serialization time. */
  recordSerialization(ms: number): void { this.serializationMs += ms; }

  /** Record checkpoint time. */
  recordCheckpoint(ms: number): void { this.checkpointMs += ms; }

  /** Start the overall run. */
  startRun(): void {
    this.startedAt = this.now();
    this.lastCpu = cpuUsageSnapshot();
    this.lastCpuWallMs = Date.now();
  }

  /** Stop and produce a measurement. */
  stopRun(): PerfRunResult {
    const totalMs = this.startedAt ? elapsedMs(this.startedAt) : 0;
    const now = Date.now();
    const cpu = cpuUsageSnapshot();
    let cpuUsage = 0;
    if (this.lastCpu && this.node) {
      const wallDelta = Math.max(1, now - this.lastCpuWallMs);
      const cpuDelta = ((cpu.user - this.lastCpu.user) + (cpu.system - this.lastCpu.system)) / 1e6; // microsec -> sec
      const cpuCount = (typeof navigator !== "undefined" && (navigator as any).hardwareConcurrency) || 1;
      cpuUsage = Math.max(0, Math.min(1, cpuDelta / (wallDelta / 1000) / cpuCount));
    }
    const matchesPerSec = totalMs > 0 ? (this.totalMatches / totalMs) * 1000 : 0;
    const samplesPerSec = totalMs > 0 ? (this.totalSamples / totalMs) * 1000 : 0;
    const measurement: PerfMeasurement = {
      label: "run",
      matchesPerSec,
      cpuUsage,
      memoryBytes: memoryBytes(),
      serializationMs: this.serializationMs,
      checkpointMs: this.checkpointMs,
      samplesPerSec,
      totalMs,
      measuredAt: Date.now(),
    };
    // Bottleneck detection
    const bottlenecks: string[] = [];
    if (this.serializationMs / totalMs > 0.3) bottlenecks.push("serialization > 30% of wall time");
    if (this.checkpointMs / totalMs > 0.1) bottlenecks.push("checkpoint > 10% of wall time");
    if (cpuUsage < 0.1 && matchesPerSec > 0) bottlenecks.push("low CPU usage (consider parallelism)");
    if (cpuUsage > 0.95) bottlenecks.push("CPU-bound (no parallelism possible)");
    return { measurement, stages: { ...this.stages }, bottlenecks };
  }

  /** Measure serialization throughput by serialising a sample N times. */
  async measureSerialization<T>(value: T, serialize: (v: T) => string, iters = 100): Promise<number> {
    const start = this.now();
    for (let i = 0; i < iters; i++) serialize(value);
    const ms = elapsedMs(start);
    this.recordSerialization(ms);
    return ms;
  }

  /** Measure checkpoint throughput. */
  async measureCheckpoint<T>(value: T, save: (v: T) => Promise<void> | void, iters = 10): Promise<number> {
    const start = this.now();
    for (let i = 0; i < iters; i++) await save(value);
    const ms = elapsedMs(start);
    this.recordCheckpoint(ms);
    return ms;
  }

  private now(): [number, number] {
    if (this.node) return this.node.hrtime();
    // Browser fallback (pretend to be hrtime)
    const ms = typeof performance !== "undefined" ? performance.now() : Date.now();
    return [Math.floor(ms / 1000), (ms % 1000) * 1e6];
  }
}

// ----------------------------------------------------------------------------
// Convenience: one-shot measure
// ----------------------------------------------------------------------------

export async function measureAsync<T>(label: string, fn: () => Promise<T> | T): Promise<{ result: T; ms: number }> {
  const start: [number, number] = getNode() ? getNode()!.hrtime() : [0, 0];
  const result = await fn();
  const ms = elapsedMs(start);
  return { result, ms };
}
