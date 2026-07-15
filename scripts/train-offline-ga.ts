import {
  defaultOfflineEvolutionConfig,
  OfflineEvolutionTrainer,
} from "../src/lib/game/offline-ga";

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid --${name} value: ${raw}`);
  return parsed;
}

function stringArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function main() {
  const defaults = defaultOfflineEvolutionConfig();
  const trainer = new OfflineEvolutionTrainer({
    config: {
      populationSize: numberArg("population", defaults.populationSize),
      generations: numberArg("generations", defaults.generations),
      maxGenerations: numberArg("max-generations", defaults.maxGenerations),
      matchesPerGenome: numberArg("matches", defaults.matchesPerGenome),
      mutationRate: numberArg("mutation-rate", defaults.mutationRate),
      mutationStdDev: numberArg("mutation-stddev", defaults.mutationStdDev),
      crossoverRate: numberArg("crossover-rate", defaults.crossoverRate),
      validationWinRateThreshold: numberArg("validation-threshold", defaults.validationWinRateThreshold),
      validationMatchesPerBaseline: numberArg("validation-matches", defaults.validationMatchesPerBaseline),
      seed: numberArg("seed", defaults.seed),
      parallelism: numberArg("parallelism", defaults.parallelism),
      outputPath: stringArg("output", defaults.outputPath),
      checkpointDir: stringArg("checkpoint-dir", defaults.checkpointDir),
    },
  });

  if (process.argv.includes("--resume")) {
    const loaded = trainer.loadLatestCheckpoint();
    console.log(loaded ? "[offline-ga] resumed latest checkpoint" : "[offline-ga] no checkpoint found; starting fresh");
  }

  const result = await trainer.run();
  console.log(`[offline-ga] accepted=${result.accepted}`);
  console.log(`[offline-ga] best=${result.bestGenome.id} fitness=${(result.bestGenome.fitness ?? 0).toFixed(4)}`);
  console.log(`[offline-ga] output=${result.outputPath}`);
  for (const baseline of result.validationReport.results) {
    console.log(`  ${baseline.baselineName}: ${(baseline.winRate * 100).toFixed(1)}%`);
  }
}

main().catch((error) => {
  console.error("[offline-ga] failed", error);
  process.exit(1);
});
