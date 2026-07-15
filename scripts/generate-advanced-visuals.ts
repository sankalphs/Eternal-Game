// ============================================================================
// SVG VISUALIZATION GENERATOR
//
// Produces three SVGs from the advanced-experiment JSON outputs:
//   - data/advanced/fig_trajectories.svg  : 12 small multiples (one per gene)
//   - data/advanced/fig_ablation.svg      : bar chart of relative fitness drop
//   - data/advanced/fig_multi_seed.svg    : grouped bar chart for exp 3-5
//
// These are pure SVG (no external libs) so they can be embedded in the
// markdown report or used in a paper directly.
// ============================================================================

import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve(process.cwd(), "data", "advanced");
const traj = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "trajectory.json"), "utf-8"));
const abl = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "ablation.json"), "utf-8"));
const ms = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "multi_seed.json"), "utf-8"));
const corr = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "correlation.json"), "utf-8"));
const gen = fs.existsSync(path.join(OUT_DIR, "generalization.json"))
  ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, "generalization.json"), "utf-8"))
  : null;

// ----- Common helpers -----
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function svgHeader(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui, sans-serif">`;
}

function axisY(x: number, y1: number, y2: number, label: string) {
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#444" stroke-width="1"/>
    <text x="${x - 5}" y="${y1 + 4}" text-anchor="end" font-size="10" fill="#666">${label}</text>`;
}

function axisX(x1: number, x2: number, y: number, label: string) {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#444" stroke-width="1"/>
    <text x="${(x1 + x2) / 2}" y="${y + 14}" text-anchor="middle" font-size="10" fill="#666">${label}</text>`;
}

