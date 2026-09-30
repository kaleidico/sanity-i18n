/**
 * The Claude models the engine can use and what they cost. One dated table,
 * shared by the Site Settings lists, the cost estimate and the report.
 *
 * TO UPDATE: change the rows and `RATES_AS_OF` together. Rates are US dollars
 * per million tokens, from Anthropic's published API pricing. Usage is billed
 * by Anthropic to the account that owns the site's key; these numbers only
 * drive the estimate and the cost recorded on each run.
 */

/** The date the rates below were taken from Anthropic's published pricing. */
export const RATES_AS_OF = "2026-09-25";

export interface ModelInfo {
  id: string;
  title: string;
  /** US dollars per million input tokens. */
  inputPerMTok: number;
  /** US dollars per million output tokens (the model's reasoning is billed as output). */
  outputPerMTok: number;
  /** US dollars per million input tokens read from the prompt cache. */
  cacheReadPerMTok: number;
  /** US dollars per million input tokens written to the prompt cache (1.25 times the input rate). */
  cacheWritePerMTok: number;
  /** Largest request the model accepts, in tokens. */
  contextWindow: number;
  /** Largest answer the model can give, in tokens. */
  maxOutputTokens: number;
  /** True when the model takes `output_config.effort`. */
  effort: boolean;
  /** True when a declined request can be re-run on Anthropic's recommended substitute model. */
  fallbacks: boolean;
  note: string;
}

export const MODELS: readonly ModelInfo[] = [
  {
    id: "claude-opus-5-5",
    title: "Claude Opus 5.5",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 5,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    effort: true,
    fallbacks: true,
    note: "Recommended.",
  },
  {
    id: "claude-sonnet-5-5",
    title: "Claude Sonnet 5.5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    effort: true,
    fallbacks: true,
    note: "Half the cost of Opus.",
  },
  {
    id: "claude-fable-5-1",
    title: "Claude Fable 5.1",
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadPerMTok: 0.25,
    cacheWritePerMTok: 12.5,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    effort: true,
    fallbacks: true,
    note: "Most capable and most expensive. The Anthropic account must keep data for 30 days to use it.",
  },
  {
    id: "claude-haiku-4-5",
    title: "Claude Haiku 4.5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    effort: false,
    fallbacks: false,
    note: "Cheapest and fastest. Not advised for legal text.",
  },
];

export const DEFAULT_TRANSLATOR_MODEL = "claude-opus-5-5";
export const DEFAULT_REVIEWER_MODEL = "claude-opus-5-5";

export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** US dollars for a number of tokens on a model, to six decimal places. Unknown models cost 0 and should be reported as unpriced. */
export function costOf(usage: TokenUsage, modelId: string): number {
  const model = modelInfo(modelId);
  if (!model) return 0;
  const dollars =
    (usage.inputTokens * model.inputPerMTok +
      usage.outputTokens * model.outputPerMTok +
      (usage.cacheReadTokens ?? 0) * model.cacheReadPerMTok +
      (usage.cacheWriteTokens ?? 0) * model.cacheWritePerMTok) /
    1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

// ── Estimate assumptions ────────────────────────────────────────────────

/**
 * Characters per token when the token counting endpoint cannot be used (no
 * key saved yet). Payloads are JSON with short keys, so they tokenise worse
 * than plain prose; 3 is deliberately on the cautious side.
 */
export const CHARS_PER_TOKEN = 3;

/**
 * Output tokens for a translation, as a multiple of the payload's input
 * tokens: the same JSON comes back, Spanish runs longer than English, and
 * the model's reasoning is billed as output.
 */
export const TRANSLATION_OUTPUT_FACTOR = 1.6;

/** The reviewer reads the source and the translation side by side. */
export const REVIEW_INPUT_FACTOR = 2.3;

/** Output tokens allowed for one reviewer answer, reasoning included. */
export const REVIEW_OUTPUT_TOKENS = 1_500;
