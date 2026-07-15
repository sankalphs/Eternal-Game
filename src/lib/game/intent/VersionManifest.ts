// ============================================================================
// PROJECT ETERNAL — VERSIONING
//
// Every artifact in the fine-tuning pipeline has a version. The
// versions are stored together as a VersionManifest. This is the
// single source of truth for "what was used to produce this run".
//
// Versioned artifacts:
//   - Dataset Version
//   - Genome Version
//   - Teacher Version
//   - Prompt Version
//   - Model Version
//   - Training Config Version
//   - Distillation Version
//   - Experiment Version
//
// Every exported checkpoint, every exported dataset, and every
// training run carries a VersionManifest. The manifest is JSON and
// is human-readable.
// ============================================================================

import * as crypto from "node:crypto";

// --------------------------------------------------------------------------
//  Version manifest
// --------------------------------------------------------------------------

export interface VersionManifest {
  manifestVersion: string;            // e.g. "1.0.0"
  generatedAt: string;                // ISO timestamp
  experimentId: string;               // UUID-like
  experimentName: string;             // human label

  dataset: DatasetVersion;
  genome: GenomeVersion;
  teacher: TeacherVersion;
  prompt: PromptVersion;
  model: ModelVersion;
  trainingConfig: TrainingConfigVersion;
  distillation: DistillationVersion;
  experiment: ExperimentVersion;

  // Hashes for reproducibility
  hashes: {
    datasetHash: string;
    configHash: string;
    codeHash: string;
  };
}

export interface DatasetVersion {
  id: string;                         // e.g. "eternal-intent-dataset-v1"
  version: string;                    // semver
  sampleCount: number;
  trainCount: number;
  validationCount: number;
  testCount: number;
  minQuality: number;
  minConfidence: number;
  splitStrategy: string;
  paths: { train: string; validation: string; test: string };
  generatedAt: string;
  generatorVersion: string;           // version of MassiveDatasetGenerator
}

export interface GenomeVersion {
  libraryVersion: string;             // e.g. "v1", "v2"
  totalEntries: number;
  stylesAvailable: string[];
  frozenAt: string;
  source: string;                     // path or "auto-evolved"
  baseOpponent: string;
}

export interface TeacherVersion {
  kind: "frozen_champion" | "distilled_teacher" | "v3_baseline" | "v4_wrapper" | "human";
  identifier: string;                 // genome id, model id, etc.
  fitness: number;
  eloRating: number;
  libraryVersion: string;             // e.g. "v1"
}

export interface PromptVersion {
  id: string;                         // e.g. "v4"
  label: string;                      // human label
  notes: string;
  outputSchema: string;               // "intent" or JSON.stringify(schema)
}

export interface ModelVersion {
  family: string;                     // "gemma3" | "qwen" | ...
  baseModel: string;                  // HF model id
  revision: string;
  parameters: string;                 // "270M" | "1B" | ...
  torchDtype: string;
  contextLength: number;
  peft: {
    enabled: boolean;
    method: "lora" | "qlora" | "full_ft";
    r: number;
    alpha: number;
    dropout: number;
    targetModules: string[];
  };
  quantization: {
    enabled: boolean;
    method: "4bit" | "8bit" | "none";
    quantType: string;
  };
}

export interface TrainingConfigVersion {
  epochs: number;
  learningRate: number;
  perDeviceBatchSize: number;
  gradientAccumulationSteps: number;
  optim: string;
  lrScheduler: string;
  warmupRatio: number;
  weightDecay: number;
  seed: number;
  bf16: boolean;
  fp16: boolean;
  tf32: boolean;
  maxSteps: number | null;
  reportTo: string;
  saveSteps: number;
  evalSteps: number;
  groupByLength: boolean;
}

export interface DistillationVersion {
  method: "offline_best_of_n" | "replay_evaluated" | "active_learning" | "direct";
  n: number;                          // candidates per sample (best-of-N)
  temperature: number;
  qualityEngine: string;              // version of IntentQualityEngine
  replayEvaluator: string;             // version of ReplayEvaluator
}

