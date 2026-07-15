// ============================================================================
// SCRIPTED PLAYER AGENTS
//
// Deterministic archetypes used to evaluate a genome across play-styles.
// Each genome must fight every archetype; fitness is averaged.
// ============================================================================

import type { IPlayerAgent } from "../types";
import { AggressiveAgent } from "./AggressiveAgent";
import { DefensiveAgent } from "./DefensiveAgent";
import { CounterAgent } from "./CounterAgent";
import { ComboAgent } from "./ComboAgent";
import { RiskyAgent } from "./RiskyAgent";
import { PassiveAgent } from "./PassiveAgent";
import { JumperAgent } from "./JumperAgent";
import { RollSpamAgent } from "./RollSpamAgent";
import { BeginnerAgent } from "./BeginnerAgent";
import { SpeedrunnerAgent } from "./SpeedrunnerAgent";
import { TurtleAgent } from "./TurtleAgent";
import { RandomAgent } from "./RandomAgent";
import { SuperSaverAgent } from "./SuperSaverAgent";
import { FootsiesAgent } from "./FootsiesAgent";
import { WhiffPunisherAgent } from "./WhiffPunisherAgent";

export * from "./AggressiveAgent";
export * from "./DefensiveAgent";
export * from "./CounterAgent";
export * from "./ComboAgent";
export * from "./RiskyAgent";
export * from "./PassiveAgent";
export * from "./JumperAgent";
export * from "./RollSpamAgent";
export * from "./BeginnerAgent";
export * from "./SpeedrunnerAgent";
export * from "./TurtleAgent";
export * from "./RandomAgent";
export * from "./SuperSaverAgent";
export * from "./FootsiesAgent";
export * from "./WhiffPunisherAgent";

/** All archetypes a genome must face. */
export function createAllAgents(): IPlayerAgent[] {
  return [
    new AggressiveAgent(),
    new DefensiveAgent(),
    new CounterAgent(),
    new ComboAgent(),
    new RiskyAgent(),
    new PassiveAgent(),
    new JumperAgent(),
    new RollSpamAgent(),
    new BeginnerAgent(),
    new SpeedrunnerAgent(),
    new TurtleAgent(),
    new RandomAgent(),
    new SuperSaverAgent(),
    new FootsiesAgent(),
    new WhiffPunisherAgent(),
  ];
}

/** Factory by id. */
export function createAgentById(id: string): IPlayerAgent {
  switch (id) {
    case "aggressive":
      return new AggressiveAgent();
    case "defensive":
      return new DefensiveAgent();
    case "counter":
      return new CounterAgent();
    case "combo":
      return new ComboAgent();
    case "risky":
      return new RiskyAgent();
    case "passive":
      return new PassiveAgent();
    case "jumper":
      return new JumperAgent();
    case "roll_spam":
      return new RollSpamAgent();
    case "beginner":
      return new BeginnerAgent();
    case "speedrunner":
      return new SpeedrunnerAgent();
    case "turtle":
      return new TurtleAgent();
    case "random":
      return new RandomAgent();
    case "super_saver":
      return new SuperSaverAgent();
    case "footsies":
      return new FootsiesAgent();
    case "whiff_punisher":
      return new WhiffPunisherAgent();
    default:
      return new AggressiveAgent();
  }
}
