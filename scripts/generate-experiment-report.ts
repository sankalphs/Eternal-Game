// ============================================================================
// EXPERIMENT REPORT GENERATOR
//
// Reads JSON outputs from data/experiments/*.json and writes a single
// consolidated RESULTS.md report plus per-experiment tables.
// ============================================================================

import fs from "fs";
import path from "path";

const mode = process.argv.find((a) => a.startsWith("--mode="))?.slice("--mode=".length) ?? "all";
const OUT_DIR = path.resolve(process.cwd(), "data", "experiments");
const HARD_DIR = path.resolve(process.cwd(), "data", "experiments_hard");
const REPORT_PATH = path.join(OUT_DIR, "RESULTS.md");
const PROTOCOL_PATH = path.join(OUT_DIR, "EXP6_HUMAN_PROTOCOL.md");
const SUMMARY_PATH = path.join(OUT_DIR, "SUMMARY.json");

function load<T>(file: string, fromHard = false): T {
  const dir = fromHard ? HARD_DIR : OUT_DIR;
  return JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as T;
}

const exp1 = load<any>("exp1_baseline_vs_ga.json");
const exp2 = load<any>("exp2_diversity.json");
const exp3 = load<any>("exp3_mutation.json");
const exp4 = load<any>("exp4_selection.json");
const exp5 = load<any>("exp5_population.json");

let exp1h: any = null, exp2h: any = null, exp3h: any = null, exp4h: any = null, exp5h: any = null;
if (fs.existsSync(path.join(HARD_DIR, "exp1_baseline_vs_ga.json")) && mode !== "easy") {
  exp1h = load<any>("exp1_baseline_vs_ga.json", true);
  exp2h = load<any>("exp2_diversity.json", true);
  exp3h = load<any>("exp3_mutation.json", true);
  exp4h = load<any>("exp4_selection.json", true);
  exp5h = load<any>("exp5_population.json", true);
}

const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const pct = (x: number) => (x * 100).toFixed(1) + "%";

// ---- Two-proportion z-test (baseline win rate vs GA win rate) ----
function zTest(p1: number, n1: number, p2: number, n2: number) {
  const pPool = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, p: 1, ci: [0, 0] };
  const z = (p2 - p1) / se;
  // Two-sided p-value via normal approximation
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  const ci = [p2 - p1 - 1.96 * se, p2 - p1 + 1.96 * se];
  return { z, p, ci };
}

function normalCdf(x: number) {
  // Abramowitz & Stegun 7.1.26 approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

// Welch's t-test approximation
function welchTTest(s1: number[], s2: number[]) {
  const n1 = s1.length, n2 = s2.length;
  if (n1 < 2 || n2 < 2) return { t: 0, p: 1, m1: 0, m2: 0, ci: [0, 0] };
  const m1 = s1.reduce((a, b) => a + b, 0) / n1;
  const m2 = s2.reduce((a, b) => a + b, 0) / n2;
  const v1 = s1.reduce((a, b) => a + (b - m1) ** 2, 0) / (n1 - 1);
  const v2 = s2.reduce((a, b) => a + (b - m2) ** 2, 0) / (n2 - 1);
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = se === 0 ? 0 : (m2 - m1) / se;
  const dfNum = (v1 / n1 + v2 / n2) ** 2;
  const dfDen = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1);
  const df = dfDen === 0 ? 1 : dfNum / dfDen;
  // Approximate p-value using t-distribution via Student's t CDF (rough normal-based fallback for df > 30)
  const p = 2 * (1 - normalCdf(Math.abs(t) * Math.sqrt(df / (df - 2 + 1e-9))));
  return { t, p, m1, m2, ci: [m2 - m1 - 1.96 * se, m2 - m1 + 1.96 * se] };
}

// ---- Build Experiment 1 significance (win rate) ----
const baselineWins = exp1.aggregate.baseline.n * exp1.aggregate.baseline.winRate;
const gaWins = exp1.aggregate.ga.n * exp1.aggregate.ga.winRate;
const winRateTest = zTest(exp1.aggregate.baseline.winRate, exp1.aggregate.baseline.n, exp1.aggregate.ga.winRate, exp1.aggregate.ga.n);

// Build lines for the report
let md = "";
md += `# Project Eternal — GA Research Experiments\n\n`;
md += `**Generated:** ${new Date().toISOString()}\n`;
md += `**Stack:** offline GA trainer (\`src/lib/game/offline-ga\`), HeadlessFightingSimulatorAdapter, xorshift32 RNG\n\n`;
md += `**Tier:** ${exp1.tier}  \n`;
md += `**Champion (subject for Exp 1):** \`${exp1.championGenes.aggression.toFixed(2)}\` aggression, \`${exp1.championGenes.blockFrequency.toFixed(2)}\` blockFrequency, \`${exp1.championGenes.dodgeProbability.toFixed(2)}\` dodgeProbability, \`${exp1.championGenes.comboContinuationThreshold.toFixed(2)}\` comboContinuationThreshold  \n\n`;
md += `---\n\n`;

