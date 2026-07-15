// ============================================================================
// OFFLINE EVOLUTION RUNNER
//
// Runs the genetic algorithm and exports ChampionGenome.json.
// This script is safe to run in CI or local tooling; it never mutates runtime
// state and does not require the renderer or audio engine.
// ============================================================================

import { OPPONENTS } from "../src/lib/game/engine";
import {
  createEvolutionManager,
  FitnessEvaluator,
  MutationEngine,
  CrossoverEngine,
  EvolutionReport,
  CHAMPION_GENOME_FILENAME,
} from "../src/lib/game/evolution";
import fs from "fs";
import path from "path";

const CONFIG = {
  populationSize: 12,
  generations: 10,
  elitismCount: 1,
  tournamentSize: 3,
  mutation: {
    ...MutationEngine.defaultConfig(),
    rate: 0.2,
    magnitude: 0.15,
  },
  crossover: CrossoverEngine.defaultConfig(),
  fitness: FitnessEvaluator.defaultWeights(),
  lineageSize: 3,
  earlyStoppingPatience: 8,
  earlyStoppingMinDelta: 0.005,
  randomRestartInterval: 0,
  randomRestartFraction: 0.25,
  diversityThreshold: 0.04,
} as const;

async function main() {
  console.log("[Eternal Evolution] Starting offline GA...");
  console.log(`Population: ${CONFIG.populationSize}, Generations: ${CONFIG.generations}`);

  const manager = createEvolutionManager(CONFIG, 0);
  const start = Date.now();
  const champion = await manager.run();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\nEvolution complete in ${elapsed}s`);
  console.log("Champion:", champion.id);
  console.log("Generation:", champion.generation);
  console.log("Fitness:", champion.fitness?.toFixed(4));
  console.log("Source:", champion.source);

  const report = new EvolutionReport({
    config: CONFIG,
    snapshots: manager.getSnapshots(),
    champion,
    lineage: manager.getLineage(),
    mutationHistory: manager.getMutationHistory(),
    evaluations: manager.getEvaluations(),
  });

  const outDir = path.resolve(process.cwd());
  const genomePath = path.join(outDir, CHAMPION_GENOME_FILENAME);
  const reportPath = path.join(outDir, "EvolutionReport.json");

  fs.writeFileSync(genomePath, report.serializeChampion(), "utf-8");
  fs.writeFileSync(reportPath, report.serialize(), "utf-8");

  console.log("\nExported:");
  console.log(" -", genomePath);
  console.log(" -", reportPath);

  console.log("\nFitness trajectory:");
  for (const s of report.getFitnessGraphData()) {
    console.log(`  Gen ${s.generation.toString().padStart(2)} | best ${s.best.toFixed(4)} | avg ${s.average.toFixed(4)} | div ${s.diversity.toFixed(3)}`);
  }
}

main().catch((err) => {
  console.error("[Eternal Evolution] Failed:", err);
  process.exit(1);
});
