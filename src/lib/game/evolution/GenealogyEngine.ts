// ============================================================================
// GENEALOGY ENGINE
//
// Builds an ancestry tree from lineage records and allows replaying the
// evolutionary history of any genome.
// ============================================================================

import type { IGenealogyNode, ILineageNode } from "./types";

export function buildGenealogyTree(lineage: ILineageNode[], rootGenomeId: string): IGenealogyNode | null {
  const map = new Map<string, ILineageNode>();
  for (const node of lineage) {
    map.set(node.genomeId, node);
  }

  const root = map.get(rootGenomeId);
  if (!root) return null;

  function build(node: ILineageNode, depth: number): IGenealogyNode {
    const children: IGenealogyNode[] = [];
    for (const other of lineage) {
      if (other.parentIds.includes(node.genomeId) && other.genomeId !== node.genomeId) {
        children.push(build(other, depth + 1));
      }
    }
    return {
      ...node,
      children,
      depth,
    };
  }

  return build(root, 0);
}

/** Returns the direct ancestry path from a genome back to the earliest ancestor. */
export function getAncestryPath(lineage: ILineageNode[], genomeId: string): ILineageNode[] {
  const map = new Map<string, ILineageNode>();
  for (const node of lineage) {
    map.set(node.genomeId, node);
  }

  const path: ILineageNode[] = [];
  const visited = new Set<string>();
  let current = map.get(genomeId);

  while (current && !visited.has(current.genomeId)) {
    path.unshift(current);
    visited.add(current.genomeId);
    const parentId = current.parentIds[0];
    current = parentId ? map.get(parentId) : undefined;
  }

  return path;
}

/** Replays the fitness history of a genome's ancestry. */
export function replayFitnessHistory(lineage: ILineageNode[], genomeId: string): Array<{ generation: number; fitness: number }> {
  return getAncestryPath(lineage, genomeId).map((n) => ({
    generation: n.generation,
    fitness: n.fitness,
  }));
}