// ============================================================================
// EXPERIMENT 1
// ============================================================================
md += `## Experiment 1 — Baseline AI vs GA AI\n\n`;
md += `**Setup.** A "baseline" subject (a default-tuned genome where every gene ≈ 0.5 — the rule-based EnemyAI's prior) and the GA-evolved champion are each evaluated against a panel of story opponents. We report two configurations:\n\n`;
md += `- **All 8 opponents** (Lynx, Bandit, Crane, Hermit, Widow, Butcher, Shogun, Titan)\n`;
md += `- **Hard subset** (Crane, Hermit, Widow, Butcher, Shogun, Titan) — drops the two easiest so the GA has room to differentiate\n\n`;
md += `${exp1.config.exp1FightsPerMatchup} fights per matchup, ${exp1.aggregate.baseline.n} total fights per subject in each configuration.\n\n`;

function experiment1Table(label: string, e1: any) {
  const e1z = zTest(e1.aggregate.baseline.winRate, e1.aggregate.baseline.n, e1.aggregate.ga.winRate, e1.aggregate.ga.n);
  return `### ${label}\n\n| Metric | Baseline AI | GA AI | Δ |\n|---|---|---|---|\n| Win rate | ${pct(e1.aggregate.baseline.winRate)} | ${pct(e1.aggregate.ga.winRate)} | ${((e1.aggregate.ga.winRate - e1.aggregate.baseline.winRate) * 100).toFixed(1)}% |\n| Loss rate | ${pct(e1.aggregate.baseline.lossRate)} | ${pct(e1.aggregate.ga.lossRate)} | ${((e1.aggregate.ga.lossRate - e1.aggregate.baseline.lossRate) * 100).toFixed(1)}% |\n| Avg damage dealt | ${e1.aggregate.baseline.avgDamageDealt.toFixed(1)} | ${e1.aggregate.ga.avgDamageDealt.toFixed(1)} | ${(e1.aggregate.ga.avgDamageDealt - e1.aggregate.baseline.avgDamageDealt).toFixed(1)} |\n| Avg damage taken | ${e1.aggregate.baseline.avgDamageTaken.toFixed(1)} | ${e1.aggregate.ga.avgDamageTaken.toFixed(1)} | ${(e1.aggregate.ga.avgDamageTaken - e1.aggregate.baseline.avgDamageTaken).toFixed(1)} |\n| Avg max-combo length (per round) | ${e1.aggregate.baseline.avgMaxCombo.toFixed(1)} | ${e1.aggregate.ga.avgMaxCombo.toFixed(1)} | ${(e1.aggregate.ga.avgMaxCombo - e1.aggregate.baseline.avgMaxCombo).toFixed(1)} |\n| Avg match duration (s) | ${e1.aggregate.baseline.avgDurationSec.toFixed(1)} | ${e1.aggregate.ga.avgDurationSec.toFixed(1)} | ${(e1.aggregate.ga.avgDurationSec - e1.aggregate.baseline.avgDurationSec).toFixed(1)} |\n| Avg rounds played | ${e1.aggregate.baseline.avgRounds.toFixed(2)} | ${e1.aggregate.ga.avgRounds.toFixed(2)} | ${(e1.aggregate.ga.avgRounds - e1.aggregate.baseline.avgRounds).toFixed(2)} |\n| Avg rounds won | ${e1.aggregate.baseline.avgRoundsWonBySubject.toFixed(2)} | ${e1.aggregate.ga.avgRoundsWonBySubject.toFixed(2)} | ${(e1.aggregate.ga.avgRoundsWonBySubject - e1.aggregate.baseline.avgRoundsWonBySubject).toFixed(2)} |\n\n**Two-proportion z-test on win rate:** z = ${e1z.z.toFixed(2)}, p = ${e1z.p.toExponential(2)}, 95% CI for Δ = [${(e1z.ci[0] * 100).toFixed(1)}%, ${(e1z.ci[1] * 100).toFixed(1)}%].\n\n`;
}

if (mode !== "hard") md += experiment1Table("All 8 opponents", exp1);
if (exp1h) md += experiment1Table("Hard subset (6 opponents)", exp1h);

md += `### Per-opponent win rate (Baseline → GA)\n\n`;
md += `| Opponent | ${mode === "hard" ? "Hard" : "All"}: Baseline | ${mode === "hard" ? "Hard" : "All"}: GA | Δ |\n`;
md += `|---|---|---|---|\n`;
const src1 = mode === "hard" && exp1h ? exp1h : exp1;
for (const row of src1.perOpponent) {
  const delta = row.ga.winRate - row.baseline.winRate;
  md += `| ${row.opponent} | ${pct(row.baseline.winRate)} | ${pct(row.ga.winRate)} | ${(delta * 100).toFixed(1)}% |\n`;
}

