// ============================================================================
// Music Library — 9 prebuilt music profiles.
// Selected by the AI Director. Applied by the audio engine.
// ============================================================================

export type MusicId =
  | "peaceful" | "epic" | "dark" | "hopeless" | "victory"
  | "ancient" | "percussion" | "choir" | "silence";

export interface MusicProfile {
  id: MusicId;
  label: string;
  // Tempo
  bpm: number;
  // Scale (which pentatonic degrees to use)
  scaleRoot: number;       // Hz of the root note
  scaleType: "major_penta" | "minor_penta" | "chromatic";
  // Instrument mix (0..1 per instrument)
  erhu: number;
  guzheng: number;
  dizi: number;
  templeBlock: number;
  frameDrum: number;
  bigDrum: number;
  subBass: number;
  // Dynamic layering
  intensityBase: number;   // 0..1 starting intensity
  intensityOnHit: number;  // intensity bump per hit
  // Mood
  mood: "calm" | "tense" | "epic" | "dark" | "triumphant" | "despair" | "neutral";
  // Low-HP behavior
  lowHpShift: boolean;     // shift erhu down a degree at low HP
  // Volume
  volume: number;
}

export const MUSIC: Record<MusicId, MusicProfile> = {
  peaceful: {
    id: "peaceful", label: "Peaceful",
    bpm: 72, scaleRoot: 146.83, scaleType: "major_penta",
    erhu: 0.8, guzheng: 0.6, dizi: 0.5, templeBlock: 0.1, frameDrum: 0.2, bigDrum: 0, subBass: 0.3,
    intensityBase: 0.1, intensityOnHit: 0.05,
    mood: "calm", lowHpShift: true, volume: 0.5,
  },
  epic: {
    id: "epic", label: "Epic",
    bpm: 96, scaleRoot: 164.81, scaleType: "major_penta",
    erhu: 0.6, guzheng: 0.5, dizi: 0.3, templeBlock: 0.3, frameDrum: 0.6, bigDrum: 0.8, subBass: 0.5,
    intensityBase: 0.4, intensityOnHit: 0.15,
    mood: "epic", lowHpShift: true, volume: 0.65,
  },
  dark: {
    id: "dark", label: "Dark",
    bpm: 80, scaleRoot: 130.81, scaleType: "minor_penta",
    erhu: 0.7, guzheng: 0.3, dizi: 0.2, templeBlock: 0.2, frameDrum: 0.4, bigDrum: 0.6, subBass: 0.7,
    intensityBase: 0.3, intensityOnHit: 0.1,
    mood: "dark", lowHpShift: true, volume: 0.55,
  },
  hopeless: {
    id: "hopeless", label: "Hopeless",
    bpm: 60, scaleRoot: 123.47, scaleType: "minor_penta",
    erhu: 0.9, guzheng: 0.2, dizi: 0.1, templeBlock: 0.1, frameDrum: 0.3, bigDrum: 0.5, subBass: 0.8,
    intensityBase: 0.2, intensityOnHit: 0.05,
    mood: "despair", lowHpShift: true, volume: 0.6,
  },
  victory: {
    id: "victory", label: "Victory",
    bpm: 110, scaleRoot: 185.0, scaleType: "major_penta",
    erhu: 0.8, guzheng: 0.8, dizi: 0.6, templeBlock: 0.4, frameDrum: 0.7, bigDrum: 0.9, subBass: 0.4,
    intensityBase: 0.6, intensityOnHit: 0.2,
    mood: "triumphant", lowHpShift: false, volume: 0.7,
  },
  ancient: {
    id: "ancient", label: "Ancient",
    bpm: 84, scaleRoot: 146.83, scaleType: "major_penta",
    erhu: 0.5, guzheng: 0.4, dizi: 0.7, templeBlock: 0.5, frameDrum: 0.3, bigDrum: 0.3, subBass: 0.4,
    intensityBase: 0.25, intensityOnHit: 0.1,
    mood: "tense", lowHpShift: true, volume: 0.55,
  },
  percussion: {
    id: "percussion", label: "Percussion",
    bpm: 100, scaleRoot: 164.81, scaleType: "major_penta",
    erhu: 0.1, guzheng: 0.1, dizi: 0, templeBlock: 0.8, frameDrum: 0.9, bigDrum: 1.0, subBass: 0.6,
    intensityBase: 0.5, intensityOnHit: 0.2,
    mood: "tense", lowHpShift: false, volume: 0.65,
  },
  choir: {
    id: "choir", label: "Choir",
    bpm: 68, scaleRoot: 146.83, scaleType: "major_penta",
    erhu: 0.4, guzheng: 0.3, dizi: 0.5, templeBlock: 0.1, frameDrum: 0.2, bigDrum: 0.3, subBass: 0.5,
    intensityBase: 0.2, intensityOnHit: 0.08,
    mood: "calm", lowHpShift: true, volume: 0.5,
  },
  silence: {
    id: "silence", label: "Silence",
    bpm: 0, scaleRoot: 0, scaleType: "major_penta",
    erhu: 0, guzheng: 0, dizi: 0, templeBlock: 0, frameDrum: 0, bigDrum: 0, subBass: 0,
    intensityBase: 0, intensityOnHit: 0,
    mood: "neutral", lowHpShift: false, volume: 0,
  },
};
