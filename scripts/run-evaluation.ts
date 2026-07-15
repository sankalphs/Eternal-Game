// ============================================================================
// PROJECT ETERNAL — EVALUATION SCRIPT
//
// Usage:
//   bun run scripts/run-evaluation.ts [--out <dir>] [--contexts <N>] [--endpoint <url>] [--local-model <path>]
//
// Compares the fine-tuned Game Designer (V5) against the deterministic
// Director (V3) on a held-out set of synthetic contexts. Produces
// report.md, report.json, per-context.csv, and statistics.json.
// ============================================================================

import fs from "fs";
import path from "path";
import { EvaluationHarness, type EvaluationConfig } from "../src/lib/game/research";
import { FineTunedAdapter } from "../src/lib/game/ai/models/Adapters";
import { DeterministicIntentMockAdapter } from "../src/lib/game/gamedesigner/IntentMockAdapter";

function parseArgs(): { out: string; contexts: number; endpoint?: string; localModel?: string; seed: number } {
  const args = process.argv.slice(2);
  const out: ReturnType<typeof parseArgs> = {
    out: "./eval_results",
    contexts: 200,
    seed: 42,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out" && args[i + 1]) out.out = args[++i];
    else if (a === "--contexts" && args[i + 1]) out.contexts = parseInt(args[++i], 10);
    else if (a === "--endpoint" && args[i + 1]) out.endpoint = args[++i];
    else if (a === "--local-model" && args[i + 1]) out.localModel = args[++i];
    else if (a === "--seed" && args[i + 1]) out.seed = parseInt(args[++i], 10);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  fs.mkdirSync(args.out, { recursive: true });

  // Build the model
  let model;
  if (args.endpoint) {
    console.log(`[Eval] Using endpoint: ${args.endpoint}`);
    model = new FineTunedAdapter({ endpointUrl: args.endpoint });
  } else if (args.localModel) {
    console.log(`[Eval] Using local model: ${args.localModel}`);
    model = new FineTunedAdapter({ localModelPath: args.localModel });
  } else {
    console.log("[Eval] No model specified — using DeterministicIntentMockAdapter (results will be deterministic but not informative)");
    model = new DeterministicIntentMockAdapter();
  }

  // Run
  const config: EvaluationConfig = {
    numContexts: args.contexts,
    seed: args.seed,
    bootstrapResamples: 1000,
    modelConfidenceThreshold: 0.5,
    renderCharts: false,
    outputDir: args.out,
  };
  const harness = new EvaluationHarness(config);
  const report = await harness.run({ model });

  // Persist
  fs.writeFileSync(path.join(args.out, "report.md"), report.markdown, "utf-8");
  fs.writeFileSync(path.join(args.out, "report.json"), report.jsonReport, "utf-8");
  fs.writeFileSync(path.join(args.out, "per_context.csv"), report.csvReport, "utf-8");
  fs.writeFileSync(path.join(args.out, "statistics.json"), JSON.stringify(report.aggregate, null, 2), "utf-8");

  console.log("=" .repeat(60));
  console.log(`[Eval] Done. ${report.totalContexts} contexts evaluated.`);
  console.log("=" .repeat(60));
  console.log(report.markdown);
}

main().catch((err) => {
  console.error("[Eval] Fatal:", err);
  process.exit(1);
});