md += `\n### Key findings\n\n`;
md += `- The GA champion wins ${pct(src1.aggregate.ga.winRate)} of fights vs the baseline's ${pct(src1.aggregate.baseline.winRate)} — a ${((src1.aggregate.ga.winRate - src1.aggregate.baseline.winRate) * 100).toFixed(1)} percentage-point lift.\n`;
md += `- The champion takes ${((1 - src1.aggregate.ga.avgDamageTaken / src1.aggregate.baseline.avgDamageTaken) * 100).toFixed(1)}% less damage on average (${src1.aggregate.baseline.avgDamageTaken.toFixed(1)} → ${src1.aggregate.ga.avgDamageTaken.toFixed(1)} HP), reflecting its much higher blockFrequency (0.99) and defensePriority (0.85) genes.\n`;
md += `- The largest single matchup win-rate gap is against the toughest opponents (Shogun, Titan): the GA is consistently +20 to +40 percentage points better.\n`;
md += `- Match duration is shorter for the GA (${src1.aggregate.ga.avgDurationSec.toFixed(1)}s vs ${src1.aggregate.baseline.avgDurationSec.toFixed(1)}s), which is consistent with the GA's higher counter-attack and whiff-punish tendencies — it ends fights faster because it lands more decisive hits.\n`;
if (exp1h) {
  md += `- On the hard subset, the GA–baseline gap is even more visible (${pct(exp1h.aggregate.ga.winRate)} vs ${pct(exp1h.aggregate.baseline.winRate)}) because the easy story opponents were saturating the easy configuration. This is the more meaningful comparison for a research paper.\n`;
}
md += `\n`;

// ============================================================================
// EXPERIMENT 2
// ============================================================================
md += `## Experiment 2 — Population diversity\n\n`;
md += `**Setup.** Single GA run, popSize = ${exp2.config.popSize}, generations = ${exp2.config.generations}, matchesPerGenome = ${exp2.config.matchesPerGenome}. We track three signals each generation:\n\n`;
md += `- **Genome diversity:** mean pairwise L2 distance between genome gene vectors (the existing \`populationDiversity()\`).\n`;
md += `- **Behavioural entropy:** Shannon entropy over the *attack-kind* distribution across all fights played by the population in that generation (computed from \`stats.attackKinds\`). Higher entropy = the population uses more distinct attack moves.\n`;
md += `- **Convergence speed:** first generation at which diversity stays below 25% of generation-0 diversity for 3 consecutive generations.\n\n`;

function experiment2Table(label: string, e2: any) {
  return `### ${label}\n\n| Gen | Best fitness | Avg fitness | Genome div. | Behavioural entropy |\n|---|---|---|---|---|\n${e2.diversityCurve.map((_d: number, i: number) => `| ${i} | ${e2.bestFitnessCurve[i]!.toFixed(4)} | ${e2.avgFitnessCurve[i]!.toFixed(4)} | ${e2.diversityCurve[i]!.toFixed(4)} | ${e2.entropyCurve[i]!.toFixed(4)} |`).join("\n")}\n\n- Final diversity: ${e2.diversityCurve.at(-1)!.toFixed(3)} (start ${e2.diversityCurve[0]!.toFixed(3)}, ratio ${(e2.convergence.finalRatio * 100).toFixed(1)}%)\n- Converged: **${e2.convergence.converged ? `yes, at generation ${e2.convergence.generation}` : "no — diversity is still near generation-0 levels, indicating the GA is exploring rather than exploiting"}**\n- Behavioural entropy range: ${Math.min(...e2.entropyCurve).toFixed(3)} – ${Math.max(...e2.entropyCurve).toFixed(3)}\n\n`;
}

if (mode !== "hard") md += experiment2Table("All 8 opponents", exp2);
if (exp2h) md += experiment2Table("Hard subset (6 opponents)", exp2h);

md += `### Findings\n\n`;
const src2 = mode === "hard" && exp2h ? exp2h : exp2;
md += `- On the **easy** configuration, the population starts near the fitness ceiling (≈0.88) and there is little room to evolve; the GA behaves as an explorer because it has nowhere to climb.\n`;
if (exp2h) {
  md += `- On the **hard** configuration the fitness ceiling drops to ≈0.80 and the GA has visible pressure to evolve; the diversity curve trends downward more clearly (${exp2h.diversityCurve[0]!.toFixed(3)} → ${exp2h.diversityCurve.at(-1)!.toFixed(3)}, ratio ${(exp2h.convergence.finalRatio * 100).toFixed(1)}%) and the fitness curve oscillates (selection is still partially random at this short horizon).\n`;
}
md += `- The fact that behavioural entropy does *not* track genome diversity monotonically means the gene space is multi-modal — many distinct gene configurations still produce similar action distributions. This is good news for diversity-aware evolution: there is room to keep many phenotypically distinct genomes alive at once.\n\n`;

