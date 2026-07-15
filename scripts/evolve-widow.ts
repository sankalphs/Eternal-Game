// ============================================================================
// WIDOW EVOLUTION — king-of-the-hill GA vs GA, gated by 3/3 vs baseline Widow
//
// Pipeline:
//   1. Baseline = Widow (OPPONENTS[4]). The GA only tunes AI behaviour; body
//      stats (hp, damage, speed, rim, body type) stay frozen from the source.
//   2. Build an opponent pool of 100 mutants derived from the v2 frozen library
//      so the king has to survive 100 unique matchups per training cycle.
//   3. King-of-the-hill loop: 100 matches. Winner stays, loser goes to the
//      back of the queue. A single dominant genome eventually emerges.
//   4. Freeze the king. Play 3 verification matches vs the frozen baseline
//      Widow (alternating sides for fairness).
//   5. If the king wins 3/3 -> export WidowGenome.json. Done.
//   6. If the king fails to win 3/3 -> unfreeze, inject 20 fresh mutants into
//      the pool, re-seed the king from the best challenger it lost to, and
//      run another KoH cycle. Cap at 10 cycles.
//
// Usage:
//   bun run scripts/evolve-widow.ts
//   bun run scripts/evolve-widow.ts --cycles 5 --koh 100 --verify 3
//   bun run scripts/evolve-widow.ts --seed 42 --pool 100 --inject 20
// ============================================================================

import fs from "fs";
import path from "path";
import { OPPONENTS } from "../src/lib/game/engine";
import {
  SelfPlayRunner,
  MutationEngine,
  opponentDefToGenome,
  genomeToOpponentDef,
  CHAMPION_GENOME_FILENAME,
} from "../src/lib/game/evolution";
import type { IGenome, ISelfPlayMatch } from "../src/lib/game/evolution/types";
import type { OpponentDef } from "../src/lib/game/types";

const WIDOW_INDEX = 4; // OPPONENTS[4] = Widow
const WIDOW: OpponentDef = OPPONENTS[WIDOW_INDEX];
if (!WIDOW || WIDOW.name !== "Widow") {
  throw new Error(
    `[evolve-widow] Expected OPPONENTS[${WIDOW_INDEX}] to be "Widow" but found "${WIDOW?.name ?? "<missing>"}". Update WIDOW_INDEX.`,
  );
}

const FROZEN_LIBRARY_PATH = "data/genome_libraries/GenomeLibrary_v2.json";
const REPORT_PATH = "data/widow_evolution.json";
const OUTPUT_GENOME_PATH = path.join(process.cwd(), CHAMPION_GENOME_FILENAME);

