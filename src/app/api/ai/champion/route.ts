// ============================================================================
// /api/ai/champion — returns the current frozen champion genome.
//
// Reads ChampionGenome.json from the repo root. The browser UI uses this to
// show "the genome that is actually loaded into the enemy AI right now".
// ============================================================================

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CANDIDATE_PATHS = [
  path.join(process.cwd(), "ChampionGenome.json"),
  path.join(process.cwd(), "..", "ChampionGenome.json"),
  path.join(process.cwd(), "..", "..", "ChampionGenome.json"),
];

function findChampionPath(): string | null {
  for (const p of CANDIDATE_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function GET() {
  const found = findChampionPath();
  if (!found) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ChampionGenome.json not found. Run `bun run scripts/evolve-widow.ts` first.",
        candidatePaths: CANDIDATE_PATHS,
      },
      { status: 404 },
    );
  }

  try {
    const raw = JSON.parse(fs.readFileSync(found, "utf-8"));
    const stats = fs.statSync(found);

    const numericGenes: Record<string, number> = {};
    const geneKeys = [
      "aggression",
      "blockChance",
      "reaction",
      "combo",
      "whiffPunish",
      "antiAir",
      "pressure",
      "mixup",
      "adaptive",
      "rage",
      "perfection",
      "readDelay",
    ];
    for (const k of geneKeys) {
      if (typeof raw[k] === "number") numericGenes[k] = raw[k];
    }

    return NextResponse.json({
      ok: true,
      path: found,
      bytes: stats.size,
      mtime: stats.mtime.toISOString(),
      genome: {
        id: raw.id ?? null,
        source: raw.source ?? "unknown",
        generation: raw.generation ?? 0,
        version: raw.version ?? null,
        createdAt: raw.createdAt ?? null,
        parentA: raw.parentA ?? null,
        parentB: raw.parentB ?? null,
        fitnessHistory: Array.isArray(raw.fitnessHistory) ? raw.fitnessHistory : [],
        narrativeTraits: Array.isArray(raw.narrativeTraits) ? raw.narrativeTraits : [],
        genes: numericGenes,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed to read ChampionGenome.json: ${String(err)}` },
      { status: 500 },
    );
  }
}
