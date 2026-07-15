// ============================================================================
// NARRATIVE ENGINE — generates StoryEvent objects before every boss fight.
//
// The StoryEvent explains WHY the match is different. Nothing is random —
// every environmental change has narrative meaning derived from the
// WorldState and PsychologyProfile.
// ============================================================================

import type { WorldState } from "../world/WorldState";
import type { PsychologyProfile } from "../psychology/PsychologyEngine";

export interface StoryEvent {
  reason: string;               // why this fight is happening now
  worldEvent: string;           // what happened in the world to cause this
  bossEmotion: string;          // the boss's emotional state
  crowdReaction: string;        // how the crowd/world reacts
  atmosphere: string;           // the overall mood
  prophecy: string;             // a foreshadowing line
  stakes: string;               // what the player stands to lose
}

export class NarrativeEngine {
  /**
   * Generate a StoryEvent for an upcoming boss fight. Uses the WorldState
   * and PsychologyProfile to create a narratively coherent reason for
   * the match configuration.
   */
  generateStoryEvent(
    world: WorldState,
    psychology: PsychologyProfile,
    opponentName: string,
    opponentIndex: number,
  ): StoryEvent {
    const dominantArchetype = psychology.dominant.label;
    const fear = world.worldFear;
    const corruption = world.corruptionLevel;
    const hope = world.hopeLevel;
    const killed = world.bossesKilled;
    const spared = world.bossesSpared;

    // Determine the boss's emotional state from the world
    let bossEmotion: string;
    if (killed > spared) {
      bossEmotion = fear > 0.5 ? "terrified but defiant" : "grieving and enraged";
    } else if (spared > killed) {
      bossEmotion = hope > 0.5 ? "hopeful for redemption" : "confused by mercy";
    } else {
      bossEmotion = "resolute and prepared";
    }

    // The world event that caused this confrontation
    let worldEvent: string;
    if (killed >= 3) {
      worldEvent = `With ${killed} sealers fallen, the land of ${opponentName} burns. The survivors have gathered what remains.`;
    } else if (spared >= 2) {
      worldEvent = `Word of your mercy has spread. ${opponentName} comes not to kill, but to understand.`;
    } else if (corruption > 0.5) {
      worldEvent = `The corruption spreads. ${opponentName}'s homeland is already half-consumed. This fight is all that remains.`;
    } else {
      worldEvent = `${opponentName} stands at the gate, the last defense before the seal weakens further.`;
    }

    // The reason for the fight (player-specific)
    let reason: string;
    if (dominantArchetype === "Aggressor" || dominantArchetype === "Risk Taker") {
      reason = `You have cut a bloody path here. ${opponentName} will not let you pass without answering for every life taken.`;
    } else if (dominantArchetype === "Defender" || dominantArchetype === "Patient Fighter") {
      reason = `${opponentName} has studied your patience. They know you will wait — and they will make you break first.`;
    } else if (dominantArchetype === "Mind Gamer" || dominantArchetype === "Adaptive Player") {
      reason = `${opponentName} knows you adapt. They have prepared something you have never seen.`;
    } else if (dominantArchetype === "Panicker") {
      reason = `${opponentName} smells your fear. They will press until you break.`;
    } else if (dominantArchetype === "Speedrunner") {
      reason = `${opponentName} knows you rush. They will slow you down — by any means.`;
    } else {
      reason = `${opponentName} blocks your path. The seal they carry must be taken.`;
    }

    // Crowd reaction
    let crowdReaction: string;
    if (fear > 0.6) {
      crowdReaction = "The few who remain watch in silence, too afraid to cheer.";
    } else if (hope > 0.6) {
      crowdReaction = "A crowd has gathered, whispering prayers for both fighters.";
    } else if (killed > 2) {
      crowdReaction = "The streets are empty. Everyone who could flee already has.";
    } else {
      crowdReaction = "A tense crowd watches from the walls.";
    }

    // Atmosphere
    let atmosphere: string;
    if (corruption > 0.6) atmosphere = "The air itself is thick with decay.";
    else if (fear > 0.5) atmosphere = "A heavy dread settles over the arena.";
    else if (hope > 0.5) atmosphere = "There is still light here, fading but present.";
    else atmosphere = "The arena is quiet, waiting.";

    // Prophecy (foreshadowing based on world state)
    const prophecies = [
      "The old texts say: 'When the shadow falls on the last gate, the world chooses its ending.'",
      "It is written: 'The one who breaks the eighth seal decides if the dawn comes.'",
      "The monks prophesied: 'A shadow will come that wears a hero's face. The world will burn or be saved by a single choice.'",
      "Legend says: 'Each sealer's fall darkens the sky a shade further. Eight falls, and there is no sky left.'",
    ];
    const prophecy = prophecies[opponentIndex % prophecies.length];

    // Stakes
    let stakes: string;
    if (opponentIndex >= 6) {
      stakes = "This is the penultimate battle. One more, and the gates are yours forever.";
    } else if (opponentIndex === 7) {
      stakes = "The last sealer. The last seal. The last hope of the old world.";
    } else {
      stakes = `Defeat ${opponentName} to claim their seal. The world grows darker with each fall.`;
    }

    return {
      reason,
      worldEvent,
      bossEmotion,
      crowdReaction,
      atmosphere,
      prophecy,
      stakes,
    };
  }

  /**
   * Generate a MythEntry after a boss is defeated or spared.
   */
  generateMyth(
    world: WorldState,
    opponentName: string,
    won: boolean,
    spared: boolean,
    psychology: PsychologyProfile,
  ): { year: number; location: string; event: string; consequence: string; legend: string } {
    const year = 1000 + world.bossesKilled + world.bossesSpared; // in-world year
    const location = `${opponentName}'s arena`;

    let event: string;
    let consequence: string;
    let legend: string;

    if (won && spared) {
      event = `The Shadow spared ${opponentName} in single combat.`;
      consequence = "Hope flickered. The spared sealer vanished into the mountains.";
      legend = `And the Shadow, in a moment none expected, stayed its hand. ${opponentName} lived — and the world remembered that even darkness can choose mercy.`;
    } else if (won && !spared) {
      event = `The Shadow broke ${opponentName} and claimed the seal.`;
      consequence = `The land around ${opponentName}'s home withered. ${Math.floor(Math.random() * 300 + 100)} souls were lost.`;
      legend = `${opponentName} fell as the others fell before — broken, sealed, forgotten. The Shadow grew stronger, and the world grew afraid.`;
    } else {
      event = `The Shadow was driven back by ${opponentName}.`;
      consequence = "The seal held. Hope surged through the remaining villages.";
      legend = `For the first time, the Shadow was turned away. ${opponentName} stood victorious, and the people dared to believe the darkness could be caged again.`;
    }

    // Add psychology-flavored detail
    const archetype = psychology.dominant.label;
    legend += ` The Shadow fought as a ${archetype.toLowerCase()}, and the world would not forget.`;

    return { year, location, event, consequence, legend };
  }
}
