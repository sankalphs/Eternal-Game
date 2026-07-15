// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — GENOME CLUSTERING
//
// PHASE 7 of the publication-quality evaluation layer.
//
// Three algorithms (K-Means, Hierarchical agglomerative, DBSCAN)
// plus PCA projection for 2D visualisation. Identifies the canonical
// style clusters ("aggressive", "counter", "adaptive", "hybrid",
// "outlier") automatically from the cluster centroids.
//
// Reuses:
//   - IGenome from evolution/types
//   - genomeDistance from evolution/Genome (for hierarchical + DBSCAN)
// ============================================================================

import type { IGenome } from "../evolution/types";
import { genomeDistance, GENOME_SPECS, GENE_KEYS } from "../evolution/Genome";
import type { ClusterAssignment, ClusterResult } from "./types";
import { Rng } from "../simulator/Rng";

// ----------------------------------------------------------------------------
// Distance & normalisation
// ----------------------------------------------------------------------------

/** Convert a genome to a numeric feature vector. */
export function genomeToFeatures(genome: IGenome): number[] {
  const out: number[] = [];
  for (const key of GENE_KEYS) {
    const v = (genome as any)[key];
    if (typeof v === "number") out.push(v);
  }
  return out;
}

/** Z-normalise a feature matrix (rows = samples, cols = features). */
export function zNormalise(X: number[][]): { normalised: number[][]; mean: number[]; std: number[] } {
  if (X.length === 0) return { normalised: [], mean: [], std: [] };
  const nFeat = X[0]!.length;
  const mean = new Array(nFeat).fill(0);
  const std = new Array(nFeat).fill(0);
  for (const row of X) for (let j = 0; j < nFeat; j++) mean[j]! += row[j]!;
  for (let j = 0; j < nFeat; j++) mean[j]! /= X.length;
  for (const row of X) for (let j = 0; j < nFeat; j++) std[j]! += (row[j]! - mean[j]!) ** 2;
  for (let j = 0; j < nFeat; j++) std[j]! = Math.sqrt(std[j]! / X.length) || 1;
  const normalised = X.map(row => row.map((v, j) => (v - mean[j]!) / std[j]!));
  return { normalised, mean, std };
}

// ----------------------------------------------------------------------------
// PCA
// ----------------------------------------------------------------------------

/**
 * Principal Component Analysis via power iteration on the
 * covariance matrix. Returns 2 components by default.
 */
export function pca(X: number[][], nComponents = 2): { components: number[][]; varianceExplained: number[]; projected: number[][] } {
  if (X.length === 0) return { components: [], varianceExplained: [], projected: [] };
  const nFeat = X[0]!.length;
  // Centre the data
  const mean = new Array(nFeat).fill(0);
  for (const row of X) for (let j = 0; j < nFeat; j++) mean[j]! += row[j]!;
  for (let j = 0; j < nFeat; j++) mean[j]! /= X.length;
  const Xc = X.map(row => row.map((v, j) => v - mean[j]!));
  // Covariance
  const cov: number[][] = [];
  for (let i = 0; i < nFeat; i++) {
    cov.push(new Array(nFeat).fill(0));
    for (let j = 0; j < nFeat; j++) {
      let s = 0;
      for (const row of Xc) s += row[i]! * row[j]!;
      cov[i]![j] = s / X.length;
    }
  }
  // Power iteration to extract nComponents eigenvectors
  const components: number[][] = [];
  const eigenvalues: number[] = [];
  const covWork = cov.map(r => r.slice());
  for (let k = 0; k < Math.min(nComponents, nFeat); k++) {
    let v = new Array(nFeat).fill(0).map(() => Math.random());
    // Normalise
    let nrm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    v = v.map(x => x / nrm);
    for (let iter = 0; iter < 200; iter++) {
      const Av: number[] = new Array(nFeat);
      for (let i = 0; i < nFeat; i++) {
        let s = 0;
        for (let j = 0; j < nFeat; j++) s += covWork[i]![j]! * v[j]!;
        Av[i] = s;
      }
      const newNrm = Math.sqrt(Av.reduce((a, b) => a + b * b, 0));
      const newV = Av.map(x => x / newNrm);
      // Convergence
      const diff = Math.sqrt(newV.reduce((a, x, i) => a + (x - v[i]!) ** 2, 0));
      v = newV;
      if (diff < 1e-8) break;
    }
    // Eigenvalue (Rayleigh quotient)
    const Av = new Array(nFeat);
    for (let i = 0; i < nFeat; i++) {
      let s = 0;
      for (let j = 0; j < nFeat; j++) s += covWork[i]![j]! * v[j]!;
      Av[i] = s;
    }
    const eigenvalue = v.reduce((a, x, i) => a + x * Av[i]!, 0);
    components.push(v);
    eigenvalues.push(eigenvalue);
    // Deflate
    for (let i = 0; i < nFeat; i++) {
      for (let j = 0; j < nFeat; j++) {
        covWork[i]![j]! -= eigenvalue * v[i]! * v[j]!;
      }
    }
  }
  // Project
  const projected = Xc.map(row => components.map(comp =>
    row.reduce((a, x, i) => a + x * comp[i]!, 0),
  ));
  const totalVar = eigenvalues.reduce((a, b) => a + b, 0) || 1;
  const varianceExplained = eigenvalues.map(e => e / totalVar);
  return { components, varianceExplained, projected };
}

