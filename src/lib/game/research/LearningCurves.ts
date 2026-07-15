// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — LEARNING CURVES
//
// PHASE 9 of the publication-quality evaluation layer.
//
// Tracks evolution over time. Given a sequence of generation snapshots
// (or, more generally, any time series of population statistics),
// produces a learning curve with:
//
//   - best / mean / worst fitness
//   - population diversity
//   - mutation success rate
//   - genome entropy (Shannon)
//   - novelty (avg distance to nearest neighbour)
//
// Detects:
//   - Plateaus
//   - Premature convergence
//   - Population collapse
//
// Reuses:
//   - IGenerationSnapshot from evolution/types (when available)
//   - shannonEntropy from simulator/StatisticsEngine
//   - genomeDistance from evolution/Genome
// ============================================================================

import type { LearningCurve, LearningCurvePoint } from "./types";
import { IGenome, IGenerationSnapshot } from "../evolution/types";
import { genomeDistance } from "../evolution/Genome";
import { shannonEntropy } from "../simulator/StatisticsEngine";

// ----------------------------------------------------------------------------
// Curve construction
// ----------------------------------------------------------------------------

/** Build a learning curve from raw generation snapshots. */
export function learningCurveFromSnapshots(
  id: string,
  snapshots: IGenerationSnapshot[],
  populations: IGenome[][],
): LearningCurve {
  const points: LearningCurvePoint[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]!;
    const pop = populations[i] ?? [];
    // Compute mutation success rate from mutationEvents vs population
    const mutationSuccess = pop.length > 0 && snap.mutationEvents
      ? Math.min(1, snap.mutationEvents.length / pop.length)
      : 0;
    points.push({
      generation: snap.generation,
      bestFitness: snap.bestFitness,
      meanFitness: snap.averageFitness,
      worstFitness: snap.worstFitness ?? snap.bestFitness,
      diversity: snap.diversity ?? computeDiversity(pop),
      mutationSuccess,
      entropy: snap.entropy ?? computeEntropy(pop),
      novelty: computeNovelty(pop),
    });
  }
  return { id, points, convergence: detectConvergence(points) };
}

/** Build a learning curve from raw arrays (no IGenerationSnapshot). */
export function learningCurveFromRaw(
  id: string,
  data: {
    best: number[];
    mean: number[];
    worst: number[];
    diversity: number[];
    mutationSuccess: number[];
    populations: IGenome[][];
  },
): LearningCurve {
  const points: LearningCurvePoint[] = [];
  for (let i = 0; i < data.best.length; i++) {
    const pop = data.populations[i] ?? [];
    points.push({
      generation: i,
      bestFitness: data.best[i]!,
      meanFitness: data.mean[i]!,
      worstFitness: data.worst[i]!,
      diversity: data.diversity[i]!,
      mutationSuccess: data.mutationSuccess[i]!,
      entropy: computeEntropy(pop),
      novelty: computeNovelty(pop),
    });
  }
  return { id, points, convergence: detectConvergence(points) };
}

// ----------------------------------------------------------------------------
// Convergence detection
// ----------------------------------------------------------------------------

export function detectConvergence(points: LearningCurvePoint[]): LearningCurve["convergence"] {
  if (points.length === 0) {
    return {
      converged: false, plateauGenerations: 0, collapsed: false,
      collapseGeneration: null, lastImprovementGen: 0, totalImprovement: 0,
    };
  }
  // Last improvement
  let lastImprovementGen = 0;
  let best = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.bestFitness > best + 1e-6) {
      best = points[i]!.bestFitness;
      lastImprovementGen = i;
    }
  }
  // Plateau
  const plateauGenerations = points.length - 1 - lastImprovementGen;
  // Converged if no improvement in 5+ generations
  const converged = plateauGenerations >= 5;
  // Collapse: diversity dropped below 0.01 for 5+ generations
  let collapseGeneration: number | null = null;
  let collapseStreak = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.diversity < 0.01) {
      collapseStreak++;
      if (collapseStreak >= 5 && collapseGeneration === null) {
        collapseGeneration = i - 4;
      }
    } else {
      collapseStreak = 0;
    }
  }
  const collapsed = collapseGeneration !== null;
  // Total improvement
  const first = points[0]!.bestFitness;
  const last = points[points.length - 1]!.bestFitness;
  const totalImprovement = last - first;
  return {
    converged,
    plateauGenerations,
    collapsed,
    collapseGeneration,
    lastImprovementGen,
    totalImprovement,
  };
}

