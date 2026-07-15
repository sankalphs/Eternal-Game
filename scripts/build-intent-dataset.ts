// ============================================================================
// MASSIVE INTENT DATASET — BUILD SCRIPT
//
// Usage:
//   bun run scripts/build-intent-dataset.ts [--out <dir>] [--target <N>] [--frozen <path>] [--seed <N>]
//
// Generates 100,000+ IntentTrainingSamples and exports them as
// train.jsonl / validation.jsonl / test.jsonl + statistics + report.
// ============================================================================

import fs from "fs";
import path from "path";
import {
  DatasetBuildOrchestrator,
  type BuildOrchestratorConfig,
} from "../src/lib/game/intent";
import {
  GenomeFreezer,
  deserializeFrozenLibrary,
  type FrozenGenomeLibrary,
} from "../src/lib/game/evolution/FrozenGenomeLibrary";
import {
  GenomeLibrary,
} from "../src/lib/game/evolution/GenomeLibrary";
import { FitnessEvaluator, MutationEngine, CrossoverEngine } from "../src/lib/game/evolution";
import type { IEvolutionConfig, IGenomeLibrary } from "../src/lib/game/evolution/types";

function parseArgs(): { out: string; target: number; frozen?: string; seed: number; liveLibraryPath?: string } {
  const args = process.argv.slice(2);
  let out = "data/intent_dataset";
  let target = 100_000;
  let frozen: string | undefined;
  let liveLibraryPath: string | undefined;
  let seed = 42;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out" && args[i + 1]) { out = args[++i]; }
    else if (a === "--target" && args[i + 1]) { target = parseInt(args[++i], 10); }
    else if (a === "--frozen" && args[i + 1]) { frozen = args[++i]; }
    else if (a === "--live" && args[i + 1]) { liveLibraryPath = args[++i]; }
    else if (a === "--seed" && args[i + 1]) { seed = parseInt(args[++i], 10); }
  }
  return { out, target, frozen, seed, liveLibraryPath };
}

async function main() {
  const args = parseArgs();
  console.log(`[Intent Dataset] target=${args.target} out=${args.out} seed=${args.seed}`);

  // 1. Load (or evolve) a frozen library
  let frozen: FrozenGenomeLibrary | undefined;
  if (args.frozen) {
    const json = fs.readFileSync(args.frozen, "utf-8");
    frozen = deserializeFrozenLibrary(json);
    console.log(`[Intent Dataset] Loaded frozen library: ${frozen.version} (${Object.keys(frozen.entries).length} entries)`);
  } else {
    console.log("[Intent Dataset] No frozen library provided — building one with the default evolution run");
    const lib = await buildLiveLibrary();
    const freezer = new GenomeFreezer();
    frozen = freezer.freeze(lib, {
      version: "v1",
      baseOpponent: lib.baseOpponent,
      seedBase: 0,
      configHash: "default",
      notes: "auto-built frozen library for dataset generation",
      eloRatings: {},
      topNPerStyle: 1,
    });
    // Persist it
    const outPath = path.join(args.out, "GenomeLibrary_v1.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(frozen, null, 2), "utf-8");
    console.log(`[Intent Dataset] Wrote frozen library: ${outPath}`);
  }

  // 2. Optionally load a live library too
  let liveLibrary: IGenomeLibrary | undefined;
  if (args.liveLibraryPath) {
    const json = fs.readFileSync(args.liveLibraryPath, "utf-8");
    liveLibrary = JSON.parse(json);
  }

  // 3. Run the orchestrator
  const config: BuildOrchestratorConfig = {
    generation: {
      targetSamples: args.target,
      // Scale syntheticContexts with the target. We need at least
      // 4x the target contexts because each pipeline gets a different
      // range and we need to avoid overlap.
      syntheticContexts: Math.max(args.target * 4, 500_000),
      seed: args.seed,
      frozenLibrary: frozen,
      liveLibrary,
    },
    export: {
      seed: args.seed,
    },
    outputDir: args.out,
    frozenLibrary: frozen,
    liveLibrary,
  };

  const orchestrator = new DatasetBuildOrchestrator(config);
  const result = await orchestrator.run();

  console.log(`[Intent Dataset] Generated: ${result.generationReport.totalGenerated}`);
  console.log(`[Intent Dataset] Kept:      ${result.generationReport.totalKept}`);
  console.log(`[Intent Dataset] Train:     ${result.exportStats.train}`);
  console.log(`[Intent Dataset] Valid:     ${result.exportStats.validation}`);
  console.log(`[Intent Dataset] Test:      ${result.exportStats.test}`);
  console.log(`[Intent Dataset] Avg quality: ${result.exportStats.avgQuality.toFixed(3)}`);
  console.log(`[Intent Dataset] Ready:     ${result.readiness.readyForFineTuning ? "YES" : "NO"}`);
  if (!result.readiness.readyForFineTuning) {
    for (const issue of result.readiness.issues) {
      console.log(`  [ISSUE] ${issue}`);
    }
  }
  for (const rec of result.readiness.recommendations) {
    console.log(`  [REC]   ${rec}`);
  }
  console.log(`[Intent Dataset] Files written to: ${args.out}`);
}

async function buildLiveLibrary() {
  const config: IEvolutionConfig = {
    populationSize: 10,
    generations: 4,
    elitismCount: 1,
    tournamentSize: 3,
    mutation: MutationEngine.defaultConfig(),
    crossover: CrossoverEngine.defaultConfig(),
    fitness: FitnessEvaluator.defaultWeights(),
    lineageSize: 3,
    earlyStoppingPatience: 6,
    earlyStoppingMinDelta: 0.005,
    randomRestartInterval: 0,
    randomRestartFraction: 0.2,
    diversityThreshold: 0.04,
    generateDataset: false,
  };
  const lib = new GenomeLibrary({ baseConfig: config, baseOpponentIndex: 0 });
  return lib.evolve();
}

main().catch((err) => {
  console.error("[Intent Dataset] Fatal:", err);
  process.exit(1);
});