// ----------------------------------------------------------------------------
// K-Means
// ----------------------------------------------------------------------------

export function kmeans(
  X: number[][],
  k: number,
  seed = 42,
  maxIter = 100,
): { centroids: number[][]; labels: number[]; inertia: number } {
  if (X.length === 0 || k <= 0) return { centroids: [], labels: [], inertia: 0 };
  const rng = new Rng(seed);
  const nFeat = X[0]!.length;
  // Init: random samples
  const indices = X.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  const centroids: number[][] = indices.slice(0, k).map(i => X[i]!.slice());
  let labels = new Array(X.length).fill(0);
  let inertia = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    let changed = false;
    for (let i = 0; i < X.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = sqDist(X[i]!, centroids[c]!);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (labels[i] !== best) { changed = true; labels[i] = best; }
    }
    // Update
    for (let c = 0; c < k; c++) {
      const members = X.filter((_, i) => labels[i] === c);
      if (members.length === 0) continue;
      const newCentroid = new Array(nFeat).fill(0);
      for (const m of members) for (let j = 0; j < nFeat; j++) newCentroid[j]! += m[j]!;
      for (let j = 0; j < nFeat; j++) newCentroid[j]! /= members.length;
      centroids[c] = newCentroid;
    }
    if (!changed) break;
  }
  // Inertia
  inertia = 0;
  for (let i = 0; i < X.length; i++) {
    inertia += sqDist(X[i]!, centroids[labels[i]!]!);
  }
  return { centroids, labels, inertia };
}

function sqDist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i]! - b[i]!) ** 2;
  return s;
}

// ----------------------------------------------------------------------------
// Hierarchical agglomerative (single-linkage, average-linkage, complete-linkage)
// ----------------------------------------------------------------------------

export type Linkage = "single" | "average" | "complete";

