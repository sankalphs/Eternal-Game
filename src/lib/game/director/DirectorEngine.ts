// ============================================================================
// AI Director — the meta-game intelligence that plans each fight.
//
// The Director NEVER runs during combat. It only runs:
//   - Before a boss fight (to plan the encounter)
//   - After a boss fight (to update the player profile)
//   - After the campaign (to generate the ending)
//
// Input:  PlayerProfile (from the profiler)
// Output: DirectorPlan (weather, hazards, camera, bossStyle, difficulty, dialogue)
//
// The existing engine executes the DirectorPlan. The Director never controls
// physics, never touches the game loop, and never generates content at runtime.
// It only SELECTS from the prebuilt content library.
// ============================================================================

import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { WeatherId } from "../content/weather";
import type { HazardId } from "../content/hazards";
import type { CameraId } from "../content/cameras";
import type { MusicId } from "../content/music";
import type { CrowdId } from "../content/crowds";
import type { BossStyleId } from "../content/boss_styles";
import type { DifficultyId } from "../content/difficulties";

export interface DirectorPlan {
  weather: WeatherId;
  music: MusicId;
  hazards: HazardId[];
  camera: CameraId;
  crowd: CrowdId;
  bossStyle: BossStyleId;
  difficulty: DifficultyId;
  dialogue: {
    tone: "taunting" | "cold" | "rage" | "calm" | "despair" | "none";
    preFight: string;
    postFight?: string;
  };
}

export class DirectorEngine {
  private currentPlan: DirectorPlan | null = null;

  // Called BEFORE a boss fight. Analyzes the player's profile and selects
  // the content that will create the most dramatic, challenging encounter.
  planFight(
    profile: PlayerProfile,
    opponentIndex: number,
  ): DirectorPlan {
    const plan = this.generatePlan(profile, opponentIndex);
    this.currentPlan = plan;
    return plan;
  }

  // Called AFTER a boss fight. The profile is already updated by the profiler.
  // The director can adjust future plans based on the result.
  onFightComplete(won: boolean, profile: PlayerProfile) {
    // Future: could log results, adjust a meta-difficulty curve, etc.
    void won;
    void profile;
  }

  // Called AFTER the campaign. Returns the ending configuration.
  planEnding(profile: PlayerProfile): {
    weather: WeatherId;
    music: MusicId;
    crowd: CrowdId;
    dialogue: string;
  } {
    return {
      weather: "blood_moon",
      music: "victory",
      crowd: "ruined_kingdom",
      dialogue: this.generateEndingDialogue(profile),
    };
  }

  getCurrentPlan(): DirectorPlan | null {
    return this.currentPlan;
  }

  // ---- The core planning logic ----

