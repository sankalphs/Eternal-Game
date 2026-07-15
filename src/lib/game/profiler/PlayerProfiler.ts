// ============================================================================
// Player Profiler — collects gameplay telemetry during every match.
// Produces a PlayerProfile that the AI Director uses to plan the next fight.
// ============================================================================

import type { Fighter } from "../fighter";

export interface PlayerProfile {
  // Spacing
  averageDistance: number;     // px, average distance from opponent
  preferredSpacing: "close" | "mid" | "far";

  // Offense
  aggression: number;          // 0..1, how often the player attacks
  favouriteAttacks: Record<string, number>; // attack type → count
  averageComboLength: number;
  superTiming: number;         // avg HP% when super is used

  // Defense
  defense: number;             // 0..1, how often the player blocks
  rollFrequency: number;       // rolls per minute
  jumpFrequency: number;       // jumps per minute

  // Tempo
  reactionSpeed: number;       // ms, avg time to react to opponent attack
  winSpeed: number;            // seconds to win a round (avg)
  riskLevel: number;           // 0..1, how many unsafe attacks

  // Pressure
  cornerPressure: number;      // 0..1, how often player is cornered
  blockStringCount: number;    // consecutive blocks

  // Match history
  matchesPlayed: number;
  matchesWon: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
}

export function emptyProfile(): PlayerProfile {
  return {
    averageDistance: 0,
    preferredSpacing: "mid",
    aggression: 0,
    favouriteAttacks: {},
    averageComboLength: 0,
    superTiming: 0,
    defense: 0,
    rollFrequency: 0,
    jumpFrequency: 0,
    reactionSpeed: 0,
    winSpeed: 0,
    riskLevel: 0,
    cornerPressure: 0,
    blockStringCount: 0,
    matchesPlayed: 0,
    matchesWon: 0,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
  };
}

// ============================================================================
// Telemetry collector — attaches to the engine and records per-frame data.
// The engine calls collector.tick() each frame and collector.onHit() on hits.
// ============================================================================

export class TelemetryCollector {
  private profile: PlayerProfile;
  private distanceSum = 0;
  private distanceSamples = 0;
  private attackCount = 0;
  private blockCount = 0;
  private rollCount = 0;
  private jumpCount = 0;
  private comboLengths: number[] = [];
  private currentCombo = 0;
  private matchStartTime = 0;
  private matchDuration = 0;
  private cornerTime = 0;
  private totalTime = 0;
  private unsafeAttacks = 0;
  private damageDealt = 0;
  private damageTaken = 0;
  private superHpWhenUsed: number[] = [];
  private reactionTimes: number[] = [];
  private lastOpponentAttackTime = 0;
  private blockStringMax = 0;
  private blockStringCurrent = 0;

  constructor(base?: PlayerProfile) {
    this.profile = base ?? emptyProfile();
  }

  // Called every frame by the engine
  tick(dt: number, player: Fighter, enemy: Fighter) {
    const dist = Math.abs(player.x - enemy.x);
    this.distanceSum += dist;
    this.distanceSamples++;
    this.totalTime += dt;

    // Corner detection
    if (player.x <= 100 || player.x >= 860) {
      this.cornerTime += dt;
    }
  }

  // Called when the player attacks
  onPlayerAttack(attackType: string, isUnsafe: boolean) {
    this.attackCount++;
    this.profile.favouriteAttacks[attackType] =
      (this.profile.favouriteAttacks[attackType] ?? 0) + 1;
    if (isUnsafe) this.unsafeAttacks++;
    this.currentCombo++;
  }

  // Called when the player takes a hit (combo broken)
  onPlayerHit() {
    if (this.currentCombo > 0) {
      this.comboLengths.push(this.currentCombo);
    }
    this.currentCombo = 0;
    this.blockStringCurrent = 0;
  }

