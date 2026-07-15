// THE SHADOW'S ASCENSION — a storyline for the Shadow Fight intro. The player
// is an ancient evil, unsealed from the Gates of Shadow. The opponents are the
// last heroes — the Sealers — trying to cage the player once more. Eight acts
// timed as a standalone silent cinematic prologue
// (141.98s ≈ 2:22). Each act is a DISTINCT painted scene that visually depicts
// its narration — a movie, not subtitles over a static backdrop.

export type SceneKind =
  | "dawn_oath" // the gates crack open at dawn — the shadow claws free
  | "march_hunt" // the shadow marches out, silhouettes of the sealers massing ahead
  | "seals" // a fallen hero's body with glowing chains, the shadow claiming them
  | "village" // a village in flames, the people screaming, the shadow walking through
  | "gate_meet" // the gate of the last temple, an old master waiting — tension builds
  | "gate_fight" // INTENSE sword fight at the gate — clashing blades, sparks
  | "reflection_twist" // a reflection in blood-red water — the shadow's true face
  | "demon_reveal" // the shadow fully unfurls — wings of darkness, crown of ash
  | "screaming" // the world burning, the last heroes broken at the shadow's feet
  | "final_riverbank"; // the shadow stands atop the ruined gate, world in ash

export interface StoryBeat {
  t: number;
  end: number;
  act: string;
  lines: string[];
  scene: SceneKind;
}

export const STORY_BEATS: StoryBeat[] = [
  {
    t: 0,
    end: 12,
    act: "I — The Unsealing",
    scene: "dawn_oath",
    lines: [
      "For a thousand years the Gates of Shadow held you.",
      "Now, at dawn, the seals crack — and you are free.",
      "An ancient evil, wearing flesh again, steps out onto the riverbank.",
    ],
  },
  {
    t: 12,
    end: 25,
    act: "II — The Hunt",
    scene: "march_hunt",
    lines: [
      "The last of the heroes gather to cage you once more.",
      "Apprentice. Defector. Guard. Hermit. Nightblade. Colossus. Shogun.",
      "One by one, you will break them, and take their seals.",
    ],
  },
  {
    t: 25,
    end: 34,
    act: "III — The Seals",
    scene: "seals",
    lines: [
      "Each hero carries a seal. Each seal you claim.",
      "With every seal, the chains that bound you grow weaker —",
      "and your shadow stretches longer across the world.",
    ],
  },
  {
    t: 34,
    end: 51,
    act: "IV — The Reckoning",
    scene: "village",
    lines: [
      "The villages that once cheered the heroes now burn.",
      "Their torches are nothing against your dark.",
      "There are no more cheers. Only ash, and silence.",
    ],
  },
  {
    t: 51,
    end: 62,
    act: "V — The Last Master",
    scene: "gate_meet",
    lines: [
      "At last you come to the final temple, where the last master waits.",
      "'Abomination,' he says, drawing his blade. 'I sealed you once.'",
      "'I will seal you again — or die in the trying.'",
    ],
  },
  {
    t: 62,
    end: 83,
    act: "VI — The Clash",
    scene: "gate_fight",
    lines: [
      "The master lunges. Steel rings on shadow at the gate of the temple —",
      "the world's last hope against the thing that wore a hero's skin",
      "and walked the whole road home to burn it.",
    ],
  },
  {
    t: 83,
    end: 103,
    act: "VII — The Reflection",
    scene: "reflection_twist",
    lines: [
      "The master falls. You take the final seal from his hand.",
      "And in the blood-red water below, the face that looks back...",
      "is finally, fully, your own.",
    ],
  },
  {
    t: 103,
    end: 121,
    act: "VIII — The Ascension",
    scene: "demon_reveal",
    lines: [
      "No more masks. No more borrowed faces.",
      "Your shadow unfurls into wings of darkness, a crown of ash.",
      "The Gates of Shadow swing wide — and cannot ever close again.",
    ],
  },
  {
    t: 121,
    end: 134,
    act: "IX — The Screams",
    scene: "screaming",
    lines: [
      "The heroes who came to stop you lie broken at your feet.",
      "The apprentices. The defectors. The last hope of the world.",
      "What were once battle-cries... are now only silence.",
    ],
  },
  {
    t: 134,
    end: 142,
    act: "Coda — The Ascension",
    scene: "final_riverbank",
    lines: [
      "Now you stand atop the ruined gate, where the oath was sworn.",
      "The river runs red. The sky burns black.",
      "The world is yours to end.",
      "And you — are the shadow ascended.",
    ],
  },
];

export const STORY_DURATION = 142; // seconds (~2:22)
export const TITLE = "THE SHADOW'S ASCENSION";
