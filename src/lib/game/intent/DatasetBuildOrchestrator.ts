// ============================================================================
// PROJECT ETERNAL — DATASET BUILD ORCHESTRATOR
//
// Single entry point that runs the full pipeline:
//
//   1. Build (or load) a frozen genome library
//   2. Generate synthetic contexts
//   3. Run all 11 generation pipelines
//   4. Filter + grade + dedup
//   5. Stratified split
//   6. Export train / validation / test JSONL + stats + report
//
// The orchestrator is what scripts/dataset_build.ts calls. It is also
// the entry point used by the Modal training pipeline (modal_train.py)
// to validate the dataset before training.
// ============================================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { MassiveDatasetGenerator, DEFAULT_DATASET_CONFIG, type DatasetGenerationConfig, type DatasetGenerationReport } from "./MassiveDatasetGenerator";
import { MassiveDatasetExporter, DEFAULT_EXPORT_CONFIG, type ExportConfig } from "./MassiveDatasetExporter";
import type { IntentTrainingSample } from "./IntentTrainingSample";
import {
  GenomeFreezer,
  deserializeFrozenLibrary,
  type FrozenGenomeLibrary,
  frozenLibraryFilename,
} from "../evolution/FrozenGenomeLibrary";
import type { IGenomeLibrary } from "../evolution/types";

export interface BuildOrchestratorConfig {
  generation: Partial<DatasetGenerationConfig>;
  export: Partial<ExportConfig>;
  outputDir: string;
  // Optional: pre-built frozen library (skip freezing)
  frozenLibrary?: FrozenGenomeLibrary;
  // Optional: pre-built live library
  liveLibrary?: IGenomeLibrary;
  // Optional: path to a frozen library JSON file
  frozenLibraryPath?: string;
  // Optional: previous frozen library to carry lineage
  previousFrozenLibrary?: FrozenGenomeLibrary;
}

export interface BuildOrchestratorResult {
  samples: IntentTrainingSample[];
  generationReport: DatasetGenerationReport;
  exportStats: import("./MassiveDatasetExporter").DatasetStats;
  files: {
    trainJsonl: string;
    validationJsonl: string;
    testJsonl: string;
    statisticsJson: string;
    reportJson: string;
    readme: string;
  };
  readiness: import("./MassiveDatasetExporter").ExportedDataset["readiness"];
}

export class DatasetBuildOrchestrator {
  private config: BuildOrchestratorConfig;

  constructor(config: BuildOrchestratorConfig) {
    this.config = config;
  }

  async run(): Promise<BuildOrchestratorResult> {
    // 1. Load frozen library (or skip if provided)
    let frozen: FrozenGenomeLibrary | undefined = this.config.frozenLibrary;
    if (!frozen && this.config.frozenLibraryPath) {
      const json = await fs.readFile(this.config.frozenLibraryPath, "utf-8");
      frozen = deserializeFrozenLibrary(json);
    }

    // 2. Run the generator
    const generator = new MassiveDatasetGenerator({
      ...this.config.generation,
      frozenLibrary: frozen,
      liveLibrary: this.config.liveLibrary,
    });
    const { samples, report } = await generator.generate();

    // 3. Export
    const exporter = new MassiveDatasetExporter(this.config.export);
    const exported = exporter.export(samples);

    // 4. Write to disk
    const outputDir = this.config.outputDir;
    await fs.mkdir(outputDir, { recursive: true });

    const files = {
      trainJsonl: path.join(outputDir, "train.jsonl"),
      validationJsonl: path.join(outputDir, "validation.jsonl"),
      testJsonl: path.join(outputDir, "test.jsonl"),
      statisticsJson: path.join(outputDir, "statistics.json"),
      reportJson: path.join(outputDir, "dataset_report.json"),
      readme: path.join(outputDir, "README.md"),
    };

    await Promise.all([
      fs.writeFile(files.trainJsonl, exported.trainJsonl, "utf-8"),
      fs.writeFile(files.validationJsonl, exported.validationJsonl, "utf-8"),
      fs.writeFile(files.testJsonl, exported.testJsonl, "utf-8"),
      fs.writeFile(files.statisticsJson, exported.statisticsJson, "utf-8"),
      fs.writeFile(files.reportJson, exported.reportJson, "utf-8"),
      fs.writeFile(files.readme, exported.readme, "utf-8"),
    ]);

    return {
      samples,
      generationReport: report,
      exportStats: exported.stats,
      files,
      readiness: exported.readiness,
    };
  }
}
