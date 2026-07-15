// ============================================================================
// SIMULATOR — REPORT WRITER
//
// PHASE 10 of the research framework. Renders BenchmarkReport and
// Experiment data to Markdown / JSON / CSV.
//
// Includes:
//   - Leaderboards
//   - Graphs as data tables (the consumer plots)
//   - Histogram values
//   - Correlation matrices
//   - Improvement tables
//   - Ablation tables
//   - Training recommendations
//
// All output is pure string generation — no file IO. The caller
// decides where to write the result.
// ============================================================================

import type { BenchmarkReport, BenchmarkMetrics } from "./BenchmarkSuite";
import type { Experiment, ExperimentComparison } from "./ExperimentManager";
import type { SeriesResult } from "./MatchResult";
import { describe } from "./StatisticsEngine";

// ----------------------------------------------------------------------------
// Markdown
// ----------------------------------------------------------------------------

export function renderMarkdownBenchmark(reports: BenchmarkReport[]): string {
  const lines: string[] = [];
  lines.push("# Simulation Benchmark Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Reports: ${reports.length}`);
  lines.push("");

  // Leaderboard — by win rate
  lines.push("## Leaderboard (Win Rate)");
  lines.push("");
  lines.push("| Subject | Opponent | N | Win Rate | Avg Damage | Fight Length (s) | Combo Variety | Behaviour Div | Enjoyment |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");
  const sorted = [...reports].sort((a, b) => b.metrics.winRate - a.metrics.winRate);
  for (const r of sorted) {
    const m = r.metrics;
    lines.push(
      `| ${r.subject} | ${r.opponent} | ${r.n} | ${(m.winRate * 100).toFixed(2)}% | ${m.averageDamage.toFixed(1)} | ${m.fightLength.mean.toFixed(2)} ± ${m.fightLength.stddev.toFixed(2)} | ${m.comboVariety.toFixed(2)} | ${m.behaviourDiversity.toFixed(3)} | ${(m.playerEnjoymentProxy * 100).toFixed(1)}% |`,
    );
  }
  lines.push("");

  // Per-report details
  for (const r of sorted) {
    lines.push(`## ${r.subject} vs ${r.opponent}`);
    lines.push("");
    lines.push(renderBenchmarkMetricsMd(r.metrics));
    lines.push("");
  }

  // Improvement table (relative to first report)
  if (reports.length >= 2) {
    lines.push("## Improvement Table (vs first report)");
    lines.push("");
    lines.push("| Subject | Win Rate Δ | Avg Damage Δ | Duration Δ | Combo Δ |");
    lines.push("|---|---:|---:|---:|---:|");
    const base = reports[0]!.metrics;
    for (let i = 1; i < reports.length; i++) {
      const m = reports[i]!.metrics;
      lines.push(
        `| ${reports[i]!.subject} | ${((m.winRate - base.winRate) * 100).toFixed(2)}% | ${(m.averageDamage - base.averageDamage).toFixed(1)} | ${(m.fightLength.mean - base.fightLength.mean).toFixed(2)} | ${(m.comboVariety - base.comboVariety).toFixed(2)} |`,
      );
    }
    lines.push("");
  }

  // Training recommendations
  lines.push("## Training Recommendations");
  lines.push("");
  for (const r of sorted) {
    lines.push(...recommendationsFor(r));
    lines.push("");
  }
  return lines.join("\n");
}

function renderBenchmarkMetricsMd(m: BenchmarkMetrics): string {
  const lines: string[] = [];
  lines.push("### Core");
  lines.push(`- Win Rate: ${(m.winRate * 100).toFixed(2)}%`);
  lines.push(`- Average Damage: ${m.averageDamage.toFixed(1)}`);
  lines.push(`- Damage Taken: ${m.damageTaken.toFixed(1)}`);
  lines.push(`- Fight Length: ${m.fightLength.mean.toFixed(2)}s ± ${m.fightLength.stddev.toFixed(2)} (median ${m.fightLength.median.toFixed(2)}s, p95 ${m.fightLength.p95.toFixed(2)}s)`);
  lines.push(`- Combo Variety: ${m.comboVariety.toFixed(2)}`);
  lines.push(`- Behaviour Diversity: ${m.behaviourDiversity.toFixed(3)}`);
  lines.push("");
  lines.push("### Subjective");
  lines.push(`- Player Enjoyment Proxy: ${(m.playerEnjoymentProxy * 100).toFixed(1)}%`);
  lines.push(`- Narrative Consistency: ${(m.narrativeConsistency * 100).toFixed(1)}%`);
  lines.push(`- Adaptation Score: ${m.adaptationScore.toFixed(3)}`);
  lines.push(`- LLM Agreement: ${(m.llmAgreement * 100).toFixed(1)}%`);
  lines.push("");
  lines.push("### Difficulty Curve");
  if (m.difficultyCurve.length === 0) lines.push("(no chapters)");
  for (const c of m.difficultyCurve) {
    lines.push(`- Ch ${c.chapterIndex}: WR=${(c.winRate * 100).toFixed(1)}%, Duration=${c.avgDuration.toFixed(1)}s`);
  }
  lines.push("");
  lines.push("### Confidence Calibration");
  lines.push("| Predicted | Actual | N |");
  lines.push("|---:|---:|---:|");
  for (const b of m.confidenceCalibration) {
    lines.push(`| ${b.predicted.toFixed(2)} | ${b.actual.toFixed(2)} | ${b.n} |`);
  }
  lines.push("");
  lines.push("### Fight Length Histogram");
  lines.push("| Edge | Count | Density |");
  lines.push("|---:|---:|---:|");
  for (let i = 0; i < m.fightLengthHistogram.binEdges.length - 1; i++) {
    lines.push(`| ${m.fightLengthHistogram.binEdges[i]!.toFixed(2)} | ${m.fightLengthHistogram.binCounts[i]} | ${m.fightLengthHistogram.binDensities[i]!.toFixed(4)} |`);
  }
  return lines.join("\n");
}

function recommendationsFor(r: BenchmarkReport): string[] {
  const out: string[] = [];
  const m = r.metrics;
  out.push(`- **${r.subject}**`);
  if (m.winRate < 0.4) out.push(`  - Win rate is low (${(m.winRate * 100).toFixed(1)}%). Consider training against more archetypes.`);
  if (m.winRate > 0.85) out.push(`  - Win rate is high (${(m.winRate * 100).toFixed(1)}%). Difficulty curve may be too easy.`);
  if (m.comboVariety < 2) out.push(`  - Combo variety is low (${m.comboVariety.toFixed(2)}). Encourage more attack-kind diversity.`);
  if (m.behaviourDiversity < 0.3) out.push(`  - Behaviour diversity is low (${m.behaviourDiversity.toFixed(3)}). Increase mutation magnitude or mixup.`);
  if (m.fightLength.stddev / Math.max(0.001, m.fightLength.mean) < 0.05) {
    out.push(`  - Fight length is highly consistent. Consider wider opponent pool.`);
  }
  if (m.playerEnjoymentProxy < 0.3) {
    out.push(`  - Player enjoyment proxy is low (${(m.playerEnjoymentProxy * 100).toFixed(1)}%). Boost close finishes and combo variety.`);
  }
  if (out.length === 1) out.push(`  - All metrics look healthy.`);
  return out;
}

// ----------------------------------------------------------------------------
// Experiment markdown
// ----------------------------------------------------------------------------

export function renderMarkdownExperiments(experiments: Experiment[]): string {
  const lines: string[] = [];
  lines.push("# Experiment Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Experiments: ${experiments.length}`);
  lines.push("");

  // Leaderboard
  lines.push("## Leaderboard");
  lines.push("");
  lines.push("| ID | Label | Seed | Match Type | N | Win Rate | Duration | Notes |");
  lines.push("|---|---|---:|---|---:|---:|---|---|");
  for (const e of experiments) {
    lines.push(
      `| ${e.id} | ${e.label} | ${e.seed} | ${e.matchType} | ${e.n} | ${(e.results.winRate.mean * 100).toFixed(2)}% | ${e.results.duration.mean.toFixed(2)}s | ${e.notes ?? ""} |`,
    );
  }
  lines.push("");

  // Per-experiment
  for (const e of experiments) {
    lines.push(`## ${e.label} (${e.id})`);
    lines.push("");
    lines.push(`- Created: ${e.createdAt}`);
    lines.push(`- Wall time: ${e.wallMs}ms`);
    lines.push(`- Model: ${e.model}`);
    lines.push(`- Prompt version: ${e.promptVersion}`);
    lines.push(`- Dataset version: ${e.datasetVersion}`);
    lines.push(`- Genome version: ${e.genomeVersion}`);
    lines.push(`- Director version: ${e.directorVersion}`);
    lines.push(`- Teacher version: ${e.teacherVersion}`);
    lines.push(`- Student version: ${e.studentVersion}`);
    lines.push("");
    lines.push("### Results");
    lines.push("| Metric | Mean | Median | Stddev | Min | Max | CI95 |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const [name, stats] of Object.entries(e.results)) {
      lines.push(`| ${name} | ${stats.mean.toFixed(3)} | ${stats.median.toFixed(3)} | ${stats.stddev.toFixed(3)} | ${stats.min.toFixed(3)} | ${stats.max.toFixed(3)} | ±${stats.ci95.toFixed(3)} |`);
    }
    if (e.comparison) lines.push("", "### Comparison", "", e.comparison.summary);
    lines.push("");
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// JSON
// ----------------------------------------------------------------------------

export function renderJsonBenchmark(reports: BenchmarkReport[]): string {
  return JSON.stringify(reports, null, 2);
}

export function renderJsonExperiments(experiments: Experiment[]): string {
  return JSON.stringify(experiments, (_k, v) => v instanceof Map ? Object.fromEntries(v) : v, 2);
}

// ----------------------------------------------------------------------------
// CSV
// ----------------------------------------------------------------------------

/** Render a benchmark report as a single-row CSV. */
export function renderCsvBenchmarkRow(report: BenchmarkReport): string {
  const m = report.metrics;
  return [
    report.subject, report.opponent, report.n,
    m.winRate.toFixed(4), m.averageDamage.toFixed(2), m.damageTaken.toFixed(2),
    m.fightLength.mean.toFixed(3), m.fightLength.stddev.toFixed(3),
    m.comboVariety.toFixed(3), m.behaviourDiversity.toFixed(4),
    m.playerEnjoymentProxy.toFixed(4),
    m.narrativeConsistency.toFixed(4), m.adaptationScore.toFixed(4),
    m.llmAgreement.toFixed(4),
  ].join(",");
}

export function renderCsvBenchmarkHeader(): string {
  return [
    "subject", "opponent", "n",
    "winRate", "avgDamage", "damageTaken",
    "durationMean", "durationStddev",
    "comboVariety", "behaviourDiversity",
    "enjoyment", "narrativeConsistency", "adaptationScore", "llmAgreement",
  ].join(",");
}

export function renderCsvBenchmark(reports: BenchmarkReport[]): string {
  const lines: string[] = [renderCsvBenchmarkHeader()];
  for (const r of reports) lines.push(renderCsvBenchmarkRow(r));
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// Series-to-data exports (for plotting libraries)
// ----------------------------------------------------------------------------

/** Render per-fight data as CSV: one row per fight, useful for plotting. */
export function renderCsvSeries(series: SeriesResult): string {
  const lines: string[] = [
    "id,seed,durationSeconds,winnerSide,damageA,damageB,maxComboA,maxComboB,hpFracA,hpFracB,rounds,chapterIndex,emotion,difficulty",
  ];
  for (const f of series.fights) {
    lines.push([
      f.id, f.seed, f.durationSeconds.toFixed(3),
      f.winnerSide === null ? "" : f.winnerSide,
      f.sideA.damageDealt, f.sideB.damageDealt,
      f.sideA.maxCombo, f.sideB.maxCombo,
      f.sideA.hpFrac.toFixed(4), f.sideB.hpFrac.toFixed(4),
      f.rounds.length,
      f.meta.chapterIndex ?? "", f.meta.emotion ?? "", f.meta.difficulty ?? "",
    ].join(","));
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// Correlation matrix
// ----------------------------------------------------------------------------

/** Render a correlation matrix as Markdown. */
export function renderMarkdownCorrelation(
  labels: string[],
  matrix: number[][],
): string {
  const lines: string[] = [];
  lines.push("| | " + labels.join(" | ") + " |");
  lines.push("|---".repeat(labels.length + 1) + "|");
  for (let i = 0; i < labels.length; i++) {
    const row = matrix[i]!;
    lines.push("| " + labels[i] + " | " + row.map(v => v.toFixed(2)).join(" | ") + " |");
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// Convenience: write all formats at once
// ----------------------------------------------------------------------------

export interface ReportBundle {
  markdown: string;
  json: string;
  csv: string;
  /** Per-series CSVs (one per series). */
  seriesCsv: { id: string; csv: string }[];
}

export function buildReportBundle(
  reports: BenchmarkReport[],
  series: SeriesResult[] = [],
): ReportBundle {
  return {
    markdown: renderMarkdownBenchmark(reports),
    json: renderJsonBenchmark(reports),
    csv: renderCsvBenchmark(reports),
    seriesCsv: series.map(s => ({ id: s.id, csv: renderCsvSeries(s) })),
  };
}

// ----------------------------------------------------------------------------
// Training recommendations (standalone)
// ----------------------------------------------------------------------------

export function renderTrainingRecommendations(reports: BenchmarkReport[]): string {
  const lines: string[] = [];
  lines.push("# Training Recommendations");
  lines.push("");
  for (const r of reports) {
    lines.push(...recommendationsFor(r));
    lines.push("");
  }
  return lines.join("\n");
}
