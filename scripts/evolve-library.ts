// ============================================================================
// GENOME LIBRARY RUNNER
//
// Evolves a full library of Pareto-optimal styles and exports them to
// champions/*.json. Run this offline; it does not mutate runtime state.
// ============================================================================

import fs from "fs";
import path from "path";
import {
  FitnessEvaluator,
  MutationEngine,
  CrossoverEngine,
  GenomeLibrary,
  CHAMPION_GENOME_FILENAME,
  type IEvolutionConfig,
} from "../src/lib/game/evolution";

const CONFIG: IEvolutionConfig = {
  populationSize: 16,
  generations: 24,
  elitismCount: 2,
  tournamentSize: 4,
  mutation: MutationEngine.defaultConfig(),
  crossover: CrossoverEngine.defaultConfig(),
  fitness: FitnessEvaluator.defaultWeights(),
  lineageSize: 4,
  earlyStoppingPatience: 10,
  earlyStoppingMinDelta: 0.002,
  randomRestartInterval: 8,
  randomRestartFraction: 0.25,
  diversityThreshold: 0.05,
  generateDataset: false,
};

async function main() {
  console.log("[Eternal Library] Evolving Pareto-optimal genome library...");

  const library = new GenomeLibrary({ baseConfig: CONFIG, baseOpponentIndex: 0 });
  const result = await library.evolve();

  const outDir = path.resolve(process.cwd(), "champions");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const [style, entry] of Object.entries(result.entries)) {
    const filename = `${style}.json`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(entry.genome, null, 2), "utf-8");
    console.log(`  ${filename} — fitness ${entry.genome.fitness?.toFixed(4)} — ${entry.narrative}`);
  }

    const manifestPath = path.join(outDir, "library.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: result.version,
        exportedAt: result.exportedAt,
        baseOpponent: result.baseOpponent,
        entries: result.entries,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`\nExported library manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error("[Eternal Library] Failed:", err);
  process.exit(1);
});
