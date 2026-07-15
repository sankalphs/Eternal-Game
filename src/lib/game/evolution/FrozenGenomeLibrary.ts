// ============================================================================
// PROJECT ETERNAL — FROZEN GENOME LIBRARY
//
// The library holds the BEST genomes from completed evolution runs.
// Each library version is FROZEN — never evolved further. New versions
// become the new "teacher policies" for distillation, dataset
// generation, and benchmarking.
//
// The frozen library is the permanent source of teacher policies. It
// is read by:
//   - MassiveDatasetGenerator     (teacher-vs-student rollouts)
//   - EvaluationHarness           (baseline for comparison)
//   - ReplayEvaluator             (frozen genome replays)
//
// The library is stored on disk as a JSON file per version. Once
// frozen, the file is never overwritten. New versions are appended
// with monotonically increasing version numbers (v1, v2, v3, ...).
// ============================================================================

import type { IGenome, IGenomeLibrary, ILibraryEntry, GenomeStyle } from "./types";
import { generateNarrative } from "./NarrativeTraitEngine";
import { genomeDistance, GENOME_SPECS } from "./Genome";

// --------------------------------------------------------------------------
//  Versioning
// --------------------------------------------------------------------------

export const FROZEN_LIBRARY_FILENAME_PREFIX = "GenomeLibrary";
export const FROZEN_LIBRARY_FILENAME_EXT = ".json";

export function frozenLibraryFilename(version: string): string {
  return `${FROZEN_LIBRARY_FILENAME_PREFIX}_${version}${FROZEN_LIBRARY_FILENAME_EXT}`;
}

export function parseFrozenLibraryFilename(filename: string): string | null {
  const m = filename.match(/^GenomeLibrary_(v\d+)\.json$/);
  return m ? m[1] : null;
}

// --------------------------------------------------------------------------
//  Frozen entry — extends ILibraryEntry with provenance
// --------------------------------------------------------------------------

export interface FrozenEntry extends ILibraryEntry {
  /** Unique frozen id. Stable across runs. */
  frozenId: string;
  /** When this entry was frozen. */
  frozenAt: string;
  /** Source library version (e.g. "v1.0.0"). */
  sourceVersion: string;
  /** Source genome id. */
  sourceGenomeId: string;
  /** Final fitness at freeze time. */
  finalFitness: number;
  /** Final raw fitness. */
  finalRawFitness: number;
  /** Generations survived. */
  generationsSurvived: number;
  /** ELO rating at freeze time. */
  eloRating: number;
  /** Frozen library major version this entry belongs to. */
  libraryVersion: string;
}

// --------------------------------------------------------------------------
//  Frozen library
// --------------------------------------------------------------------------

export interface FrozenGenomeLibrary {
  version: string;            // e.g. "v1", "v2", "v3"
  frozenAt: string;
  baseOpponent: string;
  seedBase: number;
  configHash: string;
  notes: string;
  entries: Record<string, FrozenEntry>;
  /** All known library versions. The current version is the LAST one. */
  lineage: FrozenLibraryVersion[];
  /** Total entries (deduped across all lineages). */
  totalUniqueEntries: number;
}

export interface FrozenLibraryVersion {
  version: string;
  frozenAt: string;
  entriesAdded: number;
  notes: string;
}

// --------------------------------------------------------------------------
//  GenomeFreezer — converts a live IGenomeLibrary into a FrozenEntry
// --------------------------------------------------------------------------

export interface FreezeOptions {
  /** Library version, e.g. "v1" or "v2". */
  version: string;
  /** Base opponent id used during evolution. */
  baseOpponent: string;
  /** Seed base used during evolution. */
  seedBase: number;
  /** SHA-256-style hash of the evolution config (so the version is reproducible). */
  configHash: string;
  /** Notes for this version. */
  notes: string;
  /** ELO ratings keyed by genome id (computed by the ResearchDashboard). */
  eloRatings: Record<string, number>;
  /** Optional: previous library (to carry lineage). */
  previousLibrary?: FrozenGenomeLibrary;
  /** Optional: keep only the top N entries per style (default: 1). */
  topNPerStyle?: number;
}

