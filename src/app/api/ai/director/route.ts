import { NextRequest, NextResponse } from "next/server";
import { validateIntentOutput } from "@/lib/game/intent/IntentOutputValidator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const endpoint = process.env.ETERNAL_MODEL_ENDPOINT;
  if (!endpoint) return NextResponse.json({ error: "ETERNAL_MODEL_ENDPOINT is not configured" }, { status: 503 });
  const context = await request.json();
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ETERNAL_MODEL_API_KEY ? { Authorization: `Bearer ${process.env.ETERNAL_MODEL_API_KEY}` } : {}),
      },
      body: JSON.stringify({ context, max_new_tokens: 384, temperature: 0.35, top_p: 0.95, top_k: 40 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Modal endpoint returned ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const parsed = data.intent ?? JSON.parse(data.raw ?? data.text ?? "{}");
    const validation = validateIntentOutput(parsed);
    if (validation.errors.length) throw new Error(`Invalid model output: ${validation.errors.join(", ")}`);
    return NextResponse.json({ intent: validation.output, model: "Qwen 2.5 1.5B · fine-tuned · Modal", latencyMs: Date.now() - startedAt, requestId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
