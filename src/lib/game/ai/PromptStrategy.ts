// ============================================================================
// PHASE 3: PROMPT STRATEGY
//
// Prompt Builder produces prompts according to the active strategy.
// Each strategy controls context length, few-shot count, verbosity, and
// reasoning budget. The model adapter selects the strategy automatically.
// ============================================================================

import type { AIContext, PromptSet, RetrievedMemory } from "./types";
import { PromptBuilder, DEFAULT_TEMPLATE, type PromptTemplate } from "./PromptBuilder";

export interface PromptStrategy {
  id: string;
  contextMaxLength: number;
  fewShotCount: number;
  verbosity: "minimal" | "normal" | "verbose";
  reasoningBudget: number;
  buildPrompt(context: AIContext, memories: RetrievedMemory[]): PromptSet;
}

// ---- Base: reuses the existing PromptBuilder ----

abstract class BaseStrategy implements PromptStrategy {
  abstract id: string;
  abstract contextMaxLength: number;
  abstract fewShotCount: number;
  abstract verbosity: "minimal" | "normal" | "verbose";
  abstract reasoningBudget: number;

  protected builder: PromptBuilder;

  constructor(template?: PromptTemplate) {
    this.builder = new PromptBuilder(template);
  }

  buildPrompt(context: AIContext, memories: RetrievedMemory[]): PromptSet {
    // Inject memories into the context
    const memoryContext = memories.length > 0
      ? { ...context, objective: context.objective + "\n\nRelevant memories:\n" + memories.map(m => `- ${m.record.source}: ${m.record.content}`).join("\n") }
      : context;

    // Trim few-shot examples based on strategy
    const prompt = this.builder.build(memoryContext);
    prompt.fewShot = prompt.fewShot.slice(0, this.fewShotCount);

    // Adjust verbosity
    if (this.verbosity === "minimal") {
      prompt.system = prompt.system.split("\n").slice(0, 3).join("\n");
      prompt.developer = prompt.developer.split("\n").slice(0, 5).join("\n");
    } else if (this.verbosity === "verbose") {
      prompt.system = prompt.system + "\n\nThink step by step about the player's psychology before choosing the configuration.";
    }

    return prompt;
  }
}

// ---- Concrete strategies ----

export class TinyModelStrategy extends BaseStrategy {
  id = "tiny";
  contextMaxLength = 512;
  fewShotCount = 1;
  verbosity = "minimal" as const;
  reasoningBudget = 256;
}

export class MediumModelStrategy extends BaseStrategy {
  id = "medium";
  contextMaxLength = 2048;
  fewShotCount = 2;
  verbosity = "normal" as const;
  reasoningBudget = 512;
}

export class LargeModelStrategy extends BaseStrategy {
  id = "large";
  contextMaxLength = 8192;
  fewShotCount = 3;
  verbosity = "verbose" as const;
  reasoningBudget = 2048;
}

export class FastInferenceStrategy extends BaseStrategy {
  id = "fast";
  contextMaxLength = 1024;
  fewShotCount = 0;
  verbosity = "minimal" as const;
  reasoningBudget = 128;
}

export class CompressedStrategy extends BaseStrategy {
  id = "compressed";
  contextMaxLength = 256;
  fewShotCount = 0;
  verbosity = "minimal" as const;
  reasoningBudget = 128;

  buildPrompt(context: AIContext, memories: RetrievedMemory[]): PromptSet {
    // Ultra-compressed: only the most essential fields
    const compact = {
      a: context.features.aggression,
      p: context.features.patience,
      s: context.features.skill,
      e: context.campaign.currentEmotion,
      c: context.worldState.corruption,
      ks: context.prediction.kickSpam,
      bt: context.prediction.blockTurtle,
    };
    return {
      system: "Output JSON fight config for this player.",
      developer: DEFAULT_TEMPLATE.developer,
      user: JSON.stringify(compact),
      outputSchema: DEFAULT_TEMPLATE.outputSchema,
      fewShot: [],
    };
  }
}

// ---- Strategy selector: maps model metadata to the best strategy ----

export function selectStrategy(modelType: string, contextWindow: number): PromptStrategy {
  if (modelType === "mock") return new FastInferenceStrategy();
  if (contextWindow <= 512) return new TinyModelStrategy();
  if (contextWindow <= 2048) return new CompressedStrategy();
  if (contextWindow <= 4096) return new MediumModelStrategy();
  return new LargeModelStrategy();
}
