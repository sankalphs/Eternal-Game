// ============================================================================
// /api/ai/llm-info — returns LLM training dataset statistics + architecture
// summary. Used by the AI Insights panel "LLM Designer" tab so the user can
// see what the LLM was actually trained on, what it produces, and where it
// fits in (or doesn't fit in) the runtime game.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STATS_PATHS = [
  path.join(process.cwd(), "data", "intent_dataset", "statistics.json"),
  path.join(process.cwd(), "..", "data", "intent_dataset", "statistics.json"),
];

const REPORT_PATHS = [
  path.join(process.cwd(), "data", "intent_dataset", "dataset_report.json"),
  path.join(process.cwd(), "..", "data", "intent_dataset", "dataset_report.json"),
];

function readFirst<T = any>(paths: string[]): { found: string | null; data: T | null } {
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        return { found: p, data: JSON.parse(fs.readFileSync(p, "utf-8")) as T };
      } catch {
        return { found: p, data: null };
      }
    }
  }
  return { found: null, data: null };
}

const ARCHITECTURE = {
  layers: [
    {
      name: "Deterministic Director (V3 + IntentTranslator)",
      role: "Gameplay authority. Owns weather, lighting, camera, hazards, boss style, difficulty, dialogue, cinematics. The score is fixed and independent.",
      runtime: "Yes — every fight uses the Director's plan.",
      trainedBy: "Hand-coded + scenario scripts. Not learned.",
    },
    {
      name: "LLM Game Designer (V5)",
      role:
        "High-level design. Emits an IntentOutput (intent / reasoning / expectedPlayerReaction / highLevelPlan / confidence). The Director translates the intent into gameplay.",
      runtime: "No — used offline to build the intent-dataset and to fine-tune a small open model (gemma-3-270m).",
      trainedBy: "Supervised fine-tuning on the IntentOutput dataset (94k samples, v4 prompts).",
    },
    {
      name: "GA-tuned EnemyAI",
      role: "Per-frame fight decisions: zone, react, block, whiff-punish, anti-air, pressure, mixup, adaptive, rage, perfection.",
      runtime: "Yes — every opponent you face is driven by this.",
      trainedBy:
        "Genetic algorithm (king-of-the-hill against 100 mutants + 3/3 vs baseline Widow gate). Genome = 12 numbers.",
    },
  ],
  llmTraining: {
    totalSamples: 94395,
    trainSplit: 84965,
    valSplit: 4715,
    testSplit: 4715,
    byModel: { "gemma-3-270m": 94395 },
    byPromptVersion: { v4: 94395 },
    byOrigin: {
      ga_vs_ga: 9090,
      ga_vs_player_archetype: 8804,
      ga_vs_frozen_champion: 9090,
      student_vs_champion: 9090,
      student_vs_distilled: 9090,
      student_vs_ga: 9090,
      director_intent_eval: 7562,
      replay_eval: 8752,
      active_learning: 6406,
      offline_distillation: 8838,
      research_validation: 8583,
    },
    byGrade: { gold: 4492, high: 89903 },
    avgQuality: 0.656,
    avgConfidence: 0.845,
  },
  separationPrinciple:
    "The LLM never produces gameplay values directly. It only decides WHY the next fight should exist; the Director decides HOW it should feel. The runtime game is fully deterministic once a Director plan + a genome are loaded.",
};

export async function GET() {
  const stats = readFirst(STATS_PATHS);
  const report = readFirst(REPORT_PATHS);

  return NextResponse.json({
    ok: true,
    architecture: ARCHITECTURE,
    datasetStats: stats.data,
    datasetStatsPath: stats.found,
    datasetReport: report.data,
    datasetReportPath: report.found,
  });
}