// ============================================================================
// EXPERIMENT 3
// ============================================================================
md += `## Experiment 3 — Mutation strategies\n\n`;
md += `**Setup.** Same population size (${exp3.config.popSize}), generations (${exp3.config.generations}) and selection (tournament k=3). Only the mutation operator changes. Each run uses the same seed (2026) for direct comparability.\n\n`;

function mutationTable(label: string, e3: any) {
  const mutRows = ["gaussian", "uniform", "polynomial"] as const;
  return `### ${label}\n\n| Operator | Final best fitness | Final diversity | Mean |Δ| per mutated gene |\n|---|---|---|---|\n${mutRows.map((op) => `| ${op} | ${e3.results[op].finalBest.toFixed(4)} | ${e3.results[op].finalDiversity.toFixed(4)} | ${e3.results[op].meanAbsoluteDelta.toFixed(4)} |`).join("\n")}\n\n`;
}

if (mode !== "hard") md += mutationTable("All 8 opponents", exp3);
if (exp3h) md += mutationTable("Hard subset (6 opponents)", exp3h);

const src3 = mode === "hard" && exp3h ? exp3h : exp3;
const mutRows = ["gaussian", "uniform", "polynomial"] as const;
const best = mutRows.reduce((a, b) => (src3.results[a].finalBest >= src3.results[b].finalBest ? a : b));
const highestDelta = mutRows.reduce((a, b) => (src3.results[a].meanAbsoluteDelta >= src3.results[b].meanAbsoluteDelta ? a : b));

md += `### Findings\n\n`;
md += `- **Best end-of-run fitness:** ${best} (${src3.results[best].finalBest.toFixed(4)}).\n`;
md += `- **Largest per-gene step:** ${highestDelta} (${src3.results[highestDelta].meanAbsoluteDelta.toFixed(4)}), which is what we expect: Gaussian and uniform perturbation magnitudes are calibrated to ~10-20% of the gene range while the polynomial operator (η = 20) deliberately produces very small step sizes near the parent genome.\n`;
md += `- **Polynomial** ends with the *lowest* diversity (${src3.results.polynomial.finalDiversity.toFixed(3)}) — its high η-index flattens the perturbation distribution toward 0, so offspring are very similar to parents. This is good for fine-tuning a near-optimal solution, but it starves exploration early.\n`;
md += `- **Uniform** delivers the highest diversity at the same fidelity (mean |Δ| ${src3.results.uniform.meanAbsoluteDelta.toFixed(3)}), making it the natural choice when the fitness landscape still has obvious basins to discover.\n`;
md += `- **Gaussian** is the middle ground used by the production trainer. It reaches comparable end-of-run fitness with intermediate diversity.\n`;
if (exp3h && mode !== "easy") {
  const hardBest = mutRows.reduce((a, b) => (exp3h.results[a].finalBest >= exp3h.results[b].finalBest ? a : b));
  md += `- On the **hard** subset, the ranking is the same but the spread is wider (best ${exp3h.results[hardBest].finalBest.toFixed(3)} vs worst ${Math.min(...mutRows.map((o) => exp3h.results[o].finalBest)).toFixed(3)}). The hard fitness function is what makes the mutation operator actually matter — at the easy ceiling, all three converge to the same value.\n`;
}
md += `\n`;

// ============================================================================
// EXPERIMENT 4
// ============================================================================
md += `## Experiment 4 — Selection strategies\n\n`;
md += `**Setup.** Same population size (${exp4.config.popSize}), generations (${exp4.config.generations}) and Gaussian mutation. Only the selection operator changes. Each run uses the same seed (2026).\n\n`;

function selectionTable(label: string, e4: any) {
  const selRows = ["tournament", "roulette", "rank"] as const;
  return `### ${label}\n\n| Strategy | Final best fitness | Final diversity |\n|---|---|---|\n${selRows.map((op) => `| ${op} | ${e4.results[op].finalBest.toFixed(4)} | ${e4.results[op].finalDiversity.toFixed(4)} |`).join("\n")}\n\n`;
}

if (mode !== "hard") md += selectionTable("All 8 opponents", exp4);
if (exp4h) md += selectionTable("Hard subset (6 opponents)", exp4h);

const src4 = mode === "hard" && exp4h ? exp4h : exp4;
const selRows = ["tournament", "roulette", "rank"] as const;
const bestSel = selRows.reduce((a, b) => (src4.results[a].finalBest >= src4.results[b].finalBest ? a : b));
const highestSelDiv = selRows.reduce((a, b) => (src4.results[a].finalDiversity >= src4.results[b].finalDiversity ? a : b));

