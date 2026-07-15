// ============================================================================
// FROZEN GENOME LIBRARY — BUILD SCRIPT
//
// Usage:
//   bun run scripts/freeze-genomes.ts [--in <live.json>] [--out <dir>] [--version <N>] [--top <N>]
//
// Loads a live IGenomeLibrary (from a previous evolution run) and
// freezes it into a FrozenGenomeLibrary. Persists the result to
// <dir>/GenomeLibrary_v<N>.json.
//
// The frozen library is permanent: it is NEVER evolved again. Future
// versions become GenomeLibrary_v2.json, etc.
// ============================================================================

import fs from "fs";
import path from "path";
import {
  GenomeFreezer,
  frozenLibraryFilename,
  type FrozenGenomeLibrary,
  type FreezeOptions,
} from "../src/lib/game/evolution/FrozenGenomeLibrary";
import type { IGenomeLibrary } from "../src/lib/game/evolution/types";

function parseArgs(): { in: string; out: string; version: string; top: number; previous?: string; notes: string; baseOpponent: string } {
  const args = process.argv.slice(2);
  const out: ReturnType<typeof parseArgs> = {
    in: "champions/library.json",
    out: "data/genome_libraries",
    version: "v1",
    top: 1,
    notes: "frozen from live evolution run",
    baseOpponent: "default",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--in" && args[i + 1]) out.in = args[++i];
    else if (a === "--out" && args[i + 1]) out.out = args[++i];
    else if (a === "--version" && args[i + 1]) out.version = args[++i];
    else if (a === "--top" && args[i + 1]) out.top = parseInt(args[++i], 10);
    else if (a === "--previous" && args[i + 1]) out.previous = args[++i];
    else if (a === "--notes" && args[i + 1]) out.notes = args[++i];
    else if (a === "--base-opponent" && args[i + 1]) out.baseOpponent = args[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs();
  console.log(`[FreezeGenomes] in=${args.in} version=${args.version} top=${args.top}`);

  // 1. Load the live library
  if (!fs.existsSync(args.in)) {
    console.error(`[FreezeGenomes] Live library not found: ${args.in}`);
    process.exit(1);
  }
  const liveLibrary: IGenomeLibrary = JSON.parse(fs.readFileSync(args.in, "utf-8"));
  console.log(`[FreezeGenomes] Loaded live library: ${liveLibrary.version} (${Object.keys(liveLibrary.entries).length} entries)`);

  // 2. Optionally load the previous frozen library
  let previous: FrozenGenomeLibrary | undefined;
  if (args.previous && fs.existsSync(args.previous)) {
    previous = JSON.parse(fs.readFileSync(args.previous, "utf-8"));
    if (previous) {
      console.log(`[FreezeGenomes] Loaded previous frozen library: ${previous.version}`);
    }
  }

  // 3. Freeze
  const freezer = new GenomeFreezer();
  const opts: FreezeOptions = {
    version: args.version,
    baseOpponent: args.baseOpponent,
    seedBase: 0,
    configHash: hashConfig(liveLibrary),
    notes: args.notes,
    eloRatings: {}, // Populated by the ResearchDashboard in a real run
    topNPerStyle: args.top,
    previousLibrary: previous,
  };
  const frozen = freezer.freeze(liveLibrary, opts);

  console.log(`[FreezeGenomes] Frozen: ${Object.keys(frozen.entries).length} entries (${frozen.totalUniqueEntries} unique)`);

  // 4. Persist
  fs.mkdirSync(args.out, { recursive: true });
  const outPath = path.join(args.out, frozenLibraryFilename(args.version));
  fs.writeFileSync(outPath, JSON.stringify(frozen, null, 2), "utf-8");
  console.log(`[FreezeGenomes] Wrote: ${outPath}`);

  // 5. Write a small summary
  const summary = {
    version: frozen.version,
    frozenAt: frozen.frozenAt,
    baseOpponent: frozen.baseOpponent,
    entries: Object.values(frozen.entries).map(e => ({
      frozenId: e.frozenId,
      style: e.style,
      finalFitness: e.finalFitness,
      eloRating: e.eloRating,
      generationsSurvived: e.generationsSurvived,
    })),
    lineage: frozen.lineage,
  };
  const summaryPath = path.join(args.out, `GenomeLibrary_${args.version}_summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`[FreezeGenomes] Summary: ${summaryPath}`);
}

function hashConfig(library: IGenomeLibrary): string {
  // Cheap hash of the library config (used for reproducibility)
  const s = `${library.version}|${library.baseOpponent}|${Object.keys(library.entries).sort().join(",")}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

main().catch((err) => {
  console.error("[FreezeGenomes] Fatal:", err);
  process.exit(1);
});
