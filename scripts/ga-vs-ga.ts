// ============================================================================
// GA vs GA TOURNAMENT — explicit round-robin between frozen genomes
//
// Usage: bun run scripts/ga-vs-ga.ts
// ============================================================================

import fs from "fs";
import path from "path";
import { SelfPlayRunner, GenomeLibrary } from "../src/lib/game/evolution";
import type { IGenome } from "../src/lib/game/evolution/types";
import type { OpponentDef } from "../src/lib/game/types";

const FROZEN_PATH = "data/genome_libraries/GenomeLibrary_v2.json";
const OPPONENTS: OpponentDef[] = JSON.parse(
  fs.readFileSync("champions/library.json", "utf-8")
).entries
  ? Object.values(JSON.parse(fs.readFileSync("champions/library.json", "utf-8")).entries).map(
      (e: any) => e.genome as IGenome
    )
  : [];

async function main() {
  console.log("[GA vs GA] Loading frozen library v2...");
  const frozen = JSON.parse(fs.readFileSync(FROZEN_PATH, "utf-8"));
  const genomes: IGenome[] = Array.isArray(frozen.entries)
    ? frozen.entries.map((e: any) => e.genome)
    : Object.values(frozen.entries).map((e: any) => (e as any).genome);
  console.log(`[GA vs GA] ${genomes.length} genomes loaded`);

  // Build a base opponent
  const baseOpponent: OpponentDef = {
    name: "Base",
    aggression: 0.5,
    reaction: 0.5,
    blockChance: 0.3,
    combo: 3,
    whiffPunish: 0.5,
    antiAir: 0.5,
    pressure: 0.5,
    mixup: 0.5,
    adaptive: 0.5,
    rage: 0.5,
    perfection: 0.5,
    readDelay: 0.5,
    bodyType: "balanced",
    blade: "katana",
    maxHp: 100,
    rim: "#fff",
    damageMul: 1.0,
    speedMul: 1.0,
  };

  const runner = new SelfPlayRunner({
    baseOpponent,
    timeStep: 1 / 30,
    maxDurationSeconds: 90,
    fastRoundTransitions: true,
    deterministic: true,
    seedBase: 1234,
  });

  console.log(`[GA vs GA] Running round-robin (${(genomes.length * (genomes.length - 1)) / 2} matches)...`);
  const t0 = Date.now();
  const tournament = runner.runTournament(genomes, "roundRobin");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n[GA vs GA] Tournament complete in ${elapsed}s`);
  console.log(`[GA vs GA] Matches: ${tournament.matches.length}`);
  console.log("\n=== STANDINGS ===");
  const sorted = [...tournament.standings].sort((a, b) => b.score - a.score);
  for (const s of sorted) {
    const g = genomes.find((x) => x.id === s.genomeId);
    const style = (g as any)?.narrativeTags?.[0] || (g as any)?.style || "unknown";
    console.log(
      `  ${s.genomeId.padEnd(28)}  W${s.wins} L${s.losses} D${s.draws}  score=${s.score.toFixed(2)}  style=${style}`
    );
  }

  // Save tournament report
  const out = {
    format: tournament.format,
    matches: tournament.matches.length,
    standings: sorted,
    genomes: genomes.map((g) => ({ id: g.id, style: (g as any).narrativeTags?.[0] })),
    elapsedSeconds: parseFloat(elapsed),
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync("data/ga_vs_ga_tournament.json", JSON.stringify(out, null, 2), "utf-8");
  console.log(`\n[GA vs GA] Saved report: data/ga_vs_ga_tournament.json`);
}

main().catch((err) => {
  console.error("[GA vs GA] Fatal:", err);
  process.exit(1);
});