export function hierarchical(
  X: number[][],
  linkage: Linkage = "average",
): { labels: number[]; mergeOrder: number[][]; distances: number[] } {
  // Initially each point is its own cluster
  const n = X.length;
  const labels = new Array(n).fill(0).map((_, i) => i);
  const mergeOrder: number[][] = [];
  const distances: number[] = [];
  // Use precomputed pairwise distance matrix
  const D: number[][] = [];
  for (let i = 0; i < n; i++) {
    D.push(new Array(n).fill(0));
    for (let j = i + 1; j < n; j++) {
      const d = Math.sqrt(sqDist(X[i]!, X[j]!));
      D[i]![j] = d;
      D[j]![i] = d;
    }
  }
  // Cluster representative points
  const clusters: number[][] = labels.slice().map(i => [i]);
  let nextLabel = n;
  while (clusters.length > 1) {
    // Find closest pair
    let bestI = 0, bestJ = 1, bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = clusterDistance(clusters[i]!, clusters[j]!, D, linkage);
        if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
      }
    }
    // Merge
    const merged = [...clusters[bestI]!, ...clusters[bestJ]!];
    clusters.splice(bestJ, 1);
    clusters.splice(bestI, 1);
    clusters.push(merged);
    mergeOrder.push([clusters[clusters.length - 1]![0]!, clusters[clusters.length - 1]![clusters[clusters.length - 1]!.length - 1]!]);
    distances.push(bestD);
    nextLabel++;
  }
  // Assign k = sqrt(n) clusters by cutting the dendrogram
  const k = Math.max(2, Math.round(Math.sqrt(n)));
  const finalLabels = cutDendrogram(mergeOrder, distances, n, k);
  return { labels: finalLabels, mergeOrder, distances };
}

function clusterDistance(c1: number[], c2: number[], D: number[][], linkage: Linkage): number {
  if (linkage === "single") {
    let best = Infinity;
    for (const i of c1) for (const j of c2) if (D[i]![j]! < best) best = D[i]![j]!;
    return best;
  }
  if (linkage === "complete") {
    let worst = -Infinity;
    for (const i of c1) for (const j of c2) if (D[i]![j]! > worst) worst = D[i]![j]!;
    return worst;
  }
  // average
  let sum = 0;
  let count = 0;
  for (const i of c1) for (const j of c2) { sum += D[i]![j]!; count++; }
  return sum / count;
}

/** Cut the dendrogram to produce k flat clusters. */
function cutDendrogram(mergeOrder: number[][], distances: number[], n: number, k: number): number[] {
  // Union-Find
  const parent = new Array(n).fill(0).map((_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]!));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  // Apply merges in order, but stop when we have k clusters
  let numClusters = n;
  for (const [a, b] of mergeOrder) {
    if (numClusters <= k) break;
    union(a, b);
    numClusters--;
  }
  // Compact labels
  const map = new Map<number, number>();
  let next = 0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!map.has(root)) map.set(root, next++);
    out[i] = map.get(root)!;
  }
  return out;
}

// ----------------------------------------------------------------------------
// DBSCAN
// ----------------------------------------------------------------------------

export function dbscan(
  X: number[][],
  eps: number,
  minPts: number,
): { labels: number[]; nClusters: number } {
  const n = X.length;
  const labels = new Array(n).fill(-1); // -1 = unvisited
  let clusterId = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;
    const neighbours = regionQuery(X, i, eps);
    if (neighbours.length < minPts) {
      labels[i] = -2; // noise (will be marked as outlier)
      continue;
    }
    // Start new cluster
    labels[i] = clusterId;
    const seed = [...neighbours];
    for (let j = 0; j < seed.length; j++) {
      const q = seed[j]!;
      if (labels[q] === -2) labels[q] = clusterId;
      if (labels[q] !== -1) continue;
      labels[q] = clusterId;
      const qNeighbours = regionQuery(X, q, eps);
      if (qNeighbours.length >= minPts) {
        seed.push(...qNeighbours);
      }
    }
    clusterId++;
  }
  // Re-map -2 to -1 for "noise"
  for (let i = 0; i < n; i++) if (labels[i] === -2) labels[i] = -1;
  return { labels, nClusters: clusterId };
}