export interface ExperimentVersion {
  id: string;
  name: string;
  seed: number;
  gitCommit: string | null;           // git commit hash if available
  wandbRunId: string | null;
  wandbRunUrl: string | null;
  modalAppId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: "running" | "succeeded" | "failed" | "cancelled";
  notes: string;
}

// --------------------------------------------------------------------------
//  Builder
// --------------------------------------------------------------------------

export class VersionManifestBuilder {
  private m: Partial<VersionManifest> = {};

  constructor() {
    this.m.manifestVersion = "1.0.0";
    this.m.generatedAt = new Date().toISOString();
    this.m.experimentId = uuid4();
  }

  setExperiment(name: string): this {
    this.m.experimentName = name;
    return this;
  }

  setDataset(d: DatasetVersion): this {
    this.m.dataset = d;
    return this;
  }

  setGenome(g: GenomeVersion): this {
    this.m.genome = g;
    return this;
  }

  setTeacher(t: TeacherVersion): this {
    this.m.teacher = t;
    return this;
  }

  setPrompt(p: PromptVersion): this {
    this.m.prompt = p;
    return this;
  }

  setModel(m: ModelVersion): this {
    this.m.model = m;
    return this;
  }

  setTrainingConfig(t: TrainingConfigVersion): this {
    this.m.trainingConfig = t;
    return this;
  }

  setDistillation(d: DistillationVersion): this {
    this.m.distillation = d;
    return this;
  }

  setExperimentMeta(e: Partial<ExperimentVersion>): this {
    this.m.experiment = {
      id: e.id ?? this.m.experimentId ?? uuid4(),
      name: e.name ?? this.m.experimentName ?? "unnamed",
      seed: e.seed ?? 42,
      gitCommit: e.gitCommit ?? null,
      wandbRunId: e.wandbRunId ?? null,
      wandbRunUrl: e.wandbRunUrl ?? null,
      modalAppId: e.modalAppId ?? null,
      startedAt: e.startedAt ?? new Date().toISOString(),
      endedAt: e.endedAt ?? null,
      status: e.status ?? "running",
      notes: e.notes ?? "",
    };
    return this;
  }

  build(): VersionManifest {
    // Compute hashes
    const datasetHash = hash(JSON.stringify(this.m.dataset ?? {}));
    const configHash = hash(JSON.stringify({
      prompt: this.m.prompt,
      model: this.m.model,
      trainingConfig: this.m.trainingConfig,
      distillation: this.m.distillation,
    }));
    const codeHash = hash(JSON.stringify({ ts: Date.now() }));

    this.m.hashes = { datasetHash, configHash, codeHash };

    // Fill any missing required fields
    if (!this.m.dataset) throw new Error("VersionManifest: dataset is required");
    if (!this.m.genome) throw new Error("VersionManifest: genome is required");
    if (!this.m.teacher) throw new Error("VersionManifest: teacher is required");
    if (!this.m.prompt) throw new Error("VersionManifest: prompt is required");
    if (!this.m.model) throw new Error("VersionManifest: model is required");
    if (!this.m.trainingConfig) throw new Error("VersionManifest: trainingConfig is required");
    if (!this.m.distillation) throw new Error("VersionManifest: distillation is required");
    if (!this.m.experiment) this.setExperimentMeta({});

    return this.m as VersionManifest;
  }
}

// --------------------------------------------------------------------------
//  (De)serialisation
// --------------------------------------------------------------------------

export function serializeManifest(m: VersionManifest): string {
  return JSON.stringify(m, null, 2);
}

export function deserializeManifest(json: string): VersionManifest {
  return JSON.parse(json);
}

// --------------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------------

function hash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function uuid4(): string {
  // RFC 4122 v4 — uses crypto.randomUUID if available
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
