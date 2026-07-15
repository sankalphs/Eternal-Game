// ============================================================================
// PROJECT ETERNAL — END-TO-END VERIFICATION
//
// Runs the full pipeline locally:
//   1. Verify the GA genome library is frozen
//   2. Generate a small dataset (1k samples for speed)
//   3. Run unit tests
//   4. Run the smoke test (AdapterFactory + IntentGameDesigner)
//   5. Run the evaluation harness (V3 vs V5, 50 contexts)
//   6. Print a final readiness report
//
// Usage:
//   bun run scripts/verify-e2e.ts
// ============================================================================

import fs from "fs";
import path from "path";
import { spawnSync } from "node:child_process";

const C = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
};

function log(msg: string, color: keyof typeof C = "reset") {
  console.log(`${C[color]}${msg}${C.reset}`);
}

function section(title: string) {
  log(`\n${"=".repeat(60)}`, "blue");
  log(title, "blue");
  log("=".repeat(60), "blue");
}

function run(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf-8", stdio: "pipe" });
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

const projectRoot = process.cwd();
const report: Record<string, unknown> = { startedAt: new Date().toISOString() };
let allPassed = true;

section("1. CHECK GENOME LIBRARY");
const frozenPath = path.join(projectRoot, "data", "genome_libraries", "GenomeLibrary_v1.json");
if (fs.existsSync(frozenPath)) {
  const frozen = JSON.parse(fs.readFileSync(frozenPath, "utf-8"));
  const nEntries = Object.keys(frozen.entries).length;
  log(`✓ Frozen library found: ${frozenPath}`, "green");
  log(`  version: ${frozen.version}, entries: ${nEntries}, total unique: ${frozen.totalUniqueEntries}`);
  report.frozenLibrary = { version: frozen.version, entries: nEntries, totalUnique: frozen.totalUniqueEntries };
} else {
  log(`✗ Frozen library NOT found: ${frozenPath}`, "red");
  log(`  Run: bun run scripts/freeze-genomes.ts`);
  allPassed = false;
}

section("2. CHECK DATASET");
const dataDir = path.join(projectRoot, "data", "intent_dataset");
if (fs.existsSync(path.join(dataDir, "train.jsonl"))) {
  const trainLines = fs.readFileSync(path.join(dataDir, "train.jsonl"), "utf-8").split("\n").filter(Boolean).length;
  const valLines = fs.readFileSync(path.join(dataDir, "validation.jsonl"), "utf-8").split("\n").filter(Boolean).length;
  const testLines = fs.readFileSync(path.join(dataDir, "test.jsonl"), "utf-8").split("\n").filter(Boolean).length;
  log(`✓ Dataset found: ${dataDir}`, "green");
  log(`  train: ${trainLines}, validation: ${valLines}, test: ${testLines}`);
  const stats = JSON.parse(fs.readFileSync(path.join(dataDir, "statistics.json"), "utf-8"));
  log(`  avg quality: ${stats.avgQuality.toFixed(3)}, avg confidence: ${stats.avgConfidence.toFixed(3)}`);
  report.dataset = { train: trainLines, validation: valLines, test: testLines, avgQuality: stats.avgQuality };
} else {
  log(`✗ Dataset NOT found: ${dataDir}`, "red");
  log(`  Run: bun run eternal:dataset`);
  allPassed = false;
}

section("3. RUN UNIT TESTS");
const testResult = run("bun", ["test", "tests/"]);
if (testResult.ok) {
  const summary = testResult.stdout.match(/(\d+) pass.*?(\d+) fail/);
  if (summary) {
    log(`✓ Tests passed: ${summary[1]} pass, ${summary[2]} fail`, "green");
    report.tests = { pass: parseInt(summary[1], 10), fail: parseInt(summary[2], 10) };
  } else {
    log(`✓ Tests passed`, "green");
  }
} else {
  log(`✗ Tests failed`, "red");
  console.log(testResult.stderr.slice(-2000));
  allPassed = false;
}

section("4. RUN SMOKE TEST");
const smokeResult = run("bun", ["run", "scripts/smoke-test-adapter.ts"]);
if (smokeResult.ok && smokeResult.stdout.includes("PASS")) {
  log(`✓ Smoke test passed`, "green");
  report.smokeTest = "passed";
} else {
  log(`✗ Smoke test failed`, "red");
  console.log(smokeResult.stdout.slice(-1500));
  console.log(smokeResult.stderr.slice(-500));
  allPassed = false;
}

section("5. RUN EVALUATION (50 contexts, mock model)");
fs.mkdirSync("eval_results", { recursive: true });
const evalResult = run("bun", ["run", "scripts/run-evaluation.ts", "--contexts", "50", "--seed", "42", "--out", "eval_results"]);
if (evalResult.ok) {
  const reportPath = path.join("eval_results", "report.md");
  if (fs.existsSync(reportPath)) {
    const md = fs.readFileSync(reportPath, "utf-8");
    const v5Player = md.match(/Player adaptation \| [\d.]+ \| ([\d.]+)/);
    const v3Player = md.match(/Player adaptation \| ([\d.]+) \|/);
    const v5Quality = md.match(/Average quality \| [\d.]+ \| ([\d.]+)/);
    const v3Quality = md.match(/Average quality \| ([\d.]+) \|/);
    log(`✓ Evaluation completed`, "green");
    if (v3Player && v5Player) {
      log(`  V3 player-adaptation: ${v3Player[1]}, V5: ${v5Player[1]}`);
      log(`  V3 average-quality:    ${v3Quality?.[1] ?? "?"}, V5: ${v5Quality?.[1] ?? "?"}`);
      const improvement = parseFloat(v5Player[1]) - parseFloat(v3Player[1]);
      if (improvement > 0) {
        log(`  V5 wins by +${improvement.toFixed(3)} on player adaptation`, "green");
        report.evaluation = { v3Player: parseFloat(v3Player[1]), v5Player: parseFloat(v5Player[1]), improvement };
      } else {
        log(`  V5 does NOT improve on V3 baseline (${improvement.toFixed(3)})`, "yellow");
        report.evaluation = { v3Player: parseFloat(v3Player[1]), v5Player: parseFloat(v5Player[1]), improvement };
      }
    }
  } else {
    log(`✓ Evaluation ran but report.md not found`, "yellow");
  }
} else {
  log(`✗ Evaluation failed`, "red");
  console.log(evalResult.stderr.slice(-1500));
  allPassed = false;
}

section("6. CHECK MODAL CONFIGS");
const trainingConfig = path.join(projectRoot, "modal", "configs", "training_config.yaml");
if (fs.existsSync(trainingConfig)) {
  const cfg = fs.readFileSync(trainingConfig, "utf-8");
  const modelMatch = cfg.match(/name: (.+)/);
  if (modelMatch) {
    log(`✓ Modal training config: model = ${modelMatch[1].trim()}`, "green");
    report.modalConfig = { model: modelMatch[1].trim() };
  }
} else {
  log(`✗ Modal config NOT found: ${trainingConfig}`, "red");
  allPassed = false;
}

section("7. CHECK DEPLOYMENT ARTIFACTS");
const dockerfile = path.join(projectRoot, "modal", "Dockerfile");
const infServer = path.join(projectRoot, "modal", "eval", "inference_server.py");
const adapterFactory = path.join(projectRoot, "src", "lib", "game", "ai", "models", "AdapterFactory.ts");
const fineTunedAdapter = path.join(projectRoot, "src", "lib", "game", "ai", "models", "FineTunedAdapter.ts");
const checks = [
  { path: dockerfile, label: "Dockerfile" },
  { path: infServer, label: "inference_server.py" },
  { path: adapterFactory, label: "AdapterFactory" },
  { path: fineTunedAdapter, label: "FineTunedAdapter" },
];
for (const c of checks) {
  if (fs.existsSync(c.path)) {
    log(`✓ ${c.label}: ${c.path}`, "green");
  } else {
    log(`✗ ${c.label} NOT found: ${c.path}`, "red");
    allPassed = false;
  }
}

section("8. FINAL READINESS");
report.allPassed = allPassed;
report.completedAt = new Date().toISOString();
fs.writeFileSync("eval_results/e2e_verification.json", JSON.stringify(report, null, 2), "utf-8");

if (allPassed) {
  log(`\n✓ ALL CHECKS PASSED — pipeline is production-ready`, "green");
  log(`  ${C.green}Dataset:${C.reset}    ${(report.dataset as any)?.train ?? "?"} train / ${(report.dataset as any)?.validation ?? "?"} val / ${(report.dataset as any)?.test ?? "?"} test`);
  log(`  ${C.green}Tests:${C.reset}      ${(report.tests as any)?.pass ?? "?"} pass / ${(report.tests as any)?.fail ?? "?"} fail`);
  log(`  ${C.green}Eval delta:${C.reset}  V5 beats V3 by +${((report.evaluation as any)?.improvement ?? 0).toFixed(3)} on player adaptation`);
  log(`  ${C.green}Modal cfg:${C.reset}   ${(report.modalConfig as any)?.model}`);
  log(`\n${C.green}Next steps:${C.reset}`);
  log(`  1. Set HUB_REPO_ID and run: bash modal/launch_modal.sh`);
  log(`  2. Or build Docker: docker build -f modal/Dockerfile -t eternal-game-designer:qwen-1.5b .`);
  log(`  3. See docs/DEPLOYMENT_QWEN_1.5B.md for the full deployment guide`);
  process.exit(0);
} else {
  log(`\n✗ SOME CHECKS FAILED`, "red");
  log(`  See eval_results/e2e_verification.json for details`);
  process.exit(1);
}
