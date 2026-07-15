// ============================================================================
// SIMULATOR — CHECKPOINT STORE
//
// PHASE 8 of the research framework. Persists and resumes
// BatchExecutor state. Uses an injected IO adapter so the same code
// works in Node (fs) and the browser (IndexedDB / localStorage /
// fetch). The default in-memory adapter is always available.
//
// The store is JSON-only (no binary). Checkpoints are small enough
// to fit in tens of MB even for 100k+ fights (we strip the heavy
// per-frame data and keep just the aggregate + a slim per-fight
// summary by default).
// ============================================================================

import type { CheckpointState } from "./BatchExecutor";
import type { FightResult, SeriesAggregate, MatchTypeId } from "./MatchResult";

// ----------------------------------------------------------------------------
// IO adapter (dependency-injected; works in Node + browser)
// ----------------------------------------------------------------------------

export interface CheckpointIO {
  /** Persist the raw JSON string under a key. */
  write(key: string, data: string): Promise<void> | void;
  /** Read the raw JSON string for a key, or null if absent. */
  read(key: string): Promise<string | null> | string | null;
  /** Delete a key. */
  remove(key: string): Promise<void> | void;
  /** List all keys with a prefix. */
  list(prefix: string): Promise<string[]> | string[];
}

/** In-memory IO (default; useful for tests and in-browser sessions). */
export class InMemoryIO implements CheckpointIO {
  private store = new Map<string, string>();
  write(key: string, data: string): void { this.store.set(key, data); }
  read(key: string): string | null { return this.store.get(key) ?? null; }
  remove(key: string): void { this.store.delete(key); }
  list(prefix: string): string[] {
    return [...this.store.keys()].filter(k => k.startsWith(prefix));
  }
}

/** Node fs adapter (lazy-requires `fs` so the module works in the browser). */
export class NodeFsIO implements CheckpointIO {
  constructor(private directory: string) {}
  private get fs(): { writeFileSync: (p: string, s: string) => void; readFileSync: (p: string) => string; existsSync: (p: string) => boolean; unlinkSync: (p: string) => void; readdirSync: (p: string) => string[]; mkdirSync: (p: string, o: { recursive?: boolean }) => void } | null {
    try {
      // Use eval to avoid TypeScript errors on browser builds
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const req = (0, eval)("require");
      return req("fs") as any;
    } catch { return null; }
  }
  private pathFor(key: string): string {
    const sep = this.directory.includes("\\") ? "\\" : "/";
    return `${this.directory}${sep}${key}.json`;
  }
  private ensureDir(): void {
    const fs = this.fs;
    if (!fs) return;
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }
  }
  write(key: string, data: string): void {
    this.ensureDir();
    const fs = this.fs;
    if (!fs) throw new Error("NodeFsIO: fs not available");
    fs.writeFileSync(this.pathFor(key), data);
  }
  read(key: string): string | null {
    const fs = this.fs;
    if (!fs) return null;
    const p = this.pathFor(key);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
  }
  remove(key: string): void {
    const fs = this.fs;
    if (!fs) return;
    const p = this.pathFor(key);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  list(prefix: string): string[] {
    const fs = this.fs;
    if (!fs) return [];
    if (!fs.existsSync(this.directory)) return [];
    return fs.readdirSync(this.directory).filter(f => f.startsWith(prefix) && f.endsWith(".json"));
  }
}

// ----------------------------------------------------------------------------
// Compacted checkpoint payload
// ----------------------------------------------------------------------------

interface CompactCheckpoint {
  nextIndex: number;
  seed: number;
  rngState: number;
  timestamp: number;
  sideAId: string;
  sideBId: string;
  matchType: MatchTypeId;
  aggregate: SeriesAggregate;
  /** Slim per-fight summary. */
  fights: CompactFight[];
}

interface CompactFight {
  id: string;
  seed: number;
  matchType: MatchTypeId;
  sideAId: string;
  sideBId: string;
  winnerSide: 0 | 1 | null;
  durationSeconds: number;
  damageA: number;
  damageB: number;
  maxComboA: number;
  maxComboB: number;
  hpFracA: number;
  hpFracB: number;
  rounds: number;
  meta: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// CheckpointStore
// ----------------------------------------------------------------------------

export class CheckpointStore {
  constructor(
    private io: CheckpointIO = new InMemoryIO(),
    /** Whether to include the full FightResult in checkpoints (heavy). */
    private includeFullFights = false,
  ) {}

