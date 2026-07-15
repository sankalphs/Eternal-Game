import fs from "fs";
import path from "path";
import type { BestGenomeArtifact, OfflineEvolutionCheckpoint } from "./types";

export class OfflineCheckpointStore {
  constructor(private directory: string) {}

  saveGeneration(checkpoint: OfflineEvolutionCheckpoint): string {
    fs.mkdirSync(this.directory, { recursive: true });
    const filePath = path.join(this.directory, `generation_${checkpoint.generation.toString().padStart(4, "0")}.json`);
    const payload = JSON.stringify(checkpoint, null, 2);
    writeJsonWithRetry(filePath, payload);
    writeJsonWithRetry(path.join(this.directory, "latest.json"), payload);
    return filePath;
  }

  loadLatest(): OfflineEvolutionCheckpoint | null {
    const filePath = path.join(this.directory, "latest.json");
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as OfflineEvolutionCheckpoint;
  }

  saveBestGenome(filePath: string, artifact: BestGenomeArtifact): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2), "utf-8");
  }
}

function writeJsonWithRetry(filePath: string, payload: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const tmpPath = `${filePath}.${process.pid}.${attempt}.tmp`;
    try {
      fs.writeFileSync(tmpPath, payload, "utf-8");
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      try {
        if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
      } catch {
        // Ignore cleanup failures; the next retry uses a different temp file.
      }
      sleepSync(50 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleepSync(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Short bounded spin to avoid making the checkpoint API async.
  }
}