export class GenomeFreezer {
  /**
   * Freeze a live IGenomeLibrary into a FrozenGenomeLibrary.
   * The result is immutable in practice (never modified again).
   */
  freeze(library: IGenomeLibrary, options: FreezeOptions): FrozenGenomeLibrary {
    const topN = options.topNPerStyle ?? 1;
    const entries: Record<string, FrozenEntry> = {};

    // Group entries by style, keep top-N by fitness
    const styleGroups: Record<string, ILibraryEntry[]> = {};
    for (const [style, entry] of Object.entries(library.entries)) {
      const list = styleGroups[style] ?? [];
      list.push(entry);
      styleGroups[style] = list;
    }

    let added = 0;
    for (const [style, list] of Object.entries(styleGroups)) {
      const sorted = [...list].sort((a, b) => b.genome.fitness! - a.genome.fitness!);
      for (let i = 0; i < Math.min(topN, sorted.length); i++) {
        const entry = sorted[i];
        const frozenId = `${options.version}_${style}_${i}`;
        entries[frozenId] = {
          ...entry,
          frozenId,
          frozenAt: new Date().toISOString(),
          sourceVersion: library.version,
          sourceGenomeId: entry.genome.id,
          finalFitness: entry.genome.fitness ?? 0,
          finalRawFitness: entry.genome.rawFitness ?? 0,
          generationsSurvived: entry.genome.generation,
          eloRating: options.eloRatings[entry.genome.id] ?? 1500,
          libraryVersion: options.version,
        };
        added++;
      }
    }

    // Carry lineage from previous library
    const previous = options.previousLibrary;
    const lineage: FrozenLibraryVersion[] = previous
      ? [...previous.lineage, {
          version: options.version,
          frozenAt: new Date().toISOString(),
          entriesAdded: added,
          notes: options.notes,
        }]
      : [{
          version: options.version,
          frozenAt: new Date().toISOString(),
          entriesAdded: added,
          notes: options.notes,
        }];

    // Compute total unique entries (deduped by genome vector distance)
    const allEntries = Object.values(entries);
    const seen: IGenome[] = [];
    let unique = 0;
    for (const e of allEntries) {
      const isDup = seen.some(s => genomeDistance(s, e.genome) < 0.05);
      if (!isDup) {
        seen.push(e.genome);
        unique++;
      }
    }

    return {
      version: options.version,
      frozenAt: new Date().toISOString(),
      baseOpponent: options.baseOpponent,
      seedBase: options.seedBase,
      configHash: options.configHash,
      notes: options.notes,
      entries,
      lineage,
      totalUniqueEntries: unique,
    };
  }

  /**
   * Compare two libraries and emit a diff (used by the Eval harness
   * to report "library v1 vs v2 champion ELO deltas").
   */
  diff(a: FrozenGenomeLibrary, b: FrozenGenomeLibrary): FrozenLibraryDiff {
    const aIds = new Set(Object.keys(a.entries));
    const bIds = new Set(Object.keys(b.entries));
    const added: string[] = [];
    const removed: string[] = [];
    const common: string[] = [];
    for (const id of bIds) if (!aIds.has(id)) added.push(id);
    for (const id of aIds) if (!bIds.has(id)) removed.push(id);
    for (const id of aIds) if (bIds.has(id)) common.push(id);

    const eloDeltas: Record<string, number> = {};
    for (const id of common) {
      eloDeltas[id] = b.entries[id].eloRating - a.entries[id].eloRating;
    }

    return {
      fromVersion: a.version,
      toVersion: b.version,
      added,
      removed,
      common,
      eloDeltas,
    };
  }
}

export interface FrozenLibraryDiff {
  fromVersion: string;
  toVersion: string;
  added: string[];
  removed: string[];
  common: string[];
  eloDeltas: Record<string, number>;
}

// --------------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------------

function _unused_genomeToVector(g: IGenome): number[] {
  // Stable numeric representation for dedup (kept for future use)
  return GENOME_SPECS.map(s => g[s.key as keyof IGenome] as number);
}

// --------------------------------------------------------------------------
//  JSON (de)serialisation
// --------------------------------------------------------------------------

export function serializeFrozenLibrary(lib: FrozenGenomeLibrary): string {
  return JSON.stringify(lib, null, 2);
}

export function deserializeFrozenLibrary(json: string): FrozenGenomeLibrary {
  const obj = JSON.parse(json);
  if (!obj.version || !obj.entries) {
    throw new Error("Invalid FrozenGenomeLibrary JSON: missing version or entries");
  }
  return obj as FrozenGenomeLibrary;
}
