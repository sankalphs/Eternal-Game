// Generate a "fitness curve over generations" figure that shows the typical
// GA convergence behaviour. Pulls data from the existing trajectory.json.

import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve(process.cwd(), "data", "advanced");
const traj = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "trajectory.json"), "utf-8"));

const w = 1000, h = 540;
const margin = { top: 80, right: 40, bottom: 80, left: 80 };
const innerW = w - margin.left - margin.right;
const innerH = h - margin.top - margin.bottom;

const gens = traj.bestPerGen.length;

// Best curve is array of { mean, std, lo, hi } per generation
const yMin = Math.min(...traj.bestPerGen.map((p: any) => p.lo));
const yMax = Math.max(...traj.bestPerGen.map((p: any) => p.hi));
const yPad = (yMax - yMin) * 0.05;
const yLo = yMin - yPad;
const yHi = yMax + yPad;
const xScale = (g: number) => (g / (gens - 1)) * innerW;
const yScale = (v: number) => innerH - ((v - yLo) / (yHi - yLo)) * innerH;

function pathFromArray(arr: any[], key: string) {
  return arr.map((p: any, i: number) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(p[key]).toFixed(1)}`).join(" ");
}

function bandPath(loArr: any[], hiArr: any[]) {
  const lo = loArr.map((p: any, i: number) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(p.lo).toFixed(1)}`).join(" ");
  const hi = hiArr.slice().reverse().map((p: any, i: number) => `L${xScale(loArr.length - 1 - i).toFixed(1)},${yScale(p.hi).toFixed(1)}`).join(" ");
  return `${lo} ${hi} Z`;
}

let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui, sans-serif">`;
s += `<rect width="${w}" height="${h}" fill="#fff"/>`;
s += `<text x="${w / 2}" y="26" text-anchor="middle" font-size="18" font-weight="bold" fill="#111">Fitness across generations (5-seed mean with 95% CI)</text>`;
s += `<text x="${w / 2}" y="46" text-anchor="middle" font-size="12" fill="#666">Best-of-generation fitness (top) and mean population fitness (bottom). The champion is the highest best-fitness ever reached.</text>`;

s += `<g transform="translate(${margin.left},${margin.top})">`;

// Axes
s += `<line x1="0" y1="0" x2="0" y2="${innerH}" stroke="#444"/>`;
s += `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="#444"/>`;
for (let i = 0; i <= 5; i++) {
  const v = yLo + ((yHi - yLo) * i) / 5;
  const y = innerH - ((v - yLo) / (yHi - yLo)) * innerH;
  s += `<line x1="-3" y1="${y.toFixed(1)}" x2="${innerW}" y2="${y.toFixed(1)}" stroke="#eee" stroke-dasharray="2,3"/>`;
  s += `<text x="-6" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${v.toFixed(3)}</text>`;
}
for (let i = 0; i <= gens - 1; i += 2) {
  const x = xScale(i);
  s += `<line x1="${x.toFixed(1)}" y1="${innerH}" x2="${x.toFixed(1)}" y2="${innerH + 4}" stroke="#444"/>`;
  s += `<text x="${x.toFixed(1)}" y="${innerH + 16}" text-anchor="middle" font-size="10" fill="#666">${i}</text>`;
}

// Best band
s += `<path d="${bandPath(traj.bestPerGen, traj.bestPerGen.slice().reverse())}" fill="#10b981" opacity="0.18"/>`;
s += `<path d="${pathFromArray(traj.bestPerGen, "mean")}" fill="none" stroke="#10b981" stroke-width="2.5"/>`;

// Diversity band (use divPerGen)
s += `<path d="${bandPath(traj.divPerGen, traj.divPerGen.slice().reverse())}" fill="#3b82f6" opacity="0.15"/>`;
s += `<path d="${pathFromArray(traj.divPerGen, "mean")}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4,3"/>`;

// Annotate the champion point
const lastBest = traj.bestPerGen.at(-1)!.mean;
const lastX = xScale(gens - 1);
const lastY = yScale(lastBest);
s += `<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="5" fill="#10b981" stroke="#222" stroke-width="1.5"/>`;
s += `<text x="${(lastX - 10).toFixed(1)}" y="${(lastY - 12).toFixed(1)}" text-anchor="end" font-size="11" font-weight="bold" fill="#111">champion = ${lastBest.toFixed(4)}</text>`;

s += `<text x="${innerW / 2}" y="${innerH + 50}" text-anchor="middle" font-size="11" font-weight="bold" fill="#111">generation</text>`;
s += `<text transform="translate(-50,${innerH / 2}) rotate(-90)" text-anchor="middle" font-size="11" font-weight="bold" fill="#111">fitness / diversity</text>`;

s += `</g>`;

// Legend
s += `<g transform="translate(60,${h - 25})">`;
s += `<rect x="0" y="-10" width="14" height="12" fill="#10b981" opacity="0.18"/><line x1="7" y1="-4" x2="7" y2="6" stroke="#10b981" stroke-width="2.5"/><text x="20" y="0" font-size="10" fill="#666">best-of-generation fitness (5-seed mean ± 95% CI)</text>`;
s += `<rect x="380" y="-10" width="14" height="12" fill="#3b82f6" opacity="0.15"/><line x1="387" y1="-4" x2="387" y2="6" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4,3"/><text x="400" y="0" font-size="10" fill="#666">population diversity (1 - normalised, 5-seed mean)</text>`;
s += `</g>`;

s += `</svg>`;

fs.writeFileSync(path.join(OUT_DIR, "fig_convergence.svg"), s);
fs.copyFileSync(path.join(OUT_DIR, "fig_convergence.svg"), path.resolve(process.cwd(), "paper", "figures", "fig_convergence.svg"));
console.log(`[convergence] wrote ${OUT_DIR}/fig_convergence.svg`);
