// ============================================================================
// SIMULATOR RUNNER
//
// Runs N headless simulations through the GameEngine, collects a
// configurable sample rate via the DatasetSink, persists a
// checkpointable run, and writes:
//   - sim-report.md         (Markdown benchmark + per-fight histogram)
//   - sim-report.json       (full metrics + leaderboard)
//   - sim-report.csv        (per-report row)
//   - samples.jsonl         (SinkSample stream, one JSON per line)
//   - sim-summary.txt       (one-line run summary)
//
// Usage:
//   bun scripts/run-simulator.ts                # default 100_000 fights
//   bun scripts/run-simulator.ts 250000         # 250k fights
//   bun scripts/run-simulator.ts 1000000 0.05   # 1M fights, 5% sample rate
//
// All existing systems are reused. Nothing in the engine is modified.
// ============================================================================

import fs from "fs";
import path from "path";
import {
  SimulationRunner,
  BatchExecutor,
  BenchmarkSuite,
  CheckpointStore,
  InMemoryIO,
  DatasetSink,
  buildReportBundle,
  defaultOpponent,
  type RunFightParams,
  type BenchmarkReport,
  type MatchTypeId,
} from "../src/lib/game/simulator";
import { createAgentById } from "../src/lib/game/evolution/agents";
import {
  IGenome,
  createDefaultGenome,
  createRandomGenome,
} from "../src/lib/game/evolution";
import { Rng } from "../src/lib/game/simulator/Rng";

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

const TOTAL = Number(process.argv[2] ?? 100_000);
const SAMPLE_RATE = Number(process.argv[3] ?? 0.05);
const SEED = Number(process.argv[4] ?? 42);
const MATCH_TYPE: MatchTypeId = (process.argv[5] as MatchTypeId) ?? "ga_vs_archetype";
const OUT_DIR = path.resolve(process.cwd(), "tool-results", `sim-${Date.now()}`);

console.log("========================================================");
console.log("  SIMULATOR — large-scale headless research runner");
console.log("========================================================");
console.log(`  Total fights    : ${TOTAL.toLocaleString()}`);
console.log(`  Sample rate     : ${(SAMPLE_RATE * 100).toFixed(1)}%`);
console.log(`  Master seed     : ${SEED}`);
console.log(`  Match type      : ${MATCH_TYPE}`);
console.log(`  Output dir      : ${OUT_DIR}`);
console.log("========================================================");

// ----------------------------------------------------------------------------
// Setup
// ----------------------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true });

// 1. Build a few canonical subjects to fight
function makeSubject(id: string, seed: number): IGenome {
  const rng = new Rng(seed);
  const g = createRandomGenome(() => rng.next(), 0);
  g.id = id;
  g.source = "seed";
  return g;
}

// Diverse subject pool — 5 different genomes covering the behaviour space
const subjects: IGenome[] = [
  makeSubject("aggressive-rusher", SEED + 1),
  makeSubject("defensive-turtle", SEED + 2),
  makeSubject("counter-punisher", SEED + 3),
  makeSubject("adaptive-mixer", SEED + 4),
  makeSubject("pressure-comboer", SEED + 5),
];

// Persist the subject roster for reproducibility
fs.writeFileSync(
  path.join(OUT_DIR, "subjects.json"),
  JSON.stringify(subjects, null, 2),
);

// 2. Build the runner + executor + sink
const runner = new SimulationRunner();
const exec = new BatchExecutor(runner);

// 3. Dataset sink — every emitted sample is also written to JSONL
const samplePath = path.join(OUT_DIR, "samples.jsonl");
const sampleStream = fs.createWriteStream(samplePath, { flags: "w" });
let samplesWritten = 0;
const sink = new DatasetSink(
  {
    kinds: ["training", "evaluation", "benchmark", "active_learning"],
    rate: SAMPLE_RATE,
    maxRetained: 0, // don't retain in memory — we stream to disk
    onSample: (kind, sample) => {
      const { kind: _k, ...rest } = sample;
      void _k;
      const row = { kind, ...rest };
      sampleStream.write(JSON.stringify(row) + "\n");
      samplesWritten++;
    },
  },
  SEED ^ 0x5a17,
);
sink.attach(runner);