function parseArgs(): {
  cycles: number;
  koh: number;
  verify: number;
  pool: number;
  inject: number;
  seed: number;
  maxMatchSeconds: number;
} {
  const argv = process.argv.slice(2);
  const num = (key: string, fallback: number): number => {
    const idx = argv.findIndex((a) => a === `--${key}` || a.startsWith(`--${key}=`));
    if (idx < 0) return fallback;
    const raw = argv[idx].includes("=") ? argv[idx].split("=")[1] : argv[idx + 1];
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    cycles: num("cycles", 10),
    koh: num("koh", 100),
    verify: num("verify", 3),
    pool: num("pool", 100),
    inject: num("inject", 20),
    seed: num("seed", 1337),
    maxMatchSeconds: num("maxSeconds", 90),
  };
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function loadFrozenLibrary(): IGenome[] {
  const raw = JSON.parse(fs.readFileSync(FROZEN_LIBRARY_PATH, "utf-8"));
  const entries: any[] = Array.isArray(raw.entries)
    ? raw.entries
    : Object.values(raw.entries);
  return entries.map((e) => e.genome as IGenome);
}

function buildBaselineGenome(): IGenome {
  const base = opponentDefToGenome(WIDOW, 0);
  base.id = "genome_widow_baseline";
  base.source = "baseline";
  base.createdAt = new Date().toISOString();
  return base;
}

function buildOpponentPool(
  sources: IGenome[],
  count: number,
  mutator: MutationEngine,
  rng: () => number,
  generation: number,
): IGenome[] {
  const pool: IGenome[] = [];
  for (let i = 0; i < count; i++) {
    const parent = sources[i % sources.length];
    const { child } = mutator.mutate(parent, generation, rng);
    child.id = `genome_widow_pool_${generation}_${i.toString(36)}`;
    child.source = "pool-mutant";
    pool.push(child);
  }
  return pool;
}

function seedKingFromWidow(
  baseline: IGenome,
  mutator: MutationEngine,
  rng: () => number,
  generation: number,
): IGenome {
  const { child } = mutator.mutate(baseline, generation, rng);
  child.id = "genome_widow_king_0";
  child.source = "king-seed";
  return child;
}

interface CycleResult {
  cycle: number;
  kohMatches: number;
  kohWins: number;
  kohLosses: number;
  kohDraws: number;
  kingId: string;
  challengerId: string | null;
  verifyMatches: { opponentSide: "A" | "B"; winner: string; roundsA: number; roundsB: number; duration: number }[];
  verifyWins: number;
  verifyLosses: number;
  passed: boolean;
  injectedMutants: number;
}

async function main() {
  const cfg = parseArgs();
  const rng = makeRng(cfg.seed);
  const runner = new SelfPlayRunner({
    baseOpponent: WIDOW,
    timeStep: 1 / 30,
    maxDurationSeconds: cfg.maxMatchSeconds,
    fastRoundTransitions: true,
    deterministic: true,
  });
  const mutator = new MutationEngine({
    ...MutationEngine.defaultConfig(),
    rate: 0.22,
    magnitude: 0.18,
  });

  console.log(`[evolve-widow] Baseline: ${WIDOW.name} (index ${WIDOW_INDEX})`);
  console.log(`[evolve-widow] Config: cycles=${cfg.cycles} koh=${cfg.koh} verify=${cfg.verify} pool=${cfg.pool} inject=${cfg.inject} seed=${cfg.seed}`);

  const baselineGenome = buildBaselineGenome();
  const frozenSources = loadFrozenLibrary();
  if (frozenSources.length === 0) {
    throw new Error(`[evolve-widow] No genomes found in ${FROZEN_LIBRARY_PATH}. Run \`bun run scripts/freeze-genomes.ts\` first.`);
  }
  console.log(`[evolve-widow] Frozen source library: ${frozenSources.length} genomes`);

  let opponentPool: IGenome[] = buildOpponentPool(frozenSources, cfg.pool, mutator, rng, 0);
  let king: IGenome = seedKingFromWidow(baselineGenome, mutator, rng, 0);
  const cycles: CycleResult[] = [];
  let totalKohMatches = 0;
  let totalVerifyMatches = 0;
  let finalKing: IGenome | null = null;
  let bestKingEver: { king: IGenome; verifyWins: number; cycle: number } | null = null;

  for (let cycle = 0; cycle < cfg.cycles; cycle++) {
    console.log(`\n=== CYCLE ${cycle + 1}/${cfg.cycles} ===`);
    console.log(`[cycle ${cycle + 1}] King = ${king.id} | Pool = ${opponentPool.length}`);

    // ---------- KING-OF-THE-HILL ----------
    const queue = [...opponentPool];
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let kohIdx = 0;
    for (let m = 0; m < cfg.koh; m++) {
      if (queue.length === 0) break;
      const challenger = queue[0];
      const seed = (cfg.seed * 1000003 + cycle * 9176 + m) >>> 0;
      const result: ISelfPlayMatch = runner.runMatch(king, challenger, seed);

      if (result.winnerId === king.id) {
        wins++;
        queue.push(queue.shift()!);
      } else if (result.winnerId === challenger.id) {
        losses++;
        const newKing = queue.shift()!;
        queue.push(king);
        king = newKing;
      } else {
        draws++;
        queue.push(queue.shift()!);
      }
      kohIdx++;
      if ((m + 1) % 20 === 0 || m === cfg.koh - 1) {
        console.log(
          `[cycle ${cycle + 1}] KoH ${m + 1}/${cfg.koh} | king=${king.id.slice(-8)} | W${wins}/L${losses}/D${draws}`,
        );
      }
    }
    totalKohMatches += kohIdx;
    console.log(`[cycle ${cycle + 1}] KoH done. King = ${king.id} | W${wins}/L${losses}/D${draws}`);

    // ---------- VERIFICATION: 3/3 vs baseline Widow ----------
    const verifyResults: CycleResult["verifyMatches"] = [];
    let verifyWins = 0;
    let verifyLosses = 0;
    for (let v = 0; v < cfg.verify; v++) {
      const kingOnEnemySide = v % 2 === 0;
      const seed = (cfg.seed * 7919 + cycle * 31 + v) >>> 0;
      const result: ISelfPlayMatch = kingOnEnemySide
        ? runner.runMatch(king, baselineGenome, seed)
        : runner.runMatch(baselineGenome, king, seed);

      const kingIsA = kingOnEnemySide;
      const kingWon = kingIsA
        ? result.winnerId === king.id
        : result.winnerId === king.id;
      const winnerLabel = result.winnerId === "draw" ? "draw" : kingWon ? "king" : "baseline";
      verifyResults.push({
        opponentSide: kingOnEnemySide ? "A" : "B",
        winner: winnerLabel,
        roundsA: result.roundsWonA,
        roundsB: result.roundsWonB,
        duration: result.durationSeconds,
      });
      if (result.winnerId === "draw") {
        // Draws count as a fail for the 3/3 gate.
        verifyLosses++;
      } else if (kingWon) {
        verifyWins++;
      } else {
        verifyLosses++;
      }
      totalVerifyMatches++;
    }

    const passed = verifyWins === cfg.verify;
    console.log(
      `[cycle ${cycle + 1}] Verify vs baseline Widow: ${verifyWins}W-${verifyLosses}L (${cfg.verify}-of-${cfg.verify} gate ${passed ? "PASSED" : "FAILED"})`,
    );

    cycles.push({
      cycle: cycle + 1,
      kohMatches: kohIdx,
      kohWins: wins,
      kohLosses: losses,
      kohDraws: draws,
      kingId: king.id,
      challengerId: null,
      verifyMatches: verifyResults,
      verifyWins,
      verifyLosses,
      passed,
      injectedMutants: 0,
    });

    if (verifyWins > (bestKingEver?.verifyWins ?? -1)) {
      bestKingEver = { king: { ...king }, verifyWins, cycle: cycle + 1 };
    }

    if (passed) {
      finalKing = king;
      console.log(`\n[evolve-widow] 3/3 GATE PASSED on cycle ${cycle + 1}. King: ${king.id}`);
      break;
    }

    // ---------- UNFREEZE + INJECT ----------
    console.log(`[cycle ${cycle + 1}] 3/3 gate failed -> unfreezing and injecting ${cfg.inject} fresh mutants.`);
    const fresh = buildOpponentPool(frozenSources, cfg.inject, mutator, rng, cycle + 1);
    opponentPool = [...opponentPool, ...fresh];
    // Seed king from a fresh Widow mutation to keep the lineage moving forward
    // without discarding progress.
    king = seedKingFromWidow(baselineGenome, mutator, rng, cycle + 1);
    cycles[cycles.length - 1].injectedMutants = cfg.inject;
  }

  // ---------- WRITE OUTPUTS ----------
  const ts = new Date().toISOString();
  const report = {
    baseline: { id: baselineGenome.id, name: WIDOW.name, title: WIDOW.title },
    config: cfg,
    cycles,
    totals: {
      kohMatches: totalKohMatches,
      verifyMatches: totalVerifyMatches,
      cyclesRun: cycles.length,
    },
    finalKing: finalKing
      ? { id: finalKing.id, passed: true, source: finalKing.source, generation: finalKing.generation }
      : bestKingEver
        ? { id: bestKingEver.king.id, passed: false, verifyWins: bestKingEver.verifyWins, cycle: bestKingEver.cycle }
        : null,
    finishedAt: ts,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  const winner = finalKing ?? bestKingEver?.king ?? null;
  if (winner) {
    const exportable: IGenome = { ...winner, source: finalKing ? "ga-widow-passed" : "ga-widow-best" };
    fs.writeFileSync(OUTPUT_GENOME_PATH, JSON.stringify(exportable, null, 2), "utf-8");
    console.log(
      `[evolve-widow] Exported ${finalKing ? "PASSED" : "best"} Widow genome to ${OUTPUT_GENOME_PATH}`,
    );
  } else {
    console.log(`[evolve-widow] No king produced. Inspect ${REPORT_PATH}.`);
  }

  console.log(`[evolve-widow] Report: ${REPORT_PATH}`);
  console.log(
    `[evolve-widow] Summary: ${cycles.length} cycles | ${totalKohMatches} KoH matches | ${totalVerifyMatches} verify matches | final=${
      finalKing ? `PASSED (${finalKing.id})` : "FAILED"
    }`,
  );

  if (!finalKing) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[evolve-widow] Fatal:", err);
  process.exit(1);
});