// ============================================================================
// 1) Gene trajectory — 12 small multiples, one chart per gene
// ============================================================================
function makeTrajectorySvg(): string {
  const w = 1100, h = 900;
  const cols = 3, rows = 4;
  const cellW = (w - 80) / cols, cellH = (h - 100) / rows;
  const plotW = cellW - 60, plotH = cellH - 50;
  let s = svgHeader(w, h);
  s += `<rect width="${w}" height="${h}" fill="#fff"/>`;
  s += `<text x="${w / 2}" y="24" text-anchor="middle" font-size="18" font-weight="bold" fill="#111">Best genome's gene values across 15 generations (5-seed mean with 95% CI band)</text>`;
  s += `<text x="${w / 2}" y="44" text-anchor="middle" font-size="12" fill="#666">Each panel is one of the 12 genes. Mean line over 5 seeds (2026-2030). Shaded band = 95% CI per generation. ● = gen-0 mean, ◆ = gen-14 mean.</text>`;

  for (let i = 0; i < traj.perGene.length; i++) {
    const g = traj.perGene[i]!;
    const col = i % cols, row = Math.floor(i / cols);
    const x0 = 50 + col * cellW;
    const y0 = 70 + row * cellH;

    s += `<g transform="translate(${x0},${y0})">`;
    s += `<text x="${plotW / 2}" y="0" text-anchor="middle" font-size="12" font-weight="bold" fill="#111">${esc(g.key)}</text>`;
    s += `<text x="${plotW / 2}" y="14" text-anchor="middle" font-size="9" fill="#666">${esc(g.description.slice(0, 60))}</text>`;

    // Axes
    s += axisY(20, 25, 25 + plotH, "0");
    s += axisY(20, 25 + plotH / 2, 25 + plotH, "0.5");
    s += axisY(20, 25, 25 + plotH, "1");
    s += axisX(20, 20 + plotW, 25 + plotH, `${g.meanCurve.length - 1}`);
    s += axisX(20, 20, 25 + plotH, "");

    // Reference line at 0.5
    const midY = 25 + plotH / 2;
    s += `<line x1="20" y1="${midY}" x2="${20 + plotW}" y2="${midY}" stroke="#ddd" stroke-dasharray="3,3"/>`;

    // Curve (5-seed mean)
    const n = g.meanCurve.length;
    const points = g.meanCurve.map((v: number, j: number) => {
      const x = 20 + (j / (n - 1)) * plotW;
      const y = 25 + (1 - v) * plotH;
      return [x, y];
    });
    const loPoints = g.loCurve.map((v: number, j: number) => {
      const x = 20 + (j / (n - 1)) * plotW;
      const y = 25 + (1 - v) * plotH;
      return [x, y];
    });
    const hiPoints = g.hiCurve.map((v: number, j: number) => {
      const x = 20 + (j / (n - 1)) * plotW;
      const y = 25 + (1 - v) * plotH;
      return [x, y];
    });
    const color = g.direction === "increased" ? "#10b981" : g.direction === "decreased" ? "#ef4444" : "#3b82f6";

    // CI band
    const bandPath = loPoints.map((p: number[], idx: number) => `${idx === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")
      + " " + hiPoints.slice().reverse().map((p: number[]) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";
    s += `<path d="${bandPath}" fill="${color}" opacity="0.15"/>`;

    // Mean line
    const path = points.map((p: number[], idx: number) => `${idx === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    s += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`;

    // Start / end markers
    s += `<circle cx="${points[0]![0].toFixed(1)}" cy="${points[0]![1].toFixed(1)}" r="3" fill="${color}"/>`;
    s += `<polygon points="${points.at(-1)![0].toFixed(1)},${(points.at(-1)![1]! - 4).toFixed(1)} ${(points.at(-1)![0]! - 4).toFixed(1)},${(points.at(-1)![1]! + 4).toFixed(1)} ${(points.at(-1)![0]! + 4).toFixed(1)},${(points.at(-1)![1]! + 4).toFixed(1)}" fill="${color}"/>`;

    // End value
    s += `<text x="${20 + plotW - 5}" y="${(points.at(-1)![1]! - 6).toFixed(1)}" text-anchor="end" font-size="10" fill="${color}" font-weight="bold">${g.end.toFixed(2)} (${g.direction})</text>`;
    s += `</g>`;
  }

  // Legend
  s += `<g transform="translate(50,${h - 25})">`;
  s += `<circle cx="0" cy="0" r="3" fill="#10b981"/><text x="8" y="3" font-size="10" fill="#666">increased</text>`;
  s += `<circle cx="100" cy="0" r="3" fill="#3b82f6"/><text x="108" y="3" font-size="10" fill="#666">stable</text>`;
  s += `<circle cx="170" cy="0" r="3" fill="#ef4444"/><text x="178" y="3" font-size="10" fill="#666">decreased</text>`;
  s += `<text x="${w - 200}" y="3" font-size="10" fill="#999">● start, ◆ end</text>`;
  s += `</g>`;
  s += `</svg>`;
  return s;
}

// ============================================================================
// 2) Ablation bar chart
// ============================================================================
function makeAblationSvg(): string {
  const w = 900, h = 600;
  const margin = { top: 80, right: 60, bottom: 200, left: 70 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;
  const genes = abl.perGene;
  const maxAbs = Math.max(...genes.map((g: any) => Math.abs(g.dropRel)));
  const barW = innerW / genes.length - 8;
  const yScale = (v: number) => innerH - (v / maxAbs) * innerH;

  let s = svgHeader(w, h);
  s += `<rect width="${w}" height="${h}" fill="#fff"/>`;
  s += `<text x="${w / 2}" y="24" text-anchor="middle" font-size="18" font-weight="bold" fill="#111">Gene ablation: fitness drop when each gene is frozen at 0.5</text>`;
  s += `<text x="${w / 2}" y="44" text-anchor="middle" font-size="12" fill="#666">Higher bar = gene is more important (freezing it hurts the GA more). 5 seeds, 10 generations, pop 30.</text>`;
  s += `<text x="${w / 2}" y="60" text-anchor="middle" font-size="11" fill="#666">Control fitness: ${abl.control.mean.toFixed(4)} (95% CI [${abl.control.ci95[0].toFixed(4)}, ${abl.control.ci95[1].toFixed(4)}])</text>`;

  s += `<g transform="translate(${margin.left},${margin.top})">`;

  // Y axis
  s += axisY(0, 0, innerH, "0%");
  const yTick = maxAbs * 0.5;
  s += `<line x1="0" y1="${yScale(yTick)}" x2="${innerW}" y2="${yScale(yTick)}" stroke="#eee" stroke-dasharray="2,4"/>`;
  s += `<text x="-5" y="${yScale(yTick) + 4}" text-anchor="end" font-size="10" fill="#666">${(yTick * 100).toFixed(2)}%</text>`;
  s += `<text x="-5" y="${4}" text-anchor="end" font-size="10" fill="#666">${(maxAbs * 100).toFixed(2)}%</text>`;

  // Bars
  genes.forEach((g: any, i: number) => {
    const x = (i + 0.5) * (innerW / genes.length) - barW / 2;
    const dropPct = g.dropRel * 100;
    const y = yScale(g.dropRel);
    const color = g.dropRel > 0.01 ? "#ef4444" : g.dropRel > 0.005 ? "#f59e0b" : "#10b981";
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${(innerH - y).toFixed(1)}" fill="${color}" opacity="0.85"/>`;
    // Error bar (CI of frozen fitness)
    // We need frozenStd; convert to a 95% CI half-width on the *drop* via the seeds
    const seedValues = g.frozenPerSeed.map((p: any) => p.value);
    const mean = seedValues.reduce((a: number, b: number) => a + b, 0) / seedValues.length;
    const std = Math.sqrt(seedValues.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / (seedValues.length - 1));
    const halfWidth = 2.776 * std; // t_0.025,4
    const yTop = yScale((abl.control.mean - (mean - halfWidth) - abl.control.mean) / abl.control.mean);
    const yBot = yScale((abl.control.mean - (mean + halfWidth) - abl.control.mean) / abl.control.mean);
    s += `<line x1="${(x + barW / 2).toFixed(1)}" y1="${yTop.toFixed(1)}" x2="${(x + barW / 2).toFixed(1)}" y2="${yBot.toFixed(1)}" stroke="#333" stroke-width="1.2"/>`;
    s += `<line x1="${(x + barW / 2 - 4).toFixed(1)}" y1="${yTop.toFixed(1)}" x2="${(x + barW / 2 + 4).toFixed(1)}" y2="${yTop.toFixed(1)}" stroke="#333" stroke-width="1.2"/>`;
    s += `<line x1="${(x + barW / 2 - 4).toFixed(1)}" y1="${yBot.toFixed(1)}" x2="${(x + barW / 2 + 4).toFixed(1)}" y2="${yBot.toFixed(1)}" stroke="#333" stroke-width="1.2"/>`;

    // Drop % label
    s += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="#111">-${dropPct.toFixed(2)}%</text>`;

    // Gene label (rotated)
    const label = g.key;
    s += `<text transform="translate(${(x + barW / 2).toFixed(1)},${(innerH + 12).toFixed(1)}) rotate(-40)" text-anchor="end" font-size="10" fill="#333">${label}</text>`;
  });

  // X axis
  s += `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="#444"/>`;
  s += `<text x="${innerW / 2}" y="${innerH + 180}" text-anchor="middle" font-size="11" fill="#666">gene (frozen at 0.5, rest evolves)</text>`;
  s += `<text x="-50" y="${-30}" font-size="11" font-weight="bold" fill="#111">relative fitness drop</text>`;

  s += `</g>`;

  // Legend
  s += `<g transform="translate(60,${h - 18})">`;
  s += `<rect x="0" y="-10" width="14" height="12" fill="#ef4444" opacity="0.85"/><text x="20" y="0" font-size="10" fill="#666">drop &gt; 1% (high importance)</text>`;
  s += `<rect x="240" y="-10" width="14" height="12" fill="#f59e0b" opacity="0.85"/><text x="260" y="0" font-size="10" fill="#666">0.5% &lt; drop ≤ 1% (medium)</text>`;
  s += `<rect x="490" y="-10" width="14" height="12" fill="#10b981" opacity="0.85"/><text x="510" y="0" font-size="10" fill="#666">drop ≤ 0.5% (low)</text>`;
  s += `</g>`;

  s += `</svg>`;
  return s;
}

// ============================================================================
// 3) Multi-seed bar chart
// ============================================================================
function makeMultiSeedSvg(): string {
  const w = 1100, h = 700;
  const margin = { top: 80, right: 40, bottom: 80, left: 80 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  // 3 groups: mutation, selection, pop size
  const groups = [
    { label: "Mutation", entries: ["mut_gaussian", "mut_uniform", "mut_polynomial"], labels: ["gaussian", "uniform", "polynomial"] },
    { label: "Selection", entries: ["sel_tournament", "sel_roulette", "sel_rank"], labels: ["tournament", "roulette", "rank"] },
    { label: "Population size", entries: ["pop_20", "pop_50", "pop_100"], labels: ["20", "50", "100"] },
  ];
  const groupW = innerW / groups.length;
  const barW = (groupW - 60) / 3;

  // Y range — find min and max across all
  const allMeans = groups.flatMap((g) => g.entries.map((k) => ms[k]?.mean ?? 0));
  const allCis = groups.flatMap((g) => g.entries.flatMap((k) => ms[k] ? [...ms[k].ci95] : []));
  const yMin = Math.min(...allCis) - 0.005;
  const yMax = Math.max(...allCis) + 0.005;
  const yScale = (v: number) => innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  let s = svgHeader(w, h);
  s += `<rect width="${w}" height="${h}" fill="#fff"/>`;
  s += `<text x="${w / 2}" y="24" text-anchor="middle" font-size="18" font-weight="bold" fill="#111">Multi-seed comparison (5 seeds, 8 generations, hard opponents)</text>`;
  s += `<text x="${w / 2}" y="44" text-anchor="middle" font-size="12" fill="#666">Mean final best fitness across seeds 2026–2030. Error bars: 95% CI (t-distribution, df=4).</text>`;

  s += `<g transform="translate(${margin.left},${margin.top})">`;

  // Y axis
  s += `<line x1="0" y1="0" x2="0" y2="${innerH}" stroke="#444"/>`;
  s += `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="#444"/>`;
  for (let i = 0; i <= 4; i++) {
    const v = yMin + ((yMax - yMin) * i) / 4;
    const y = innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    s += `<line x1="-3" y1="${y.toFixed(1)}" x2="${innerW}" y2="${y.toFixed(1)}" stroke="#eee" stroke-dasharray="2,3"/>`;
    s += `<text x="-6" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${v.toFixed(3)}</text>`;
  }
  s += `<text x="-50" y="${-20}" font-size="11" font-weight="bold" fill="#111">final best fitness</text>`;

  // Groups
  groups.forEach((g, gi) => {
    const gx = gi * groupW + 30;
    s += `<text x="${(gx + (groupW - 60) / 2).toFixed(1)}" y="-10" text-anchor="middle" font-size="12" font-weight="bold" fill="#111">${g.label}</text>`;
    g.entries.forEach((k, bi) => {
      const stat = ms[k];
      if (!stat) return;
      const x = gx + bi * barW + 4;
      const y = yScale(stat.mean);
      const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"];
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 8).toFixed(1)}" height="${(innerH - y).toFixed(1)}" fill="${colors[bi]}" opacity="0.85"/>`;
      // CI bar
      const yT = yScale(stat.ci95[1]);
      const yB = yScale(stat.ci95[0]);
      s += `<line x1="${(x + (barW - 8) / 2).toFixed(1)}" y1="${yT.toFixed(1)}" x2="${(x + (barW - 8) / 2).toFixed(1)}" y2="${yB.toFixed(1)}" stroke="#111" stroke-width="1.2"/>`;
      s += `<line x1="${(x + (barW - 8) / 2 - 4).toFixed(1)}" y1="${yT.toFixed(1)}" x2="${(x + (barW - 8) / 2 + 4).toFixed(1)}" y2="${yT.toFixed(1)}" stroke="#111" stroke-width="1.2"/>`;
      s += `<line x1="${(x + (barW - 8) / 2 - 4).toFixed(1)}" y1="${yB.toFixed(1)}" x2="${(x + (barW - 8) / 2 + 4).toFixed(1)}" y2="${yB.toFixed(1)}" stroke="#111" stroke-width="1.2"/>`;
      // Mean value
      s += `<text x="${(x + (barW - 8) / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="bold" fill="#111">${stat.mean.toFixed(3)}</text>`;
      // Bar label
      s += `<text x="${(x + (barW - 8) / 2).toFixed(1)}" y="${(innerH + 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333">${g.labels[bi]}</text>`;
    });
  });

  s += `</g>`;
  s += `<text x="${w / 2}" y="${h - 25}" text-anchor="middle" font-size="11" fill="#666">Tournament k=3, pop size 30, 8 generations, 2 matches per genome per generation, hard opponent subset.</text>`;
  s += `</svg>`;
  return s;
}