// 4. Checkpoint store (in-memory; we write to disk at the end)
const store = new CheckpointStore(new InMemoryIO(), false);
let lastCheckpoint: any = null;

// 5. Build the factory — cycles through subjects × archetypes
const ARCHETYPE_IDS = [
  "aggressive", "defensive", "counter", "combo", "risky", "passive",
  "jumper", "roll_spam", "beginner", "speedrunner", "turtle", "random",
  "super_saver", "footsies", "whiff_punisher",
];
const NUM_SUBJECTS = subjects.length;
const MATCHUPS_PER_SUBJECT = Math.max(1, Math.floor(TOTAL / NUM_SUBJECTS));

// Subject-vs-archetype factory: cycles subjectIdx × archetypeIdx
function factory(i: number, seed: number): RunFightParams {
  const subjectIdx = i % NUM_SUBJECTS;
  const archetypeIdx = Math.floor(i / NUM_SUBJECTS) % ARCHETYPE_IDS.length;
  const subject = subjects[subjectIdx]!;
  const archetypeId = ARCHETYPE_IDS[archetypeIdx]!;
  return {
    sideA: subject,
    sideB: defaultOpponent(0),
    sideAAgent: undefined,
    sideBAgent: createAgentById(archetypeId),
    seed,
    matchType: MATCH_TYPE,
    config: {
      baseOpponentIndex: 0,
      fastRoundTransitions: true,
      drainVfx: true,
      deterministic: true,
      timeStep: 1 / 60,
    },
    meta: {
      subjectId: subject.id,
      archetypeId,
      matchType: MATCH_TYPE,
    },
  };
}

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------

const startedAt = Date.now();
let lastReport = "";