  private generatePlan(
    profile: PlayerProfile,
    opponentIndex: number,
  ): DirectorPlan {
    // Analyze player tendencies
    const isAggressive = profile.aggression > 0.5;
    const isDefensive = profile.defense > 0.5;
    const isJumpy = profile.jumpFrequency > 8;
    const isRoller = profile.rollFrequency > 6;
    const isRisky = profile.riskLevel > 0.4;
    const isCornered = profile.cornerPressure > 0.3;
    const hasGoodReaction = profile.reactionSpeed < 300;
    const winsQuickly = profile.winSpeed > 0 && profile.winSpeed < 30;

    // Difficulty: scale with player skill
    let difficulty: DifficultyId = "normal";
    if (profile.matchesPlayed > 0) {
      const winRate = profile.matchesWon / profile.matchesPlayed;
      if (winRate > 0.8 && hasGoodReaction) difficulty = "brutal";
      else if (winRate > 0.6) difficulty = "hard";
      else if (winRate < 0.3) difficulty = "easy";
    }
    // Late opponents are always harder
    if (opponentIndex >= 5 && difficulty === "easy") difficulty = "normal";
    if (opponentIndex >= 6 && difficulty === "normal") difficulty = "hard";

    // Boss style: counter the player's tendencies
    let bossStyle: BossStyleId = "aggressive";
    if (isAggressive) {
      // Player attacks a lot → use counter or punisher
      bossStyle = isRisky ? "punisher" : "counter";
    } else if (isDefensive) {
      // Player blocks a lot → use rushdown or mind_game to break guard
      bossStyle = "rushdown";
    } else if (isJumpy) {
      // Player jumps a lot → anti-air zoner
      bossStyle = "zoner";
    } else if (winsQuickly) {
      // Player is fast → adaptive to keep up
      bossStyle = "adaptive";
    } else if (profile.matchesPlayed > 3) {
      // Experienced player → mind games
      bossStyle = "mind_game";
    }

    // Weather: match the narrative mood + counter the player
    let weather: WeatherId = "clear";
    if (opponentIndex <= 1) weather = "clear";
    else if (opponentIndex <= 3) weather = "fog";
    else if (opponentIndex <= 5) weather = "rain";
    else weather = "blood_moon";

    // If the player is defensive, add fog to reduce visibility (punish turtling)
    if (isDefensive && weather === "clear") weather = "fog";

    // Music: match the intensity
    let music: MusicId = "ancient";
    if (opponentIndex <= 1) music = "peaceful";
    else if (opponentIndex <= 3) music = "ancient";
    else if (opponentIndex <= 5) music = "dark";
    else music = "hopeless";

    // Hazards: add environmental pressure for skilled players
    const hazards: HazardId[] = [];
    if (opponentIndex >= 2 && isAggressive) hazards.push("temple_debris");
    if (opponentIndex >= 4 && isRisky) hazards.push("volcano");
    if (opponentIndex >= 5 && isDefensive) hazards.push("poison_mist");

    // Camera: dramatic for boss fights
    let camera: CameraId = "wide";
    if (opponentIndex >= 4) camera = "boss_focus";
    else if (opponentIndex >= 2) camera = "cinematic";

    // Crowd: set the atmosphere
    let crowd: CrowdId = "silent";
    if (opponentIndex <= 1) crowd = "cheering";
    else if (opponentIndex <= 3) crowd = "monks";
    else if (opponentIndex <= 5) crowd = "praying";
    else crowd = "ruined_kingdom";

    // Dialogue: taunt based on player weaknesses
    const dialogue = this.generateDialogue(bossStyle, profile, opponentIndex);

    return {
      weather,
      music,
      hazards,
      camera,
      crowd,
      bossStyle,
      difficulty,
      dialogue,
    };
  }

  private generateDialogue(
    bossStyle: BossStyleId,
    profile: PlayerProfile,
    opponentIndex: number,
  ): DirectorPlan["dialogue"] {
    const tones: Record<string, DirectorPlan["dialogue"]["tone"]> = {
      aggressive: "rage",
      counter: "cold",
      defensive: "calm",
      patient: "calm",
      rushdown: "rage",
      mind_game: "taunting",
      punisher: "cold",
      adaptive: "taunting",
      zoner: "cold",
    };
    const tone = tones[bossStyle] ?? "cold";

    const lines: string[] = [];
    if (profile.aggression > 0.6) lines.push("You swing wildly. I will catch every blade.");
    if (profile.defense > 0.6) lines.push("Your guard is a cage. I will break it open.");
    if (profile.jumpFrequency > 8) lines.push("You fly too often. The ground is where you die.");
    if (profile.riskLevel > 0.4) lines.push("Reckless. Each mistake costs you blood.");
    if (profile.cornerPressure > 0.3) lines.push("You cower in the corner. Stay there.");
    if (profile.matchesWon > 0 && profile.matchesWon === profile.matchesPlayed)
      lines.push("Undefeated? Not after today.");
    if (lines.length === 0) lines.push("You should not have come here.");

    return {
      tone,
      preFight: lines[Math.floor(Math.random() * lines.length)],
    };
  }

  private generateEndingDialogue(profile: PlayerProfile): string {
    if (profile.matchesWon === profile.matchesPlayed) {
      return "You broke them all. The world is ash. You are free.";
    }
    return "You fought. You fell. You rose. The world burns regardless.";
  }
}