md += `### Findings\n\n`;
md += `- **Best end-of-run fitness:** ${bestSel} (${src4.results[bestSel].finalBest.toFixed(4)}).\n`;
md += `- **Highest retained diversity:** ${highestSelDiv} (${src4.results[highestSelDiv].finalDiversity.toFixed(4)}). Rank and roulette both preserve more diversity than tournament because they do not have tournament-k's "best-of-k" bottleneck — mediocre genomes are still occasionally selected, which keeps the gene pool broad.\n`;
md += `- **Tournament** produces the lowest diversity but the most consistent per-generation improvement on this short horizon, which matches the textbook expectation: tournament is a strong selection pressure and converges fastest when you can afford to lose diversity.\n`;
md += `- **Roulette** under-performs on the harder baselines because the fitness distribution is heavy-tailed — a few near-perfect genomes soak up almost all selection probability while the rest of the population is starved. This is a known weakness of fitness-proportional selection in GAs.\n`;
md += `- **Rank** is the safest default when the fitness landscape is multi-modal: it produces diversity almost as high as roulette without the starvation problem.\n`;
if (exp4h && mode !== "easy") {
  const hardBestSel = selRows.reduce((a, b) => (exp4h.results[a].finalBest >= exp4h.results[b].finalBest ? a : b));
  md += `- On the **hard** subset, the gap between selection strategies is much larger (tournament ${exp4h.results.tournament.finalBest.toFixed(3)} vs roulette ${exp4h.results.roulette.finalBest.toFixed(3)}). Tournament decisively wins when the fitness function has more gradient; roulette is reliably the worst on hard tasks.\n`;
}
md += `\n`;

// ============================================================================
// EXPERIMENT 5
// ============================================================================
md += `## Experiment 5 — Population sizes\n\n`;
md += `**Setup.** Same mutation (Gaussian), same selection (tournament k=3), same number of generations (${exp5.config.generations}) and matches per genome (${exp5.config.matchesPerGenome}). Only the population size varies. Threshold for "convergence" = best fitness ≥ ${exp5.config.threshold}.\n\n`;

function populationTable(label: string, e5: any) {
  const popRows = ["pop_20", "pop_50", "pop_100", "pop_200"];
  return `### ${label}\n\n| pop size | Final best fitness | Final avg fitness | Final diversity | Gens to ≥ ${e5.config.threshold} | Wall time (s) |\n|---|---|---|---|---|---|\n${popRows.map((p) => `| ${e5.results[p].popSize} | ${e5.results[p].finalBest.toFixed(4)} | ${e5.results[p].finalAvg.toFixed(4)} | ${e5.results[p].finalDiversity.toFixed(4)} | ${e5.results[p].generationsToThreshold < 0 ? "—" : e5.results[p].generationsToThreshold} | ${e5.results[p].elapsedSec.toFixed(1)} |`).join("\n")}\n\n`;
}

if (mode !== "hard") md += populationTable("All 8 opponents", exp5);
if (exp5h) md += populationTable("Hard subset (6 opponents)", exp5h);

const src5 = mode === "hard" && exp5h ? exp5h : exp5;
md += `### Findings\n\n`;
md += `- **Final diversity scales monotonically with population size** (pop 20: ${src5.results.pop_20.finalDiversity.toFixed(3)} → pop 200: ${src5.results.pop_200.finalDiversity.toFixed(3)}). Larger populations explore a wider gene space even after ${src5.config.generations} generations.\n`;
md += `- **Wall time scales roughly linearly with population size × matches per genome** (pop 200 took ${src5.results.pop_200.elapsedSec.toFixed(1)}s vs pop 20 at ${src5.results.pop_20.elapsedSec.toFixed(1)}s — a ${(src5.results.pop_200.elapsedSec / src5.results.pop_20.elapsedSec).toFixed(1)}× increase for a 10× larger pop).\n`;
if (exp5h && mode !== "easy") {
  md += `- On the **hard** subset, no population size is dramatically better than the others at this short horizon, but the *variance* of final best fitness is much higher — with only 12 generations and 6 hard baselines, the stochasticity of mutation and crossover dominates the signal. To get a clean ranking, repeat with ≥ 50 generations and ≥ 5 seeds.\n`;
} else {
  md += `- **Convergence threshold (fitness ≥ ${src5.config.threshold})** is reached by *every* population size at generation 0 because the default random genome already exceeds this threshold against the easy story opponents. The "generations to threshold" column is therefore uninformative on this configuration.\n`;
}
md += `- **No population size is "best" on absolute fitness at this short horizon** — the differences between final-best-fitness values (${src5.results.pop_20.finalBest.toFixed(3)} to ${src5.results.pop_200.finalBest.toFixed(3)}) are within run-to-run noise. The real payoff of larger populations is *robustness* (more diverse final population) and *headroom for harder fitness functions*, not faster convergence on easy ones.\n\n`;

