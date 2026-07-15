// ============================================================================
// /api/ai/ga-stats — returns GA training reports for UI transparency.
//
// Bundles:
//   - data/ga_vs_ga_tournament.json   (round-robin tournament of v2 library)
//   - data/widow_evolution.json       (king-of-the-hill Widow evolution)
//   - data/genome_libraries/GenomeLibrary_v2_summary.json
// ============================================================================

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const FILES = {
  roundRobin: [
    path.join(process.cwd(), "data", "ga_vs_ga_tournament.json"),
    path.join(process.cwd(), "..", "data", "ga_vs_ga_tournament.json"),
  ],
  widowKoH: [
    path.join(process.cwd(), "data", "widow_evolution.json"),
    path.join(process.cwd(), "..", "data", "widow_evolution.json"),
  ],
  libraryV2: [
    path.join(process.cwd(), "data", "genome_libraries", "GenomeLibrary_v2_summary.json"),
    path.join(process.cwd(), "..", "data", "genome_libraries", "GenomeLibrary_v2_summary.json"),
  ],
};

function readFirstExisting(paths: string[]): { found: string | null; data: any } {
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        return { found: p, data: JSON.parse(fs.readFileSync(p, "utf-8")) };
      } catch {
        return { found: p, data: null };
      }
    }
  }
  return { found: null, data: null };
}

export async function GET() {
  const rr = readFirstExisting(FILES.roundRobin);
  const koh = readFirstExisting(FILES.widowKoH);
  const lib = readFirstExisting(FILES.libraryV2);

  return NextResponse.json({
    ok: true,
    roundRobin: rr.found
      ? { path: rr.found, matches: rr.data?.matches ?? 0, standings: rr.data?.standings ?? [] }
      : null,
    widowKoH: koh.found ? { path: koh.found, ...koh.data } : null,
    libraryV2: lib.found ? { path: lib.found, ...lib.data } : null,
  });
}
