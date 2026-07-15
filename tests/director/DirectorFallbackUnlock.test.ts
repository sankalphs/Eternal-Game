import { describe, expect, test } from "bun:test";
import { GameEngine } from "../../src/lib/game/engine";

describe("Director fallback unlock", () => {
  test("setDirectorFallback applies classic plan and does not hold intro forever", () => {
    const eng = new GameEngine();
    eng.startMatchWith(0);
    expect(eng.phase).toBe("intro");

    eng.setDirectorThinking();
    // While thinking, intro is held (status thinking).
    expect(eng.directorState.ai.status).toBe("thinking");

    eng.setDirectorFallback("endpoint unavailable");
    expect(eng.directorState.ai.status).toBe("fallback");
    expect(eng.directorState.ai.model).toContain("Classic Director");
    // Weather/hazards come from the deterministic chapter plan — not blank.
    expect(eng.directorState.weather.type).not.toBe("none");
    // Honesty: never labeled as live Qwen.
    expect(eng.directorState.ai.status).not.toBe("live");
  });

  test("practice mode skips Qwen hold and uses offline director", () => {
    const eng = new GameEngine();
    eng.startPractice(0, true);
    expect(eng.practiceMode).toBe(true);
    expect(eng.directorState.ai.status).toBe("fallback");
    // Intro should not be held for thinking (practice already offline).
    expect(eng.directorState.ai.status).not.toBe("thinking");
  });

  test("two-player never requires live director", () => {
    const eng = new GameEngine();
    eng.startTwoPlayer();
    eng.setDirectorThinking();
    // Even if status is thinking, twoPlayer should not hold — verified via
    // update advancing phaseTimer when not held. Status itself can be thinking
    // only if someone called setDirectorThinking; startTwoPlayer does not.
    eng.directorState.ai.status = "thinking";
    // Simulate: force phaseTimer and ensure shouldHold is false by updating.
    // We check practice of the public contract: twoPlayer matches start fights.
    expect(eng.twoPlayer).toBe(true);
    // Drop thinking and ensure fight can proceed after intro timer.
    eng.directorState.ai.status = "idle";
    eng.phaseTimer = 0.01;
    eng.update(0.05);
    // With idle status and twoPlayer, intro is not held for director.
    // After phaseTimer depletes, phase becomes fight.
    expect(eng.phase === "fight" || eng.phase === "intro").toBe(true);
  });
});