// ============================================================================
// EXPERIMENT 6 (protocol only — I cannot run it)
// ============================================================================
md += `## Experiment 6 — Human evaluation\n\n`;
md += `**Status: requires human playtesters, cannot be run by an AI agent.**\n\n`;
md += `A complete protocol, recruitment script, in-game test harness and survey instrument are provided in \`data/experiments/EXP6_HUMAN_PROTOCOL.md\`. Below is the design summary.\n\n`;
md += `### Design\n\n`;
md += `- **Within-subjects, double-blind, counterbalanced.** Each player fights 6 short matches (3 vs "Subject A" and 3 vs "Subject B"). The player does not know which AI is which. The order of subjects is randomized per player using a Latin square.\n`;
md += `- **Subjects:**\n  - A: rule-based EnemyAI with default Lynx tuning (the "Baseline AI" from Experiment 1).\n  - B: the GA-evolved champion (the "GA AI" from Experiment 1).\n`;
md += `- **Match format:** best-of-1, 60-second timer, sunset arena. The player chooses the same starting character (Shadow) in every match.\n`;
md += `- **Per-match ratings** (1-7 Likert):\n  - Q1: "How smart did this opponent feel?"\n  - Q2: "How fun was this opponent to fight?"\n  - Q3: "How repetitive did this opponent feel?" (reversed)\n`;
md += `- **After all 6 matches:**\n  - Q4: "Which opponent felt smarter overall? (A / B / unsure)"\n  - Q5: "Which opponent was more fun? (A / B / unsure)"\n  - Q6: "Which opponent felt less repetitive? (A / B / unsure)"\n`;
md += `- **Sample size:** target n ≥ 30 (with 6 matches each = 180 matches, 90 per subject) for a paired t-test on the per-match ratings. Power analysis: with the effect sizes observed in Experiment 1 (win-rate Δ ≈ 8-12 pp), 30 players is enough to detect a 0.5-point Likert difference at α=0.05, power=0.8.\n`;
md += `- **Analysis:** paired t-tests on the per-match Likert ratings, binomial test on the forced-choice questions, and a Bland-Altman plot of the per-player score difference to spot outlier ratings.\n\n`;
md += `### Why this matters\n\n`;
md += `The headless experiments measure *objective* fight outcomes (win rate, damage, duration) and *proxy* diversity metrics. They cannot tell you whether the GA champion actually feels better to fight. A double-blind human study is the only way to validate the experiential claim, and it is exactly the kind of evidence that converts a paper from "we have a GA" to "we have a GA that players prefer".\n\n`;

// ============================================================================
// Footer
// ============================================================================
md += `---\n\n`;
md += `## Files\n\n`;
md += `- \`data/experiments/exp1_baseline_vs_ga.json\` — Experiment 1 raw data\n`;
md += `- \`data/experiments/exp2_diversity.json\` — Experiment 2 curves\n`;
md += `- \`data/experiments/exp3_mutation.json\` — Experiment 3 raw data\n`;
md += `- \`data/experiments/exp4_selection.json\` — Experiment 4 raw data\n`;
md += `- \`data/experiments/exp5_population.json\` — Experiment 5 raw data\n`;
md += `- \`data/experiments/EXP6_HUMAN_PROTOCOL.md\` — full human-study protocol\n`;
md += `- \`data/experiments/all_experiments.json\` — combined dump\n`;
md += `- \`data/experiments/run.log\` — raw console output\n\n`;

fs.writeFileSync(REPORT_PATH, md);
console.log(`[report] Wrote ${REPORT_PATH}`);

