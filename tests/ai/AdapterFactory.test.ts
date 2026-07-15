// ============================================================================
// ADAPTER FACTORY TESTS
// ============================================================================

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { selectAdapter } from "../../src/lib/game/ai/models/AdapterFactory";

describe("AdapterFactory", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "ETERNAL_MODEL_ENDPOINT",
    "ETERNAL_MODEL_PATH",
    "ETERNAL_REMOTE_API_URL",
    "ETERNAL_USE_OLLAMA",
    "ETERNAL_OLLAMA_URL",
  ];

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] !== undefined) {
        process.env[k] = savedEnv[k];
      } else {
        delete process.env[k];
      }
    }
  });

  it("returns mock by default when no env vars set", () => {
    const sel = selectAdapter();
    expect(sel.kind).toBe("mock");
  });

  it("returns fine_tuned when ETERNAL_MODEL_ENDPOINT is set", () => {
    process.env.ETERNAL_MODEL_ENDPOINT = "https://test.modal.run";
    const sel = selectAdapter();
    expect(sel.kind).toBe("fine_tuned");
    expect(sel.model.metadata().id).toContain("endpoint");
  });

  it("returns fine_tuned when ETERNAL_MODEL_PATH is set", () => {
    process.env.ETERNAL_MODEL_PATH = "/tmp/fake";
    const sel = selectAdapter();
    expect(sel.kind).toBe("fine_tuned");
    expect(sel.model.metadata().id).toContain("local");
  });

  it("returns remote_api when ETERNAL_REMOTE_API_URL is set", () => {
    process.env.ETERNAL_REMOTE_API_URL = "https://api.openai.com/v1";
    process.env.ETERNAL_REMOTE_API_KEY = "sk-test";
    const sel = selectAdapter();
    expect(sel.kind).toBe("remote_api");
  });

  it("returns ollama when ETERNAL_USE_OLLAMA=1", () => {
    process.env.ETERNAL_USE_OLLAMA = "1";
    const sel = selectAdapter();
    expect(sel.kind).toBe("ollama");
  });

  it("endpoint takes priority over local path", () => {
    process.env.ETERNAL_MODEL_ENDPOINT = "https://test.modal.run";
    process.env.ETERNAL_MODEL_PATH = "/tmp/fake";
    const sel = selectAdapter();
    expect(sel.kind).toBe("fine_tuned");
    expect(sel.model.metadata().id).toContain("endpoint");
  });

  it("passes through model version + family", () => {
    process.env.ETERNAL_MODEL_ENDPOINT = "https://test.modal.run";
    process.env.ETERNAL_MODEL_VERSION = "1.2.3";
    process.env.ETERNAL_MODEL_FAMILY = "qwen";
    const sel = selectAdapter();
    const meta = sel.model.metadata();
    expect(meta.version).toBe("1.2.3");
    expect(meta.label).toContain("qwen");
  });
});