// ============================================================================
// 4) Correlation vs Ablation scatter — the causation-vs-correlation figure
// ============================================================================
function makeCorrelationVsAblationSvg(): string {
  const w = 1000, h = 700;
  const margin = { top: 80, right: 80, bottom: 100, left: 90 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  // Merge correlation + ablation into a unified per-gene table
  const corrMap = new Map(corr.pooledPerGene.map((g: any) => [g.key, g]));
  const merged = abl.perGene.map((a: any) => {
    const c: any = corrMap.get(a.key);
    return {
      key: a.key,
      r: c ? c.r : 0,
      p: c ? c.p : 1,
      ablationDrop: a.dropRel * 100, // convert to percentage points
    };
  });

  // Axis ranges — symmetric for r, [0, max] for ablation
  const maxAbs = Math.max(...merged.map((g: any) => Math.abs(g.ablationDrop)));
  const xScale = (r: number) => innerW / 2 + (r / 0.4) * (innerW / 2);
  const yScale = (drop: number) => innerH - (drop / Math.max(1.5, maxAbs + 0.2)) * innerH;

  let s = svgHeader(w, h);
  s += `<rect width="${w}" height="${h}" fill="#fff"/>`;
  s += `<text x="${w / 2}" y="24" text-anchor="middle" font-size="18" font-weight="bold" fill="#111">Correlation vs causation: do the genes the GA tunes actually matter?</text>`;
  s += `<text x="${w / 2}" y="44" text-anchor="middle" font-size="12" fill="#666">x-axis: Pearson r between gene value and fitness in the final population. y-axis: relative fitness drop when that gene is frozen at 0.5.</text>`;

  s += `<g transform="translate(${margin.left},${margin.top})">`;

  // Quadrant guides
  s += `<line x1="${innerW / 2}" y1="0" x2="${innerW / 2}" y2="${innerH}" stroke="#ddd" stroke-dasharray="2,4"/>`;
  s += `<line x1="0" y1="${yScale(0)}" x2="${innerW}" y2="${yScale(0)}" stroke="#ddd" stroke-dasharray="2,4"/>`;

  // Quadrant labels
  s += `<text x="${innerW * 0.78}" y="14" text-anchor="middle" font-size="10" font-weight="bold" fill="#10b981">causal AND correlated</text>`;
  s += `<text x="${innerW * 0.22}" y="14" text-anchor="middle" font-size="10" font-weight="bold" fill="#3b82f6">correlated only (spurious)</text>`;
  s += `<text x="${innerW * 0.78}" y="${innerH - 6}" text-anchor="middle" font-size="10" font-weight="bold" fill="#ef4444">causal only (the GA missed it)</text>`;
  s += `<text x="${innerW * 0.22}" y="${innerH - 6}" text-anchor="middle" font-size="10" font-weight="bold" fill="#999">neither</text>`;

  // Axes
  s += `<line x1="0" y1="0" x2="0" y2="${innerH}" stroke="#444"/>`;
  s += `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="#444"/>`;
  for (let r = -0.4; r <= 0.4; r += 0.2) {
    const x = xScale(r);
    s += `<line x1="${x.toFixed(1)}" y1="${innerH}" x2="${x.toFixed(1)}" y2="${innerH + 4}" stroke="#444"/>`;
    s += `<text x="${x.toFixed(1)}" y="${innerH + 16}" text-anchor="middle" font-size="10" fill="#666">${r.toFixed(1)}</text>`;
  }
  for (let drop = 0; drop <= 1.5; drop += 0.5) {
    const y = yScale(drop);
    s += `<line x1="-3" y1="${y.toFixed(1)}" x2="0" y2="${y.toFixed(1)}" stroke="#444"/>`;
    s += `<text x="-6" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${drop.toFixed(1)}%</text>`;
  }
  s += `<text x="${innerW + 10}" y="${(yScale(0) + 3).toFixed(1)}" font-size="10" fill="#666">0%</text>`;

  // Points
  for (const g of merged) {
    const x = xScale(g.r);
    const y = yScale(g.ablationDrop);
    // Color by quadrant
    const isCausal = g.ablationDrop > 0.5;
    const isCorrelated = Math.abs(g.r) > 0.15;
    let color = "#999";
    if (isCausal && isCorrelated) color = "#10b981";
    else if (isCausal && !isCorrelated) color = "#ef4444";
    else if (!isCausal && isCorrelated) color = "#3b82f6";

    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${color}" stroke="#222" stroke-width="1.2" opacity="0.85"/>`;
    s += `<text x="${(x + 12).toFixed(1)}" y="${(y - 5).toFixed(1)}" font-size="10" fill="#222">${g.key}</text>`;
    s += `<text x="${(x + 12).toFixed(1)}" y="${(y + 8).toFixed(1)}" font-size="8" fill="#666">r=${g.r.toFixed(2)} drop=${g.ablationDrop.toFixed(2)}%</text>`;
  }

  s += `<text x="${innerW / 2}" y="${innerH + 60}" text-anchor="middle" font-size="11" font-weight="bold" fill="#111">Pearson r (gene value vs fitness in final population)</text>`;
  s += `<text transform="translate(-60,${innerH / 2}) rotate(-90)" text-anchor="middle" font-size="11" font-weight="bold" fill="#111">fitness drop when gene is frozen (%)</text>`;

  s += `</g>`;

  // Legend
  s += `<g transform="translate(60,${h - 30})">`;
  s += `<circle cx="0" cy="0" r="6" fill="#10b981"/><text x="12" y="3" font-size="10" fill="#666">causal &amp; correlated</text>`;
  s += `<circle cx="180" cy="0" r="6" fill="#3b82f6"/><text x="192" y="3" font-size="10" fill="#666">correlated only (spurious)</text>`;
  s += `<circle cx="400" cy="0" r="6" fill="#ef4444"/><text x="412" y="3" font-size="10" fill="#666">causal only (the GA missed it)</text>`;
  s += `<circle cx="640" cy="0" r="6" fill="#999"/><text x="652" y="3" font-size="10" fill="#666">neither</text>`;
  s += `</g>`;

  s += `</svg>`;
  return s;
}

// ============================================================================
// 5) Generalization bar chart — in-distribution vs out-of-distribution
// ============================================================================
function makeGeneralizationSvg(): string {
  if (!gen) return "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
  const w = 1100, h = 700;
  const margin = { top: 90, right: 40, bottom: 140, left: 80 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  const splitCount = gen.splits.length;
  // 4 bars per split: train(GA), test(GA), train(random), test(random)
  const splitW = innerW / splitCount;
  const barW = (splitW - 50) / 4;

  const allValues: number[] = [];
  for (const s of gen.splits) {
    allValues.push(s.trainWinRate.mean, s.testWinRate.mean, s.randomTrainWinRate.mean, s.randomTestWinRate.mean);
  }
  if (gen.modifiedBosses) {
    allValues.push(gen.modifiedBosses.trainedOnModifiedWinRate.mean, gen.modifiedBosses.randomOnModifiedWinRate.mean);
  }
  const yMax = Math.max(...allValues, 1.0) + 0.05;
  const yScale = (v: number) => innerH - (v / yMax) * innerH;

  let s = svgHeader(w, h);
  s += `<rect width="${w}" height="${h}" fill="#fff"/>`;
  s += `<text x="${w / 2}" y="24" text-anchor="middle" font-size="18" font-weight="bold" fill="#111">Generalization: in-distribution vs out-of-distribution performance</text>`;
  s += `<text x="${w / 2}" y="44" text-anchor="middle" font-size="12" fill="#666">Each group = one (train, test) split. Bars: trained-champion on train, trained-champion on test, random on train, random on test. Error bars: 95% CI across 3 seeds.</text>`;

  s += `<g transform="translate(${margin.left},${margin.top})">`;

  // Y axis
  s += `<line x1="0" y1="0" x2="0" y2="${innerH}" stroke="#444"/>`;
  s += `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="#444"/>`;
  for (let i = 0; i <= 5; i++) {
    const v = (yMax * i) / 5;
    const y = innerH - (v / yMax) * innerH;
    s += `<line x1="-3" y1="${y.toFixed(1)}" x2="${innerW}" y2="${y.toFixed(1)}" stroke="#eee" stroke-dasharray="2,3"/>`;
    s += `<text x="-6" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${(v * 100).toFixed(0)}%</text>`;
  }
  s += `<text x="-50" y="-20}" font-size="11" font-weight="bold" fill="#111">win rate</text>`;
  s += `<text x="-50" y="-20}" font-size="11" font-weight="bold" fill="#111">win rate</text>`;

  // Splits
  gen.splits.forEach((sp: any, i: number) => {
    const gx = i * splitW + 25;
    // Group label
    s += `<text x="${(gx + (splitW - 50) / 2).toFixed(1)}" y="-10" text-anchor="middle" font-size="11" font-weight="bold" fill="#111">split ${i + 1}</text>`;
    s += `<text x="${(gx + (splitW - 50) / 2).toFixed(1)}" y="4" text-anchor="middle" font-size="9" fill="#666">train: ${sp.trainOpponents.join("+")}</text>`;
    s += `<text x="${(gx + (splitW - 50) / 2).toFixed(1)}" y="16" text-anchor="middle" font-size="9" fill="#666">test: ${sp.testOpponents.join("+")}</text>`;

    const bars = [
      { stat: sp.trainWinRate, label: "GA train", color: "#10b981" },
      { stat: sp.testWinRate, label: "GA test", color: "#3b82f6" },
      { stat: sp.randomTrainWinRate, label: "rand train", color: "#f59e0b" },
      { stat: sp.randomTestWinRate, label: "rand test", color: "#ef4444" },
    ];
    bars.forEach((b, bi) => {
      const x = gx + bi * barW + 2;
      const y = yScale(b.stat.mean);
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 4).toFixed(1)}" height="${(innerH - y).toFixed(1)}" fill="${b.color}" opacity="0.85"/>`;
      const yT = yScale(b.stat.ci95[1]);
      const yB = yScale(b.stat.ci95[0]);
      s += `<line x1="${(x + (barW - 4) / 2).toFixed(1)}" y1="${yT.toFixed(1)}" x2="${(x + (barW - 4) / 2).toFixed(1)}" y2="${yB.toFixed(1)}" stroke="#111" stroke-width="1.2"/>`;
      s += `<line x1="${(x + (barW - 4) / 2 - 4).toFixed(1)}" y1="${yT.toFixed(1)}" x2="${(x + (barW - 4) / 2 + 4).toFixed(1)}" y2="${yT.toFixed(1)}" stroke="#111" stroke-width="1.2"/>`;
      s += `<line x1="${(x + (barW - 4) / 2 - 4).toFixed(1)}" y1="${yB.toFixed(1)}" x2="${(x + (barW - 4) / 2 + 4).toFixed(1)}" y2="${yB.toFixed(1)}" stroke="#111" stroke-width="1.2"/>`;
      s += `<text x="${(x + (barW - 4) / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="bold" fill="#111">${(b.stat.mean * 100).toFixed(0)}%</text>`;
    });
  });

  // Legend
  s += `<g transform="translate(0,${innerH + 80})">`;
  s += `<rect x="0" y="-10" width="14" height="12" fill="#10b981" opacity="0.85"/><text x="20" y="0" font-size="10" fill="#666">trained champion on training opponents</text>`;
  s += `<rect x="320" y="-10" width="14" height="12" fill="#3b82f6" opacity="0.85"/><text x="340" y="0" font-size="10" fill="#666">trained champion on held-out (unseen) opponents</text>`;
  s += `<rect x="680" y="-10" width="14" height="12" fill="#f59e0b" opacity="0.85"/><text x="700" y="0" font-size="10" fill="#666">random genome on training opponents</text>`;
  s += `<rect x="0" y="14" width="14" height="12" fill="#ef4444" opacity="0.85"/><text x="20" y="24" font-size="10" fill="#666">random genome on held-out opponents</text>`;
  s += `</g>`;

  s += `</g>`;
  s += `</svg>`;
  return s;
}