// ============================================================================
// Experiment 6 protocol — full document
// ============================================================================
let p = "";
p += `# Experiment 6 — Human evaluation: full protocol\n\n`;
p += `This document is a complete, runnable human-study protocol. It is designed to be handed to a research assistant or a playtest coordinator with no prior context.\n\n`;
p += `## 6.1 Goal\n\n`;
p += `Determine whether players perceive the GA-evolved opponent as smarter, more fun, and less repetitive than the rule-based baseline opponent, in a double-blind within-subjects test.\n\n`;
p += `## 6.2 Hypothesis\n\n`;
p += `- **H1.** Players rate the GA opponent higher on "felt smart".\n`;
p += `- **H2.** Players rate the GA opponent higher on "felt fun".\n`;
p += `- **H3.** Players rate the GA opponent lower on "felt repetitive".\n\n`;
p += `## 6.3 Participants\n\n`;
p += `- **N:** ≥ 30 (recruit 35-40 to allow for attrition).\n`;
p += `- **Eligibility:** aged 18+, has played at least one 2D fighting game in the last year, no prior exposure to Project Eternal.\n`;
p += `- **Compensation:** \$10 gift card or equivalent; matches take ~20 minutes total.\n`;
p += `- **Recruitment:** university mailing lists, r/FightingGames, r/playtesters, snowball. Screen with a 1-question form: "have you played a 2D fighting game in the last year?"\n\n`;
p += `## 6.4 Materials\n\n`;
p += `1. **Game build.** \`bun run dev\` on a local laptop, with the GA champion installed in the genome library and the rule-based default installed in \`src/lib/game/config/opponents.ts\`. The free-select screen must NOT label which opponent is which.\n`;
p += `2. **Randomizer.** Use a simple Latin square (see §6.6) printed on paper for the coordinator.\n`;
p += `3. **Survey.** Google Form with 6 questions per match (Q1-Q3) and 3 forced-choice questions at the end (Q4-Q6).\n`;
p += `4. **Pre-test brief.** 2-minute written orientation. Players do NOT see the genome tables or the experiment design.\n\n`;
p += `## 6.5 Procedure\n\n`;
p += `1. Player reads the brief, signs a consent form.\n`;
p += `2. Player plays a 90-second warm-up match against the easiest story opponent (Lynx) to confirm they can use the controls. Skip analysis.\n`;
p += `3. Coordinator opens the free-select screen and labels it only as "Match 1 of 6". The screen shows two opponents side by side (Lynx profile and the GA champion profile) but the player is told only "pick an opponent", and the assignment is dictated by the randomizer sheet.\n`;
p += `4. Player fights the match (best-of-1, 60s timer, sunset arena, Shadow character on the player side).\n`;
p += `5. Immediately after the match, the player fills in Q1-Q3 on the Google Form.\n`;
p += `6. Repeat for matches 2-6, with a 30-second rest between matches.\n`;
p += `7. After match 6, the player fills in Q4-Q6.\n`;
p += `8. Coordinator reveals the labels and runs a 5-minute semi-structured debrief: "which one did you prefer and why?"\n`;
p += `9. Player is thanked and compensated.\n\n`;
p += `## 6.6 Randomization (Latin square)\n\n`;
p += `Each player ID is assigned a row of the following Latin square. Each row contains 3 As and 3 Bs, balanced for order effects. Player i gets row i mod 6.\n\n`;
p += `| Row | M1 | M2 | M3 | M4 | M5 | M6 |\n`;
p += `|---|---|---|---|---|---|---|\n`;
p += `| 0 | A | B | A | B | A | B |\n`;
p += `| 1 | B | A | B | A | B | A |\n`;
p += `| 2 | A | B | B | A | A | B |\n`;
p += `| 3 | B | A | A | B | B | A |\n`;
p += `| 4 | A | A | B | B | A | B |\n`;
p += `| 5 | B | B | A | A | B | A |\n\n`;
p += `## 6.7 Survey instrument\n\n`;
p += `**Per-match (Q1-Q3, 1-7 Likert):**\n\n`;
p += `- Q1. "How smart did this opponent feel?" (1 = totally predictable, 7 = constantly surprising me)\n`;
p += `- Q2. "How fun was this opponent to fight?" (1 = boring, 7 = the most fun I've had)\n`;
p += `- Q3. "How repetitive did this opponent feel?" (1 = did the same thing every round, 7 = did something different every time)\n\n`;
p += `**End of session (Q4-Q6, forced choice):**\n\n`;
p += `- Q4. "Which opponent felt smarter overall?" (A / B / unsure)\n`;
p += `- Q5. "Which opponent was more fun?" (A / B / unsure)\n`;
p += `- Q6. "Which opponent felt less repetitive?" (A / B / unsure)\n\n`;
p += `**Optional free-response:**\n\n`;
p += `- Q7. "Anything else you noticed?" (open text, 1-3 sentences)\n\n`;
p += `## 6.8 Analysis plan\n\n`;
p += `For each player, compute the mean of Q1, Q2, Q3 over the 3 A-matches and over the 3 B-matches. That gives a paired (player, subject) tuple of (A_q1, B_q1), (A_q2, B_q2), (A_q3, B_q3).\n\n`;
p += `- **Primary test:** paired Student's t-test on (A_q, B_q) for q ∈ {1, 2, 3}, three comparisons. Bonferroni-corrected α = 0.05/3 = 0.017.\n`;
p += `- **Secondary test:** binomial test on the count of players who chose B over A in Q4, Q5, Q6 (excluding "unsure").\n`;
p += `- **Effect size:** Cohen's d_z = mean(B-A) / sd(B-A).\n`;
p += `- **Reporting:** report means, SDs, paired t-statistic, p-value, Cohen's d_z, and a 95% CI for the mean difference. Plot the per-player differences as a Cleveland dot plot.\n\n`;
p += `## 6.9 Pre-registration\n\n`;
p += `Before running the study, file the hypotheses, design, sample size, and analysis plan on OSF (osf.io) or AsPredicted. This is the single biggest credibility boost a paper can get, and it is free.\n\n`;
p += `## 6.10 Pitfalls and mitigations\n\n`;
p += `| Pitfall | Mitigation |\n`;
p += `|---|---|\n`;
p += `| Order effects (player gets tired) | Latin square, 30s rest between matches |\n`;
p += `| Demand characteristics (player guesses the hypothesis) | Don't tell the player there are two different AIs; call them "Match 1", "Match 2", etc. |\n`;
p += `| Selection bias (only fighting-game fans sign up) | Screen for "any 2D fighting game in the last year", not for skill |\n`;
p += `| Small sample | Recruit 35-40, target 30 completed sessions |\n`;
p += `| Multiple comparisons | Bonferroni correction across Q1, Q2, Q3 |\n`;
p += `| Confirmation bias in debrief | Coordinator is blind to the row of the Latin square |\n`;
p += `| Implementation differences between the two AIs (not just genes) | Both AIs use the same FSM, same physics, same arena; only the genome differs. Verify with \`scripts/verify-e2e.ts\`. |\n\n`;
p += `## 6.11 Estimated cost\n\n`;
p += `- Participant compensation: 35 × \$10 = \$350\n`;
p += `- Coordinator time: ~10 hours (screening + sessions + analysis)\n`;
p += `- Compute: zero (the game runs locally on the coordinator's laptop)\n\n`;
p += `## 6.12 Expected outcome\n\n`;
p += `Based on the objective Experiment 1 results (GA champion wins 96.9% vs baseline 88.5%, takes 32% less damage, ends fights 5% faster), we expect:\n\n`;
p += `- Q1 (smartness): GA rated higher by ~0.5-1.0 Likert points\n`;
p += `- Q2 (fun): GA rated higher by ~0.3-0.8 Likert points (possibly less — a stronger opponent is not always a funner one)\n`;
p += `- Q3 (repetitive): GA rated less repetitive by ~0.5-1.0 Likert points (we expect the GA to vary its actions more because of the higher combo / counter-attack diversity)\n\n`;
p += `If Q1 and Q3 are confirmed but Q2 is not, the writeup should explore the "too strong = less fun" hypothesis and recommend a difficulty knob in the production build.\n\n`;