// ----------------------------------------------------------------------------
// Diversity, entropy, novelty
// ----------------------------------------------------------------------------

function computeDiversity(population: IGenome[]): number {
  if (population.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < population.length; i++) {
    for (let j = i + 1; j < population.length; j++) {
      total += genomeDistance(population[i]!, population[j]!);
      pairs++;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}

function computeEntropy(population: IGenome[]): number {
  if (population.length === 0) return 0;
  // Discretise each gene into 10 bins, treat the per-genome histogram
  // as a discrete distribution, and average Shannon entropy.
  const genes: (keyof IGenome)[] = ["aggression", "blockChance", "reaction", "combo", "pressure"];
  let total = 0;
  for (const gene of genes) {
    const counts = new Array(10).fill(0);
    for (const g of population) {
      const v = (g as any)[gene] as number;
      if (typeof v !== "number") continue;
      const bin = Math.min(9, Math.floor(v * 10));
      counts[bin]++;
    }
    const probs = counts.map(c => c / Math.max(1, population.length));
    total += shannonEntropy(probs);
  }
  return total / genes.length;
}

function computeNovelty(population: IGenome[]): number {
  if (population.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < population.length; i++) {
    let minDist = Infinity;
    for (let j = 0; j < population.length; j++) {
      if (i === j) continue;
      const d = genomeDistance(population[i]!, population[j]!);
      if (d < minDist) minDist = d;
    }
    total += minDist;
  }
  return total / population.length;
}

// ----------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------

export function renderLearningCurveMd(curve: LearningCurve, title = "Learning Curve"): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- ID: ${curve.id}`);
  lines.push(`- Converged: ${curve.convergence.converged}`);
  lines.push(`- Plateau: ${curve.convergence.plateauGenerations} generations`);
  lines.push(`- Collapsed: ${curve.convergence.collapsed} (gen ${curve.convergence.collapseGeneration ?? "—"})`);
  lines.push(`- Last improvement: gen ${curve.convergence.lastImprovementGen}`);
  lines.push(`- Total improvement: ${curve.convergence.totalImprovement.toFixed(4)}`);
  lines.push("");
  if (curve.points.length === 0) return lines.join("\n");
  lines.push("| Gen | Best | Mean | Worst | Diversity | Mutation | Entropy | Novelty |");
  lines.push("|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const p of curve.points) {
    lines.push(`| ${p.generation} | ${p.bestFitness.toFixed(4)} | ${p.meanFitness.toFixed(4)} | ${p.worstFitness.toFixed(4)} | ${p.diversity.toFixed(4)} | ${(p.mutationSuccess * 100).toFixed(1)}% | ${p.entropy.toFixed(4)} | ${p.novelty.toFixed(4)} |`);
  }
  return lines.join("\n");
}

export function renderLearningCurveCsv(curve: LearningCurve): string {
  const lines = ["generation,best,mean,worst,diversity,mutationSuccess,entropy,novelty"];
  for (const p of curve.points) {
    lines.push([p.generation, p.bestFitness, p.meanFitness, p.worstFitness, p.diversity, p.mutationSuccess, p.entropy, p.novelty].join(","));
  }
  return lines.join("\n");
}

export function renderLearningCurveJson(curve: LearningCurve): string {
  return JSON.stringify(curve, null, 2);
}

export function renderLearningCurvePlotSpec(curve: LearningCurve): string {
  return JSON.stringify({
    type: "line",
    title: `Learning Curve: ${curve.id}`,
    x: { name: "Generation" },
    y: [
      { name: "Best Fitness", data: curve.points.map(p => p.bestFitness) },
      { name: "Mean Fitness", data: curve.points.map(p => p.meanFitness) },
      { name: "Worst Fitness", data: curve.points.map(p => p.worstFitness) },
    ],
    diversity: curve.points.map(p => p.diversity),
    mutationSuccess: curve.points.map(p => p.mutationSuccess),
    entropy: curve.points.map(p => p.entropy),
    novelty: curve.points.map(p => p.novelty),
    convergence: curve.convergence,
  }, null, 2);
}
