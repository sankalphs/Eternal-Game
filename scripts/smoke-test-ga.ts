// Quick smoke test - run a tiny GA training to verify infrastructure works
import { OfflineEvolutionTrainer, defaultOfflineEvolutionConfig } from "../src/lib/game/offline-ga";

async function main() {
  console.log("[smoke-test] Starting tiny GA training run...");
  const trainer = new OfflineEvolutionTrainer({
    config: {
      populationSize: 6,
      generations: 2,
      maxGenerations: 2,
      matchesPerGenome: 1,
      seed: 42,
      outputPath: "data/smoke_test_best.json",
      checkpointDir: "data/smoke_test_ckpt",
      parallelism: 1,
    },
  });
  const t0 = Date.now();
  const result = await trainer.run();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[smoke-test] Completed in ${elapsed}s`);
  console.log(`[smoke-test] best fitness = ${(result.bestGenome.fitness ?? 0).toFixed(4)}`);
  console.log(`[smoke-test] stats length = ${result.stats.length}`);
  console.log(`[smoke-test] generations recorded:`);
  for (const s of result.stats) {
    console.log(`  gen ${s.generation}: best=${s.bestFitness.toFixed(4)} avg=${s.averageFitness.toFixed(4)} div=${s.diversity.toFixed(4)}`);
  }
}

main().catch((e) => {
  console.error("[smoke-test] FAILED:", e);
  process.exit(1);
});