function regionQuery(X: number[][], idx: number, eps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < X.length; i++) {
    if (Math.sqrt(sqDist(X[idx]!, X[i]!)) <= eps) out.push(i);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Quality metrics
// ----------------------------------------------------------------------------

/** Silhouette score. */
export function silhouette(X: number[][], labels: number[]): number {
  const n = X.length;
  if (n < 2) return 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const ownCluster = labels[i]!;
    // a(i) = mean distance to own cluster
    const ownDistances: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (labels[j] === ownCluster) ownDistances.push(Math.sqrt(sqDist(X[i]!, X[j]!)));
    }
    const a = ownDistances.length === 0 ? 0 : ownDistances.reduce((x, y) => x + y, 0) / ownDistances.length;
    // b(i) = min mean distance to any other cluster
    const otherClusters = new Set<number>();
    for (let j = 0; j < n; j++) if (labels[j] !== ownCluster) otherClusters.add(labels[j]!);
    let b = Infinity;
    for (const c of otherClusters) {
      const dists: number[] = [];
      for (let j = 0; j < n; j++) {
        if (labels[j] === c) dists.push(Math.sqrt(sqDist(X[i]!, X[j]!)));
      }
      const mean = dists.length === 0 ? 0 : dists.reduce((x, y) => x + y, 0) / dists.length;
      if (mean < b) b = mean;
    }
    if (b === Infinity) b = 0;
    const s = Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b);
    total += s;
    count++;
  }
  return total / count;
}

/** Davies-Bouldin index (lower = better). */
export function daviesBouldin(X: number[][], labels: number[]): number {
  const clusters = new Map<number, number[][]>();
  for (let i = 0; i < X.length; i++) {
    if (!clusters.has(labels[i]!)) clusters.set(labels[i]!, []);
    clusters.get(labels[i]!)!.push(X[i]!);
  }
  if (clusters.size < 2) return 0;
  // Compute centroid + scatter for each cluster
  const stats: { label: number; centroid: number[]; scatter: number }[] = [];
  for (const [label, points] of clusters) {
    const nFeat = points[0]!.length;
    const centroid = new Array(nFeat).fill(0);
    for (const p of points) for (let j = 0; j < nFeat; j++) centroid[j]! += p[j]!;
    for (let j = 0; j < nFeat; j++) centroid[j]! /= points.length;
    let scatter = 0;
    for (const p of points) scatter += Math.sqrt(sqDist(p, centroid));
    scatter /= points.length;
    stats.push({ label, centroid, scatter });
  }
  // DB index
  let db = 0;
  for (const a of stats) {
    let maxR = 0;
    for (const b of stats) {
      if (a.label === b.label) continue;
      const d = Math.sqrt(sqDist(a.centroid, b.centroid));
      const r = (a.scatter + b.scatter) / Math.max(1e-9, d);
      if (r > maxR) maxR = r;
    }
    db += maxR;
  }
  return db / stats.length;
}

// ----------------------------------------------------------------------------
// High-level: cluster genomes
// ----------------------------------------------------------------------------

export interface ClusterOptions {
  /** Clustering algorithm. */
  algorithm: "kmeans" | "hierarchical" | "dbscan";
  /** Number of clusters (k-means, hierarchical). Auto = sqrt(n). */
  k?: number;
  /** DBSCAN: neighbourhood radius (after z-normalisation). */
  eps?: number;
  /** DBSCAN: minimum points. */
  minPts?: number;
  /** Linkage for hierarchical. */
  linkage?: Linkage;
  /** Random seed. */
  seed?: number;
  /** Whether to z-normalise features. */
  normalise?: boolean;
  /** Cluster name heuristic (for naming). */
  nameByGenes?: boolean;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  algorithm: "kmeans",
  normalise: true,
  seed: 42,
  nameByGenes: true,
};

