# Offline Genetic Algorithm Trainer

This module evolves fighting-game AI parameters without training a neural network.
Each agent is an `OfflineGenome` with normalized `[0, 1]` genes. The GA engine is
decoupled from the combat simulator through `FightingSimulator`, so Unity,
Unreal, or another headless simulator can be plugged in by implementing that
interface.

## Run

```bash
bun run train:offline-ga
```

Useful overrides:

```bash
bun run train:offline-ga -- --seed=1337 --generations=100 --max-generations=300 --population=100
```

Outputs:

- `best_genome.json`
- `data/offline-ga-checkpoints/latest.json`
- `data/offline-ga-checkpoints/generation_XXXX.json`

## Architecture

- `Genome.ts`: normalized gene schema, crossover, Gaussian mutation, diversity.
- `Fitness.ts`: configurable weighted fitness from simulator outcomes only.
- `SimulatorAdapter.ts`: maps offline genes to the current headless game simulator.
- `OfflineEvolutionTrainer.ts`: population loop, tournament selection, elitism,
  validation, adaptive baseline pressure, logging, and checkpointing.
- `CheckpointStore.ts`: JSON persistence for every generation and final artifact.

## Validation

After the configured training generations, the trainer freezes only the best
genome and evaluates it against all configured baseline opponents. If any
baseline win rate is below the configured threshold, evolution resumes and the
failed baselines receive increased fitness pressure until validation passes or
`maxGenerations` is reached.
