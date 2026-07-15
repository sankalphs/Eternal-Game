// ============================================================================
// VERSION MANIFEST TESTS
// ============================================================================

import { describe, expect, it } from "bun:test";
import { VersionManifestBuilder, serializeManifest, deserializeManifest, uuid4 } from "../../src/lib/game/intent/VersionManifest";

describe("VersionManifest", () => {
  it("builds a complete manifest", () => {
    const m = new VersionManifestBuilder()
      .setExperiment("test-run")
      .setDataset({
        id: "eternal-v1", version: "1.0.0",
        sampleCount: 1000, trainCount: 800, validationCount: 100, testCount: 100,
        minQuality: 0.65, minConfidence: 0.6, splitStrategy: "stratified",
        paths: { train: "train.jsonl", validation: "val.jsonl", test: "test.jsonl" },
        generatedAt: new Date().toISOString(), generatorVersion: "1.0.0",
      })
      .setGenome({
        libraryVersion: "v1", totalEntries: 9, stylesAvailable: ["balanced", "aggressive"],
        frozenAt: new Date().toISOString(), source: "auto", baseOpponent: "default",
      })
      .setTeacher({
        kind: "frozen_champion", identifier: "aggressive_genome_1",
        fitness: 0.9, eloRating: 1600, libraryVersion: "v1",
      })
      .setPrompt({
        id: "v4", label: "intent-only", notes: "training target",
        outputSchema: "intent",
      })
      .setModel({
        family: "qwen", baseModel: "Qwen/Qwen2.5-1.5B-Instruct", revision: "main",
        parameters: "1.5B", torchDtype: "bfloat16", contextLength: 4096,
        peft: { enabled: true, method: "qlora", r: 64, alpha: 128, dropout: 0.05, targetModules: [] },
        quantization: { enabled: true, method: "4bit", quantType: "nf4" },
      })
      .setTrainingConfig({
        epochs: 3, learningRate: 0.00015, perDeviceBatchSize: 4,
        gradientAccumulationSteps: 16, optim: "paged_adamw_8bit",
        lrScheduler: "cosine", warmupRatio: 0.03, weightDecay: 0.0, seed: 42,
        bf16: true, fp16: false, tf32: true, maxSteps: null,
        reportTo: "none", saveSteps: 500, evalSteps: 500, groupByLength: true,
      })
      .setDistillation({
        method: "offline_best_of_n", n: 4, temperature: 0.4,
        qualityEngine: "1.0.0", replayEvaluator: "1.0.0",
      })
      .build();
    expect(m.dataset.id).toBe("eternal-v1");
    expect(m.model.parameters).toBe("1.5B");
    expect(m.hashes).toBeDefined();
    expect(m.hashes.datasetHash.length).toBeGreaterThan(0);
  });

  it("serialises and deserialises", () => {
    const m = new VersionManifestBuilder()
      .setExperiment("rt")
      .setDataset({
        id: "x", version: "1.0.0", sampleCount: 0, trainCount: 0,
        validationCount: 0, testCount: 0, minQuality: 0, minConfidence: 0,
        splitStrategy: "x", paths: { train: "", validation: "", test: "" },
        generatedAt: "now", generatorVersion: "1",
      })
      .setGenome({ libraryVersion: "v1", totalEntries: 0, stylesAvailable: [], frozenAt: "now", source: "x", baseOpponent: "x" })
      .setTeacher({ kind: "v3_baseline", identifier: "x", fitness: 0, eloRating: 0, libraryVersion: "v1" })
      .setPrompt({ id: "v4", label: "x", notes: "", outputSchema: "intent" })
      .setModel({ family: "qwen", baseModel: "x", revision: "x", parameters: "1.5B", torchDtype: "bfloat16", contextLength: 4096, peft: { enabled: true, method: "qlora", r: 64, alpha: 128, dropout: 0.05, targetModules: [] }, quantization: { enabled: true, method: "4bit", quantType: "nf4" } })
      .setTrainingConfig({ epochs: 1, learningRate: 0.0001, perDeviceBatchSize: 1, gradientAccumulationSteps: 1, optim: "x", lrScheduler: "x", warmupRatio: 0, weightDecay: 0, seed: 0, bf16: true, fp16: false, tf32: true, maxSteps: null, reportTo: "x", saveSteps: 1, evalSteps: 1, groupByLength: true })
      .setDistillation({ method: "direct", n: 1, temperature: 0.4, qualityEngine: "x", replayEvaluator: "x" })
      .build();
    const json = serializeManifest(m);
    const rt = deserializeManifest(json);
    expect(rt.dataset.id).toBe(m.dataset.id);
    expect(rt.model.parameters).toBe(m.model.parameters);
  });

  it("uuid4 generates unique ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(uuid4());
    }
    expect(ids.size).toBe(100);
  });
});
