# Offline Evolution Framework

This directory contains a complete offline genetic-algorithm framework for tuning the rule-based `EnemyAI` behaviour parameters. It is intentionally isolated from the combat engine, physics, renderer, and animation systems.

## Core Constraints

- **No engine modification** — `engine.ts`, `fighter.ts`, `render.ts`, and animation files are untouched.
- **No runtime mutation** — `ChampionGenome.json` is a frozen artifact loaded at runtime.
- **Deterministic simulations** — each match can be run with a seeded PRNG.
- **LLM-modifiable** — all tunable parts are expressed as interfaces.

## Quick Start

```typescript
import { createEvolutionManager, EvolutionReport } from "@/lib/game/evolution";

const manager = createEvolutionManager(config, 0);
const champion = await manager.run();

const report = new EvolutionReport({
  config,
  snapshots: manager.getSnapshots(),
  champion,
  lineage: manager.getLineage(),
  mutationHistory: manager.getMutationHistory(),
  evaluations: manager.getEvaluations(),
});

// Runtime artifact
const championJson = report.serializeChampion();
```

## Module Overview

| File | Responsibility |
|------|----------------|
| `Genome.ts` | Schema, defaults, validation, distance metrics |
| `GenomeSerializer.ts` | Convert genome ↔ `OpponentDef`, load champion JSON |
| `MutationEngine.ts` | Bounded mutation with catastrophic/fine-tune modes |
| `CrossoverEngine.ts` | Uniform, single-point, and arithmetic crossover |
| `Population.ts` | Tournament selection, elitism, diversity measurement |
| `FitnessEvaluator.ts` | Weighted multi-objective fitness |
| `SimulationRunner.ts` | Deterministic `GameEngine` harness |
| `EvolutionManager.ts` | Full GA loop with early stopping and restart |
| `EvolutionReport.ts` | Reporting, lineage, and JSON export |
| `agents/` | Eight scripted player archetypes |

## Documentation

See `docs/evolution/ARCHITECTURE.md` for:
- Architecture diagram
- Evolution pipeline
- Class diagram
- Interfaces
- Folder structure
- Genome schema
- Simulation flow
- Fitness equation
- Performance analysis
- Integration guide
- Champion export format
