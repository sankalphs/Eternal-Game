// ============================================================================
// FROZEN GENOME LIBRARY TESTS
// ============================================================================

import { describe, expect, it } from "bun:test";
import { GenomeFreezer, deserializeFrozenLibrary, serializeFrozenLibrary, frozenLibraryFilename, parseFrozenLibraryFilename } from "../../src/lib/game/evolution/FrozenGenomeLibrary";
import type { IGenomeLibrary, GenomeStyle, ILibraryEntry } from "../../src/lib/game/evolution/types";

const makeLibrary = (): IGenomeLibrary => {
  const entries: Partial<Record<GenomeStyle, ILibraryEntry>> = {};
  const styles: GenomeStyle[] = ["balanced", "aggressive", "counter", "patient"];
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i];
    entries[style] = {
      style,
      genome: {
        id: `${style}_genome_${i}`,
        version: "1.0.0",
        generation: 10,
        aggression: 0.3 + i * 0.1,
        blockChance: 0.4,
        reaction: 0.4,
        combo: 2,
        whiffPunish: 0.3,
        antiAir: 0.3,
        pressure: 0.4,
        mixup: 0.3,
        adaptive: 0.4,
        rage: 0.3,
        perfection: 0.3,
        readDelay: 0.05,
        fitness: 0.5 + i * 0.1,
        rawFitness: 0.5 + i * 0.1,
      },
      weights: {} as never,
      benchmarks: {},
      narrative: `${style} narrative`,
    };
  }
  return {
    version: "0.1.0",
    exportedAt: new Date().toISOString(),
    baseOpponent: "default",
    entries: entries as Record<GenomeStyle, ILibraryEntry>,
  };
};

describe("FrozenGenomeLibrary", () => {
  describe("filename helpers", () => {
    it("formats filenames", () => {
      expect(frozenLibraryFilename("v1")).toBe("GenomeLibrary_v1.json");
      expect(frozenLibraryFilename("v42")).toBe("GenomeLibrary_v42.json");
    });

    it("parses filenames", () => {
      expect(parseFrozenLibraryFilename("GenomeLibrary_v1.json")).toBe("v1");
      expect(parseFrozenLibraryFilename("GenomeLibrary_v99.json")).toBe("v99");
    });

    it("rejects invalid filenames", () => {
      expect(parseFrozenLibraryFilename("ChampionGenome.json")).toBe(null);
      expect(parseFrozenLibraryFilename("library_v1.json")).toBe(null);
    });
  });

  describe("GenomeFreezer", () => {
    it("freezes a live library into a permanent record", () => {
      const live = makeLibrary();
      const freezer = new GenomeFreezer();
      const frozen = freezer.freeze(live, {
        version: "v1",
        baseOpponent: "default",
        seedBase: 0,
        configHash: "abc123",
        notes: "test freeze",
        eloRatings: { "aggressive_genome_1": 1650 },
        topNPerStyle: 1,
      });
      expect(frozen.version).toBe("v1");
      expect(frozen.baseOpponent).toBe("default");
      expect(Object.keys(frozen.entries).length).toBeGreaterThan(0);
      expect(frozen.totalUniqueEntries).toBeGreaterThan(0);
    });

    it("attaches provenance to each entry", () => {
      const live = makeLibrary();
      const freezer = new GenomeFreezer();
      const frozen = freezer.freeze(live, {
        version: "v1",
        baseOpponent: "default",
        seedBase: 0,
        configHash: "abc",
        notes: "",
        eloRatings: {},
      });
      for (const entry of Object.values(frozen.entries)) {
        expect(entry.frozenId).toBeDefined();
        expect(entry.frozenAt).toBeDefined();
        expect(entry.libraryVersion).toBe("v1");
        expect(entry.sourceVersion).toBe("0.1.0");
      }
    });

    it("carries lineage across versions", () => {
      const live = makeLibrary();
      const freezer = new GenomeFreezer();
      const v1 = freezer.freeze(live, {
        version: "v1", baseOpponent: "default", seedBase: 0,
        configHash: "h1", notes: "first", eloRatings: {},
      });
      const v2 = freezer.freeze(live, {
        version: "v2", baseOpponent: "default", seedBase: 0,
        configHash: "h2", notes: "second", eloRatings: {},
        previousLibrary: v1,
      });
      expect(v2.lineage).toHaveLength(2);
      expect(v2.lineage[0].version).toBe("v1");
      expect(v2.lineage[1].version).toBe("v2");
    });

    it("computes diffs between versions", () => {
      const live = makeLibrary();
      const freezer = new GenomeFreezer();
      const v1 = freezer.freeze(live, {
        version: "v1", baseOpponent: "default", seedBase: 0,
        configHash: "h", notes: "", eloRatings: { "aggressive_genome_1": 1500 },
      });
      const v2 = freezer.freeze(live, {
        version: "v2", baseOpponent: "default", seedBase: 0,
        configHash: "h", notes: "", eloRatings: { "aggressive_genome_1": 1600 },
      });
      const diff = freezer.diff(v1, v2);
      expect(diff.fromVersion).toBe("v1");
      expect(diff.toVersion).toBe("v2");
    });
  });

  describe("serialisation", () => {
    it("round-trips a frozen library", () => {
      const live = makeLibrary();
      const freezer = new GenomeFreezer();
      const frozen = freezer.freeze(live, {
        version: "v1", baseOpponent: "default", seedBase: 0,
        configHash: "h", notes: "rt", eloRatings: {},
      });
      const json = serializeFrozenLibrary(frozen);
      const restored = deserializeFrozenLibrary(json);
      expect(restored.version).toBe(frozen.version);
      expect(Object.keys(restored.entries).length).toBe(Object.keys(frozen.entries).length);
    });
  });
});