  /**
   * Build a CheckpointState suitable for the BatchExecutor from a
   * BatchExecutor-style call. The caller provides the live state.
   */
  static fromBatchParams(p: {
    nextIndex: number;
    seed: number;
    fights: FightResult[];
    rngState: number;
    aggregate: SeriesAggregate;
    sideAId: string;
    sideBId: string;
    matchType: MatchTypeId;
  }): CheckpointState {
    return {
      nextIndex: p.nextIndex,
      seed: p.seed,
      results: p.fights.slice(),
      rngState: p.rngState,
      timestamp: Date.now(),
      aggregate: p.aggregate,
      sideAId: p.sideAId,
      sideBId: p.sideBId,
      matchType: p.matchType,
    };
  }

  /** Save a checkpoint to the IO store. */
  async save(key: string, state: CheckpointState): Promise<void> {
    const compact: CompactCheckpoint = {
      nextIndex: state.nextIndex,
      seed: state.seed,
      rngState: state.rngState,
      timestamp: state.timestamp,
      sideAId: state.sideAId,
      sideBId: state.sideBId,
      matchType: state.matchType,
      aggregate: state.aggregate,
      fights: state.results.map(f => ({
        id: f.id,
        seed: f.seed,
        matchType: f.matchType,
        sideAId: f.sideAId,
        sideBId: f.sideBId,
        winnerSide: f.winnerSide,
        durationSeconds: f.durationSeconds,
        damageA: f.sideA.damageDealt,
        damageB: f.sideB.damageDealt,
        maxComboA: f.sideA.maxCombo,
        maxComboB: f.sideB.maxCombo,
        hpFracA: f.sideA.hpFrac,
        hpFracB: f.sideB.hpFrac,
        rounds: f.rounds.length,
        meta: f.meta as Record<string, unknown>,
      })),
    };
    await this.io.write(key, JSON.stringify(compact));
  }

  /** Load a checkpoint. Returns null if the key doesn't exist. */
  async load(key: string): Promise<CheckpointState | null> {
    const raw = await this.io.read(key);
    if (!raw) return null;
    const compact = JSON.parse(raw) as CompactCheckpoint;
    // Re-hydrate slim fights into full FightResult stubs. The full
    // VFX/telemetry is NOT preserved; the user opted out of
    // `includeFullFights` by default to keep checkpoints small.
    const fights: FightResult[] = compact.fights.map(cf => ({
      id: cf.id,
      seed: cf.seed,
      matchType: cf.matchType,
      sideAId: cf.sideAId,
      sideBId: cf.sideBId,
      winnerSide: cf.winnerSide,
      durationSeconds: cf.durationSeconds,
      timedOut: false,
      sideA: {
        damageDealt: cf.damageA, damageTaken: 0, hits: 0, hitsBlocked: 0,
        maxCombo: cf.maxComboA, totalCombos: 0, comboHistogram: {},
        attackKinds: {}, attackTime: 0, blockTime: 0,
        distanceMean: 0, distanceStdDev: 0, hpFrac: cf.hpFracA, maxHp: 100,
        roundsWon: cf.winnerSide === 0 ? cf.rounds : 0,
      },
      sideB: {
        damageDealt: cf.damageB, damageTaken: 0, hits: 0, hitsBlocked: 0,
        maxCombo: cf.maxComboB, totalCombos: 0, comboHistogram: {},
        attackKinds: {}, attackTime: 0, blockTime: 0,
        distanceMean: 0, distanceStdDev: 0, hpFrac: cf.hpFracB, maxHp: 100,
        roundsWon: cf.winnerSide === 1 ? cf.rounds : 0,
      },
      rounds: [],
      meta: cf.meta as any,
      directorDecisions: [],
    }));
    return {
      nextIndex: compact.nextIndex,
      seed: compact.seed,
      results: fights,
      rngState: compact.rngState,
      timestamp: compact.timestamp,
      aggregate: compact.aggregate,
      sideAId: compact.sideAId,
      sideBId: compact.sideBId,
      matchType: compact.matchType,
    };
  }

  /** List all checkpoint keys. */
  async list(prefix: string): Promise<string[]> {
    return this.io.list(prefix);
  }

  /** Delete a checkpoint. */
  async clear(key: string): Promise<void> {
    await this.io.remove(key);
  }
}
