// ============================================================================
// GENOME DIRECTOR
//
// Exposes GenomeLibrary to the existing Director so it can select an evolved
// style based on campaign intent, player profile, and stage. The runtime still
// loads frozen genomes; no evolution happens at runtime.
// ============================================================================

import type { GenomeStyle, IGenomeLibrary, ILibraryEntry, IDirectorPlayerProfile, IGenomeSelectionInput } from "./types";

export class GenomeDirector {
  constructor(private library: IGenomeLibrary) {}

  /** Selects the best style for the current Director intent. */
  selectGenome(input: IGenomeSelectionInput): ILibraryEntry {
    const { intent, playerProfile, campaignStage = 0, previousStyle } = input;
    const entries = Object.values(this.library.entries);

    // Score each style by intent match.
    const scored = entries.map((entry) => ({
      entry,
      score: this.scoreEntry(entry, intent, playerProfile, campaignStage, previousStyle),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.entry ?? entries[0];
  }

  /** Returns the full library for Director inspection. */
  getLibrary(): IGenomeLibrary {
    return this.library;
  }

  /** Direct lookup by style. */
  getStyle(style: GenomeStyle): ILibraryEntry | undefined {
    return this.library.entries[style];
  }

  private scoreEntry(
    entry: ILibraryEntry,
    intent: IGenomeSelectionInput["intent"],
    profile?: IDirectorPlayerProfile,
    campaignStage = 0,
    previousStyle?: GenomeStyle,
  ): number {
    let score = 0;

    switch (intent) {
      case "teachSpacing":
        score += entry.style === "zoner" ? 1 : entry.genome.mixup * 0.5;
        break;
      case "punishRecklessness":
        score += entry.style === "counter" ? 1 : entry.genome.blockChance * 0.5 + entry.genome.whiffPunish * 0.5;
        break;
      case "emotionalClimax":
        score += entry.style === "adaptive" || entry.style === "mindGame" ? 0.9 : entry.genome.rage * 0.5;
        break;
      case "introduceMechanic":
        score += entry.style === "balanced" ? 0.8 : 0.2;
        break;
      case "buildTension":
        score += entry.style === "patient" || entry.style === "pressure" ? 0.8 : entry.genome.reaction * 0.5;
        break;
      case "rewardPatience":
        score += entry.style === "patient" ? 1 : (1 - entry.genome.aggression) * 0.5;
        break;
      case "testAdaptation":
        score += entry.style === "adaptive" || entry.style === "mindGame" ? 1 : entry.genome.adaptive * 0.7;
        break;
      case "balanced":
      default:
        score += entry.style === "balanced" ? 0.7 : 0.3;
        break;
    }

    // Counter the previous style to force variety.
    if (previousStyle && entry.style !== previousStyle) {
      score += 0.1;
    }

    // Scale difficulty with campaign stage.
    const expectedDifficulty = Math.min(1, campaignStage / 7);
    const genomeDifficulty = this.estimateDifficulty(entry.genome);
    score += 1 - Math.abs(expectedDifficulty - genomeDifficulty);

    // Match to player profile if provided.
    if (profile) {
      if (profile.aggression > 0.6 && entry.genome.blockChance > 0.4) score += 0.15;
      if (profile.defense > 0.6 && entry.genome.mixup > 0.4) score += 0.15;
      if (profile.patience > 0.6 && entry.style === "patient") score += 0.15;
    }

    return score;
  }

  private estimateDifficulty(genome: ILibraryEntry["genome"]): number {
    return (
      genome.aggression * 0.25 +
      genome.pressure * 0.2 +
      genome.adaptive * 0.2 +
      genome.perfection * 0.15 +
      genome.mixup * 0.1 +
      (1 - genome.reaction) * 0.1
    );
  }
}