/** Cluster a set of genomes. Returns cluster assignments + 2D projection. */
export function clusterGenomes(
  genomes: { id: string; genome: IGenome }[],
  options: Partial<ClusterOptions> = {},
): ClusterResult {
  const opts: ClusterOptions = { ...DEFAULT_CLUSTER_OPTIONS, ...options };
  const ids = genomes.map(g => g.id);
  const X = genomes.map(g => genomeToFeatures(g.genome));
  const { normalised } = opts.normalise !== false ? zNormalise(X) : { normalised: X };
  // PCA
  const { components, varianceExplained, projected } = pca(normalised, 2);
  // Cluster
  let labels: number[] = [];
  let centroids: number[][] = [];
  let inertia: number | null = null;
  let algorithm: ClusterResult["algorithm"];
  if (opts.algorithm === "kmeans") {
    const k = opts.k ?? Math.max(2, Math.round(Math.sqrt(genomes.length)));
    const km = kmeans(normalised, k, opts.seed ?? 42);
    labels = km.labels;
    centroids = km.centroids;
    inertia = km.inertia;
    algorithm = "kmeans";
  } else if (opts.algorithm === "hierarchical") {
    const h = hierarchical(normalised, opts.linkage ?? "average");
    labels = h.labels;
    // Centroids = mean of each cluster
    const k = Math.max(2, opts.k ?? Math.round(Math.sqrt(genomes.length)));
    const clusterMap = new Map<number, number[][]>();
    for (let i = 0; i < labels.length; i++) {
      if (!clusterMap.has(labels[i]!)) clusterMap.set(labels[i]!, []);
      clusterMap.get(labels[i]!)!.push(normalised[i]!);
    }
    const sortedLabels = [...clusterMap.keys()].sort((a, b) => a - b);
    centroids = sortedLabels.map(lbl => {
      const pts = clusterMap.get(lbl)!;
      const nFeat = pts[0]!.length;
      const c = new Array(nFeat).fill(0);
      for (const p of pts) for (let j = 0; j < nFeat; j++) c[j]! += p[j]!;
      for (let j = 0; j < nFeat; j++) c[j]! /= pts.length;
      return c;
    });
    algorithm = "hierarchical";
  } else {
    // DBSCAN
    const eps = opts.eps ?? 1.5;
    const minPts = opts.minPts ?? 3;
    const db = dbscan(normalised, eps, minPts);
    labels = db.labels;
    // Centroids
    const clusterMap = new Map<number, number[][]>();
    for (let i = 0; i < labels.length; i++) {
      if (labels[i]! < 0) continue;
      if (!clusterMap.has(labels[i]!)) clusterMap.set(labels[i]!, []);
      clusterMap.get(labels[i]!)!.push(normalised[i]!);
    }
    const sortedLabels = [...clusterMap.keys()].sort((a, b) => a - b);
    centroids = sortedLabels.map(lbl => {
      const pts = clusterMap.get(lbl)!;
      const nFeat = pts[0]!.length;
      const c = new Array(nFeat).fill(0);
      for (const p of pts) for (let j = 0; j < nFeat; j++) c[j]! += p[j]!;
      for (let j = 0; j < nFeat; j++) c[j]! /= pts.length;
      return c;
    });
    algorithm = "dbscan";
  }
  // Assignments
  const assignments: ClusterAssignment[] = ids.map((id, i) => {
    const label = labels[i]!;
    const proj = projected[i] ?? [0, 0];
    // Distance to centroid
    let dToC = 0;
    if (label >= 0) {
      const c = centroids[label];
      if (c) dToC = Math.sqrt(sqDist(normalised[i]!, c));
    } else {
      dToC = Infinity;
    }
    return {
      subjectId: id,
      cluster: label,
      x: proj[0]!,
      y: proj[1]!,
      distanceToCentroid: dToC,
      isOutlier: label < 0,
    };
  });
  // Quality
  const sil = silhouette(normalised, labels);
  const db = daviesBouldin(normalised, labels);
  // Named clusters
  const namedClusters: { cluster: number; name: string; memberIds: string[] }[] = [];
  const clusterMap = new Map<number, string[]>();
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]! < 0) continue;
    if (!clusterMap.has(labels[i]!)) clusterMap.set(labels[i]!, []);
    clusterMap.get(labels[i]!)!.push(ids[i]!);
  }
  for (const [cluster, members] of clusterMap) {
    namedClusters.push({ cluster, name: nameCluster(centroids[cluster] ?? [], genomes, labels, cluster), memberIds: members });
  }
  return {
    assignments,
    centroids,
    k: namedClusters.length,
    algorithm,
    silhouette: sil,
    inertia,
    daviesBouldin: db,
    namedClusters,
    pcaComponents: components,
    varianceExplained,
  };
}