  // Called when the player blocks
  onPlayerBlock() {
    this.blockCount++;
    this.blockStringCurrent++;
    this.blockStringMax = Math.max(this.blockStringMax, this.blockStringCurrent);
  }

  // Called when the player rolls
  onPlayerRoll() {
    this.rollCount++;
  }

  // Called when the player jumps
  onPlayerJump() {
    this.jumpCount++;
  }

  // Called when the player uses super
  onPlayerSuper(hpFraction: number) {
    this.superHpWhenUsed.push(hpFraction);
  }

  // Called when the opponent starts an attack (for reaction timing)
  onOpponentAttack() {
    this.lastOpponentAttackTime = this.totalTime;
  }

  // Called when the player responds (blocks/dodges/attacks) after opponent attack
  onPlayerResponse() {
    if (this.lastOpponentAttackTime > 0) {
      const reaction = (this.totalTime - this.lastOpponentAttackTime) * 1000;
      this.reactionTimes.push(reaction);
      this.lastOpponentAttackTime = 0;
    }
  }

  // Called when the player deals damage
  onDamageDealt(dmg: number) {
    this.damageDealt += dmg;
  }

  // Called when the player takes damage
  onDamageTaken(dmg: number) {
    this.damageTaken += dmg;
  }

  // Called when a match starts
  onMatchStart() {
    this.matchStartTime = this.totalTime;
    this.currentCombo = 0;
  }

  // Called when a match ends (win or loss)
  onMatchEnd(won: boolean) {
    this.matchDuration = this.totalTime - this.matchStartTime;
    if (this.currentCombo > 0) this.comboLengths.push(this.currentCombo);
    this.profile.matchesPlayed++;
    if (won) this.profile.matchesWon++;
    this.profile.totalDamageDealt += this.damageDealt;
    this.profile.totalDamageTaken += this.damageTaken;
  }

  // Produce the final PlayerProfile
  getProfile(): PlayerProfile {
    const avgDist = this.distanceSamples > 0 ? this.distanceSum / this.distanceSamples : 400;
    const minutes = this.totalTime / 60;
    const avgCombo = this.comboLengths.length > 0
      ? this.comboLengths.reduce((a, b) => a + b, 0) / this.comboLengths.length
      : 0;
    const avgReaction = this.reactionTimes.length > 0
      ? this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length
      : 500;
    const avgSuperHp = this.superHpWhenUsed.length > 0
      ? this.superHpWhenUsed.reduce((a, b) => a + b, 0) / this.superHpWhenUsed.length
      : 0;

    return {
      ...this.profile,
      averageDistance: avgDist,
      preferredSpacing: avgDist < 80 ? "close" : avgDist > 200 ? "far" : "mid",
      aggression: this.attackCount / Math.max(1, this.totalTime / 2),
      averageComboLength: avgCombo,
      superTiming: avgSuperHp,
      defense: this.blockCount / Math.max(1, this.blockCount + this.attackCount),
      rollFrequency: minutes > 0 ? this.rollCount / minutes : 0,
      jumpFrequency: minutes > 0 ? this.jumpCount / minutes : 0,
      reactionSpeed: avgReaction,
      winSpeed: this.matchDuration,
      riskLevel: this.attackCount > 0 ? this.unsafeAttacks / this.attackCount : 0,
      cornerPressure: this.totalTime > 0 ? this.cornerTime / this.totalTime : 0,
      blockStringCount: this.blockStringMax,
    };
  }

  // Reset for a new match (keep accumulated profile)
  resetMatch() {
    this.distanceSum = 0;
    this.distanceSamples = 0;
    this.attackCount = 0;
    this.blockCount = 0;
    this.rollCount = 0;
    this.jumpCount = 0;
    this.comboLengths = [];
    this.currentCombo = 0;
    this.cornerTime = 0;
    this.unsafeAttacks = 0;
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.blockStringMax = 0;
    this.blockStringCurrent = 0;
  }
}
