// ============================================================================
// RESEARCH DASHBOARD RUNNER
//
// End-to-end script: builds a subject pool of GA genomes, runs the
// benchmark, and produces every artefact the ResearchDashboard
// exports. Outputs:
//
//   - research-report.md       — unified Markdown report
//   - research-report.json     — full structured report
//   - elo-leaderboard.md       — Glicko-2 leaderboard
//   - elo-leaderboard.csv      — same in CSV
//   - matchup-matrix.csv       — NxN matrix (CSV)
//   - matchup-matrix.json      — NxN matrix (JSON)
//   - matchup-heatmap-spec.json — heatmap data
//   - pareto.csv               — Pareto frontier
//   - pareto-plot-spec.json    — Pareto plot spec
//   - clusters.json            — genome cluster assignments
//   - clusters-plot-spec.json  — PCA 2D plot spec
//   - survival.csv             — Kaplan-Meier
//   - survival-plot-spec.json  — survival plot spec
//
// Usage:
//   bun scripts/run-research-dashboard.ts                  # default 2000 fights
//   bun scripts/run-research-dashboard.ts 5000 25 5 kmeans # 5000 fights, 25 per cell, k=5
// ============================================================================

import fs from "fs/promises";
import path from "path";
import {
  ResearchDashboard,
  type Subject,
} from "../src/lib/game/research";
import { SimulationRunner } from "../src/lib/game/simulator";
import {
  createRandomGenome,
  type IGenome,
} from "../src/lib/game/evolution";
import { Rng } from "../src/lib/game/simulator/Rng";

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

const TOTAL = Number(process.argv[2] ?? 2000);
const CELL_MATCHES = Number(process.argv[3] ?? 20);
const CLUSTER_K = Number(process.argv[4] ?? 0); // 0 = auto
const CLUSTER_ALGO = (process.argv[5] ?? "kmeans") as "kmeans" | "hierarchical" | "dbscan";
const SEED = Number(process.argv[6] ?? 42);
const OUT_DIR = path.resolve(process.cwd(), "tool-results", `research-${Date.now()}`);

console.log("========================================================");
console.log("  RESEARCH DASHBOARD — publication-quality evaluation");
console.log("========================================================");
console.log(`  Total fights          : ${TOTAL.toLocaleString()}`);
console.log(`  Cell matches          : ${CELL_MATCHES}`);
console.log(`  Cluster K             : ${CLUSTER_K === 0 ? "auto" : CLUSTER_K}`);
console.log(`  Cluster algorithm     : ${CLUSTER_ALGO}`);
console.log(`  Master seed           : ${SEED}`);
console.log(`  Output dir            : ${OUT_DIR}`);
console.log("========================================================");

// ----------------------------------------------------------------------------
// Build subjects
// ----------------------------------------------------------------------------

function makeSubject(id: string, seed: number, label: string): Subject {
  const rng = new Rng(seed);
  const g = createRandomGenome(() => rng.next(), 0);
  g.id = id;
  g.source = "seed";
  // Force the genome to be identifiable by its label
  if (label === "aggressive") { g.aggression = 0.9; g.pressure = 0.9; g.reaction = 0.1; }
  if (label === "defensive") { g.aggression = 0.1; g.blockChance = 0.8; g.reaction = 0.2; }
  if (label === "counter") { g.whiffPunish = 0.95; g.perfection = 0.9; g.blockChance = 0.7; }
  if (label === "adaptive") { g.adaptive = 0.95; g.mixup = 0.9; g.reaction = 0.15; }
  if (label === "pressure") { g.pressure = 0.95; g.combo = 4; g.aggression = 0.7; }
  if (label === "turtle") { g.blockChance = 0.95; g.aggression = 0.05; g.reaction = 0.15; }
  if (label === "all-rounder") { /* keep random */ }
  return { id, name: label, kind: "ga_genome", version: "1.0.0", genome: g, description: `${label} genome` };
}

const subjects: Subject[] = [
  makeSubject("genome:aggressive", SEED + 1, "aggressive"),
  makeSubject("genome:defensive", SEED + 2, "defensive"),
  makeSubject("genome:counter", SEED + 3, "counter"),
  makeSubject("genome:adaptive", SEED + 4, "adaptive"),
  makeSubject("genome:pressure", SEED + 5, "pressure"),
  makeSubject("genome:turtle", SEED + 6, "turtle"),
  makeSubject("genome:all-rounder-A", SEED + 7, "all-rounder"),
  makeSubject("genome:all-rounder-B", SEED + 8, "all-rounder"),
];

console.log(`\nSubjects: ${subjects.length}`);
for (const s of subjects) console.log(`  - ${s.id} (${s.kind}, ${s.name})`);

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const runner = new SimulationRunner();
  const dashboard = new ResearchDashboard(runner, {
    benchmarkMatchesPerSubject: TOTAL / subjects.length,
    matchupMatchesPerCell: CELL_MATCHES,
    clusterK: CLUSTER_K,
    clusterAlgorithm: CLUSTER_ALGO,
  });
  const t0 = Date.now();
  const { report, files } = await dashboard.generateToDir(
    { subjects, seed: SEED, notes: "publication-quality evaluation run" },
    OUT_DIR,
  );
  const wallMs = Date.now() - t0;
  console.log(`\nDone in ${wallMs}ms. ${files.length} files written to ${OUT_DIR}`);
  for (const f of files) {
    const stat = await fs.stat(f);
    console.log(`  ${path.relative(OUT_DIR, f).padEnd(40, " ")} ${(stat.size / 1024).toFixed(1).padStart(10, " ")} KB`);
  }
  // Console summary
  console.log("\n========================================================");
  console.log("  SUMMARY");
  console.log("========================================================");
  console.log(`Experiment UUID : ${report.experiment.uuid}`);
  console.log(`Config hash     : ${report.experiment.configHash.slice(0, 16)}…`);
  console.log(`Git commit      : ${report.experiment.gitCommit ?? "—"}`);
  console.log(`Subjects        : ${subjects.length}`);
  console.log(`Benchmarks      : ${report.benchmarks.length}`);
  console.log(`Matchup cells   : ${report.matchupMatrix.cells.length}`);
  console.log(`Survival curves : ${report.survival.length}`);
  console.log(`Hazard ratios   : ${report.hazardRatios.length}`);
  console.log(`Pareto frontier : ${report.paretoFrontier.frontierIndices.length} / ${report.paretoFrontier.points.length}`);
  console.log(`Clusters        : ${report.clusters.k} (k=${report.clusters.algorithm})`);
  console.log(`Tests           : ${report.tests.length}`);
  console.log(`Performance     : ${report.performance.matchesPerSec.toFixed(1)} matches/s`);
  console.log("========================================================");
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