async function main() {
  const result = await exec.run({
    seed: SEED,
    total: TOTAL,
    factory,
    matchType: MATCH_TYPE,
    sideAId: "subjects",
    sideBId: "archetypes",
    checkpointEvery: Math.max(1000, Math.floor(TOTAL / 50)),
    progressEvery: Math.max(500, Math.floor(TOTAL / 200)),
    chunkSize: 500,
    checkpoint: async (state) => {
      lastCheckpoint = state;
      // Persist every checkpoint as a small JSON file
      const cpPath = path.join(OUT_DIR, `checkpoint-${String(state.nextIndex).padStart(8, "0")}.json`);
      await store.save(cpPath.replace(/\.json$/, ""), state);
    },
    onProgress: (p) => {
      const pct = ((p.current / p.total) * 100).toFixed(1);
      const line = `[${pct.padStart(5, " ")}%] ${p.current.toLocaleString()}/${p.total.toLocaleString()} fights  |  ${p.fightsPerSecond.toFixed(0)} fights/s  |  ETA ${(p.estimatedRemainingMs / 1000).toFixed(0)}s  |  checkpoints=${p.checkpointCount}`;
      process.stdout.write("\r" + line.padEnd(120, " "));
      lastReport = line;
    },
  });

  process.stdout.write("\n");
  const wallMs = Date.now() - startedAt;
  const throughput = wallMs > 0 ? (result.series.fights.length / wallMs) * 1000 : 0;

  console.log("");
  console.log("--------------------------------------------------------");
  console.log("  Run complete");
  console.log("--------------------------------------------------------");
  console.log(`  Fights completed : ${result.series.fights.length.toLocaleString()}`);
  console.log(`  Wall time        : ${(wallMs / 1000).toFixed(2)}s`);
  console.log(`  Throughput       : ${throughput.toFixed(0)} fights/s`);
  console.log(`  Speed-vs-realtime: ${(throughput * 30 / 60).toFixed(1)}x (vs 60fps real-time cap)`);
  console.log(`  Checkpoints      : ${result.checkpointsWritten}`);
  console.log(`  Samples emitted  : ${samplesWritten.toLocaleString()}`);
  console.log(`  Total sim seconds: ${result.series.aggregate.totalSimSeconds.toFixed(0)}s`);
  console.log("--------------------------------------------------------");

  sink.detach(runner);
  sampleStream.end();

  // 6. Benchmark each subject (small N — 200 per subject) for the report
  console.log("\nGenerating per-subject benchmarks (200 fights each)...");
  const bench = new BenchmarkSuite(runner);
  const reports: BenchmarkReport[] = [];
  for (const subj of subjects) {
    // Cycle through archetypes to mirror the main run, so the benchmark
    // isn't two-AI standoff (which times out).
    const matches: RunFightParams[] = [];
    const benchArchetypes = ARCHETYPE_IDS.slice(0, 5);
    for (let i = 0; i < 200; i++) {
      const a = benchArchetypes[i % benchArchetypes.length]!;
      matches.push({
        sideA: subj,
        sideB: defaultOpponent(0),
        sideAAgent: undefined,
        sideBAgent: createAgentById(a),
        seed: (SEED + 100 + i) >>> 0,
        matchType: MATCH_TYPE,
        config: {
          baseOpponentIndex: 0,
          fastRoundTransitions: true,
          drainVfx: true,
          deterministic: true,
          timeStep: 1 / 30,
        },
        meta: { subjectId: subj.id, archetypeId: a, matchType: MATCH_TYPE },
      });
    }
    const series = runner.runBatch({ matches });
    const report: BenchmarkReport = {
      subject: `genome:${subj.id}`,
      opponent: "archetype-pool",
      n: series.fights.length,
      generatedAt: Date.now(),
      metrics: bench.computeMetrics(series),
      notes: `archetype-pool — 5 archetypes × 40 each`,
    };
    reports.push(report);
  }

  // 7. Persist the reports
  const bundle = buildReportBundle(reports, [result.series]);
  fs.writeFileSync(path.join(OUT_DIR, "sim-report.md"), bundle.markdown, "utf-8");
  fs.writeFileSync(path.join(OUT_DIR, "sim-report.json"), bundle.json, "utf-8");
  fs.writeFileSync(path.join(OUT_DIR, "sim-report.csv"), bundle.csv, "utf-8");
  fs.writeFileSync(
    path.join(OUT_DIR, "sim-series.csv"),
    bundle.seriesCsv[0]?.csv ?? "",
    "utf-8",
  );

  // 8. Write the one-line summary
  const summary = [
    `fights=${result.series.fights.length}`,
    `wallMs=${wallMs}`,
    `throughput=${throughput.toFixed(2)}`,
    `samples=${samplesWritten}`,
    `simSeconds=${result.series.aggregate.totalSimSeconds.toFixed(0)}`,
    `checkpoints=${result.checkpointsWritten}`,
  ].join(" ");
  fs.writeFileSync(path.join(OUT_DIR, "sim-summary.txt"), summary, "utf-8");

  // 9. Also dump the per-aggregate result for fast loading
  fs.writeFileSync(
    path.join(OUT_DIR, "aggregate.json"),
    JSON.stringify(result.series.aggregate, null, 2),
    "utf-8",
  );

  // 10. Cleanup checkpoint files (they can be large; keep only the last)
  if (lastCheckpoint) {
    const allCp = fs.readdirSync(OUT_DIR).filter(f => f.startsWith("checkpoint-"));
    for (const f of allCp) {
      if (f !== `checkpoint-${String(lastCheckpoint.nextIndex).padStart(8, "0")}.json`) {
        try { fs.unlinkSync(path.join(OUT_DIR, f)); } catch {}
      }
    }
  }

  // 11. Console summary
  console.log("\nOutput files:");
  for (const f of fs.readdirSync(OUT_DIR).sort()) {
    const stat = fs.statSync(path.join(OUT_DIR, f));
    console.log(`  ${f.padEnd(40, " ")} ${(stat.size / 1024).toFixed(1).padStart(10, " ")} KB`);
  }
  console.log(`\nDone. ${TOTAL.toLocaleString()} fights generated, ${samplesWritten.toLocaleString()} samples written.`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