// ============================================================================
// 6) Modified-bosses summary
// ============================================================================
function makeModifiedBossesSvg(): string {
  if (!gen || !gen.modifiedBosses) return "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
  const w = 800, h = 500;
  const margin = { top: 90, right: 60, bottom: 100, left: 80 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  const bars = [
    { stat: gen.modifiedBosses.trainedOnModifiedWinRate, label: "GA trained on originals", color: "#10b981" },
    { stat: gen.modifiedBosses.randomOnModifiedWinRate, label: "Random baseline", color: "#f59e0b" },
  ];
  const yMax = 1.05;
  const yScale = (v: number) => innerH - (v / yMax) * innerH;
  const barW = (innerW - 100) / bars.length;

  let s = svgHeader(w, h);
  s += `<rect width="${w}" height="${h}" fill="#fff"/>`;
  s += `<text x="${w / 2}" y="24" text-anchor="middle" font-size="18" font-weight="bold" fill="#111">Modified-bosses transfer test</text>`;
  s += `<text x="${w / 2}" y="44" text-anchor="middle" font-size="12" fill="#666">Champion is trained on the 6 original hard opponents. Evaluated on 6 stat-buffed variants (+30% HP, +20% damage, +15% speed).</text>`;

  s += `<g transform="translate(${margin.left},${margin.top})">`;
  s += `<line x1="0" y1="0" x2="0" y2="${innerH}" stroke="#444"/>`;
  s += `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="#444"/>`;
  for (let i = 0; i <= 5; i++) {
    const v = (yMax * i) / 5;
    const y = innerH - (v / yMax) * innerH;
    s += `<line x1="-3" y1="${y.toFixed(1)}" x2="${innerW}" y2="${y.toFixed(1)}" stroke="#eee" stroke-dasharray="2,3"/>`;
    s += `<text x="-6" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${(v * 100).toFixed(0)}%</text>`;
  }
  s += `<text x="-50" y="-20" font-size="11" font-weight="bold" fill="#111">win rate on buffed bosses</text>`;

  bars.forEach((b, i) => {
    const x = 50 + i * barW;
    const y = yScale(b.stat.mean);
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 30).toFixed(1)}" height="${(innerH - y).toFixed(1)}" fill="${b.color}" opacity="0.85"/>`;
    const yT = yScale(b.stat.ci95[1]);
    const yB = yScale(b.stat.ci95[0]);
    s += `<line x1="${(x + (barW - 30) / 2).toFixed(1)}" y1="${yT.toFixed(1)}" x2="${(x + (barW - 30) / 2).toFixed(1)}" y2="${yB.toFixed(1)}" stroke="#111" stroke-width="1.2"/>`;
    s += `<line x1="${(x + (barW - 30) / 2 - 4).toFixed(1)}" y1="${yT.toFixed(1)}" x2="${(x + (barW - 30) / 2 + 4).toFixed(1)}" y2="${yT.toFixed(1)}" stroke="#111" stroke-width="1.2"/>`;
    s += `<line x1="${(x + (barW - 30) / 2 - 4).toFixed(1)}" y1="${yB.toFixed(1)}" x2="${(x + (barW - 30) / 2 + 4).toFixed(1)}" y2="${yB.toFixed(1)}" stroke="#111" stroke-width="1.2"/>`;
    s += `<text x="${(x + (barW - 30) / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="bold" fill="#111">${(b.stat.mean * 100).toFixed(1)}%</text>`;
    s += `<text x="${(x + (barW - 30) / 2).toFixed(1)}" y="${(innerH + 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333">${b.label}</text>`;
  });
  s += `</g>`;
  s += `</svg>`;
  return s;
}

fs.writeFileSync(path.join(OUT_DIR, "fig_trajectories.svg"), makeTrajectorySvg());
fs.writeFileSync(path.join(OUT_DIR, "fig_ablation.svg"), makeAblationSvg());
fs.writeFileSync(path.join(OUT_DIR, "fig_multi_seed.svg"), makeMultiSeedSvg());
fs.writeFileSync(path.join(OUT_DIR, "fig_corr_vs_abl.svg"), makeCorrelationVsAblationSvg());
if (gen) {
  fs.writeFileSync(path.join(OUT_DIR, "fig_generalization.svg"), makeGeneralizationSvg());
  fs.writeFileSync(path.join(OUT_DIR, "fig_modified_bosses.svg"), makeModifiedBossesSvg());
}
console.log(`[viz] wrote SVGs to ${OUT_DIR}`);