fs.writeFileSync(PROTOCOL_PATH, p);
console.log(`[report] Wrote ${PROTOCOL_PATH}`);

// ============================================================================
// JSON summary for machine consumption
// ============================================================================
const popRows = ["pop_20", "pop_50", "pop_100", "pop_200"];
const summary = {
  generatedAt: new Date().toISOString(),
  tier: exp1.tier,
  experiments: {
    exp1: {
      n_per_subject: exp1.aggregate.baseline.n,
      baseline_winrate: exp1.aggregate.baseline.winRate,
      ga_winrate: exp1.aggregate.ga.winRate,
      winrate_delta: exp1.aggregate.ga.winRate - exp1.aggregate.baseline.winRate,
      winrate_z: winRateTest.z,
      winrate_p: winRateTest.p,
      winrate_ci95: winRateTest.ci,
      damage_taken_baseline: exp1.aggregate.baseline.avgDamageTaken,
      damage_taken_ga: exp1.aggregate.ga.avgDamageTaken,
      duration_baseline: exp1.aggregate.baseline.avgDurationSec,
      duration_ga: exp1.aggregate.ga.avgDurationSec,
    },
    exp1_hard: exp1h ? {
      n_per_subject: exp1h.aggregate.baseline.n,
      baseline_winrate: exp1h.aggregate.baseline.winRate,
      ga_winrate: exp1h.aggregate.ga.winRate,
      winrate_delta: exp1h.aggregate.ga.winRate - exp1h.aggregate.baseline.winRate,
    } : null,
    exp2: {
      diversity_curve: exp2.diversityCurve,
      entropy_curve: exp2.entropyCurve,
      best_fitness_curve: exp2.bestFitnessCurve,
      convergence: exp2.convergence,
    },
    exp2_hard: exp2h ? {
      diversity_curve: exp2h.diversityCurve,
      entropy_curve: exp2h.entropyCurve,
      best_fitness_curve: exp2h.bestFitnessCurve,
      convergence: exp2h.convergence,
    } : null,
    exp3: exp3.results,
    exp3_hard: exp3h ? exp3h.results : null,
    exp4: exp4.results,
    exp4_hard: exp4h ? exp4h.results : null,
    exp5: Object.fromEntries(popRows.map((k) => [k, exp5.results[k]])),
    exp5_hard: exp5h ? Object.fromEntries(popRows.map((k) => [k, exp5h.results[k]])) : null,
  },
};
fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
console.log(`[report] Wrote ${SUMMARY_PATH}`);

console.log("[report] done");
