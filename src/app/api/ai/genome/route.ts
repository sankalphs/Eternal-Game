// ============================================================================
// /api/ai/genome — returns a frozen style genome from champions/{style}.json
//
// Used only after a match for Qwen-driven genome selection (not during combat).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STYLES = [
  "balanced",
  "aggressive",
  "counter",
  "patient",
  "rushdown",
  "mindGame",
  "adaptive",
  "zoner",
  "pressure",
] as const;

type Style = (typeof STYLES)[number];

const GENE_KEYS = [
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
] as const;

function isStyle(s: string): s is Style {
  return (STYLES as readonly string[]).includes(s);
}

function findGenomePath(style: Style): string | null {
  const candidates = [
    path.join(process.cwd(), "champions", `${style}.json`),
    path.join(process.cwd(), "..", "champions", `${style}.json`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const styleParam = request.nextUrl.searchParams.get("style") ?? "adaptive";
  if (!isStyle(styleParam)) {
    return NextResponse.json(
      { ok: false, error: `Unknown style "${styleParam}"`, styles: STYLES },
      { status: 400 },
    );
  }

  const found = findGenomePath(styleParam);
  if (!found) {
    return NextResponse.json(
      {
        ok: false,
        error: `champions/${styleParam}.json not found`,
        style: styleParam,
      },
      { status: 404 },
    );
  }

  try {
    const raw = JSON.parse(fs.readFileSync(found, "utf-8")) as Record<
      string,
      unknown
    >;
    const numericGenes: Record<string, number> = {};
    for (const k of GENE_KEYS) {
      if (typeof raw[k] === "number") numericGenes[k] = raw[k];
    }

    return NextResponse.json({
      ok: true,
      style: styleParam,
      path: found,
      genome: {
        id: typeof raw.id === "string" ? raw.id : null,
        source: typeof raw.source === "string" ? raw.source : `style:${styleParam}`,
        generation: typeof raw.generation === "number" ? raw.generation : 0,
        version: typeof raw.version === "string" ? raw.version : null,
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
        narrativeTraits: Array.isArray(raw.narrativeTraits)
          ? raw.narrativeTraits
          : [],
        genes: numericGenes,
        style: styleParam,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed to read genome: ${String(err)}` },
      { status: 500 },
    );
  }
}