/** Name a cluster by inspecting its centroid's gene values. */
function nameCluster(
  centroid: number[],
  genomes: { id: string; genome: IGenome }[],
  labels: number[],
  targetLabel: number,
): string {
  if (centroid.length === 0) return "unknown";
  // Compute mean gene values for the cluster
  const members = genomes.filter((_, i) => labels[i] === targetLabel);
  if (members.length === 0) return "empty";
  const means: Record<string, number> = {};
  for (const spec of GENOME_SPECS) {
    const key = spec.key as string;
    const vals = members.map(g => (g.genome as any)[key] as number).filter(v => typeof v === "number");
    means[key] = vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  // Score clusters by their "personality"
  const scores = {
    aggressive: means["aggression"]! + means["pressure"]!,
    counter: means["blockChance"]! + means["whiffPunish"]! + means["perfection"]!,
    adaptive: means["adaptive"]! + means["mixup"]!,
    combo: means["combo"]! / 5 + means["pressure"]! * 0.5,
    turtle: means["blockChance"]! * 1.5 + (1 - means["aggression"]!),
    reactive: means["blockChance"]! + means["reaction"]!,
    rage: means["rage"]!,
  };
  let best = "hybrid";
  let bestScore = -Infinity;
  for (const [k, v] of Object.entries(scores)) {
    if (v > bestScore) { bestScore = v; best = k; }
  }
  return best;
}

// ----------------------------------------------------------------------------
// Renderers
// ----------------------------------------------------------------------------

export function renderClustersJson(clusters: ClusterResult): string {
  return JSON.stringify(clusters, null, 2);
}

export function renderClustersMd(clusters: ClusterResult): string {
  const lines: string[] = [];
  lines.push(`- Algorithm: ${clusters.algorithm}`);
  lines.push(`- k: ${clusters.k}`);
  lines.push(`- Silhouette: ${clusters.silhouette.toFixed(3)}`);
  lines.push(`- Davies-Bouldin: ${clusters.daviesBouldin.toFixed(3)}`);
  if (clusters.inertia !== null) lines.push(`- Inertia: ${clusters.inertia.toFixed(3)}`);
  lines.push(`- Variance explained (PC1, PC2): ${clusters.varianceExplained.map(v => v.toFixed(3)).join(", ")}`);
  lines.push("");
  lines.push("### Named clusters");
  lines.push("");
  for (const c of clusters.namedClusters) {
    lines.push(`- **${c.name}** (${c.memberIds.length} members): ${c.memberIds.join(", ")}`);
  }
  if (clusters.assignments.some(a => a.isOutlier)) {
    lines.push("");
    lines.push("### Outliers");
    lines.push("");
    for (const a of clusters.assignments) {
      if (a.isOutlier) lines.push(`- ${a.subjectId}`);
    }
  }
  return lines.join("\n");
}

export function renderClustersPlotSpec(clusters: ClusterResult): string {
  return JSON.stringify({
    type: "scatter",
    title: "Genome Clusters (PCA 2D)",
    x: { name: "PC1", varianceExplained: clusters.varianceExplained[0] ?? 0 },
    y: { name: "PC2", varianceExplained: clusters.varianceExplained[1] ?? 0 },
    points: clusters.assignments.map(a => ({
      subjectId: a.subjectId,
      x: a.x,
      y: a.y,
      cluster: a.cluster,
      isOutlier: a.isOutlier,
      clusterName: clusters.namedClusters.find(c => c.cluster === a.cluster)?.name ?? "outlier",
    })),
    clusters: clusters.namedClusters,
    silhouette: clusters.silhouette,
    daviesBouldin: clusters.daviesBouldin,
  }, null, 2);
}
