/**
 * The one place that talks to the Anthropic API. Everything else in the
 * engine goes through `callModel()` and `countTokens()`, so request shape,
 * retries, time limits and error wording live here.
 *
 * Nothing in this file writes to a log. The key is held by the SDK client
 * that the caller builds and is never read back.
 */
import Anthropic from "@anthropic-ai/sdk";
import { modelInfo, type TokenUsage } from "../core/pricing";
import { EngineError } from "./errors";
import { withRetry, type RetryOptions } from "./retry";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

interface MessageLike {
  content: unknown[];
  stop_reason?: string | null;
  model?: string;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null;
}

interface StreamLike {
  finalMessage(): Promise<MessageLike>;
}

/**
 * The part of the Anthropic SDK client the engine uses. `new Anthropic()`
 * satisfies it; tests pass a fake with the same three methods.
 */
export interface AnthropicLike {
  messages: {
    stream(params: Record<string, unknown>, options?: Record<string, unknown>): StreamLike;
    countTokens(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ input_tokens: number }>;
  };
  beta: {
    messages: {
      stream(params: Record<string, unknown>, options?: Record<string, unknown>): StreamLike;
    };
  };
}

/** Build the real client for a key. The engine does its own retries, so the SDK's are off. */
export function createAnthropicClient(apiKey: string, options: { timeoutMs?: number } = {}): AnthropicLike {
  return new Anthropic({ apiKey, maxRetries: 0, timeout: options.timeoutMs ?? 240_000 }) as unknown as AnthropicLike;
}

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | unknown[];
}

export interface ModelCall {
  model: string;
  system: string;
  messages: ModelMessage[];
  effort?: Effort;
  /** A JSON schema the answer must follow. */
  jsonSchema?: Record<string, unknown>;
}

export interface ModelAnswer {
  text: string;
  /** The answer's content blocks, passed back unchanged when the conversation continues. */
  content: unknown[];
  usage: Required<TokenUsage>;
  /** The model that answered. Differs from the one asked for only after a fallback. */
  servedBy: string;
}

export interface CallPolicy {
  retry?: Pick<RetryOptions, "maxRetries" | "baseDelayMs" | "maxDelayMs" | "sleep" | "random" | "onRetry">;
  /** Time limit for one request, in milliseconds. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The longest answer asked for. Streaming keeps a long answer inside the request time limit. */
const MAX_TOKENS = 64_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** What the API said about a rejected request. It describes the request's parameters, not its content. */
function apiMessage(error: unknown): string[] {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message !== "" ? [message.slice(0, 300)] : [];
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** True for the failures worth trying again: rate limits, overload, server errors and dropped connections. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIUserAbortError) return false;
  if (error instanceof Anthropic.RateLimitError) return true;
  if (error instanceof Anthropic.InternalServerError) return true;
  if (error instanceof Anthropic.APIConnectionError) return true;
  const status = statusOf(error);
  return status === 429 || (status !== undefined && status >= 500);
}

/** The wait Anthropic asked for in a `retry-after` header, in milliseconds. */
export function retryAfterMs(error: unknown): number | undefined {
  const headers = (error as { headers?: unknown } | null)?.headers;
  if (!headers || typeof (headers as Headers).get !== "function") return undefined;
  const value = (headers as Headers).get("retry-after");
  if (value === null || value === "") return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

/** Turn an SDK error into the engine's own, with words a person can act on. */
export function toEngineError(error: unknown, model: string): EngineError {
  if (error instanceof EngineError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new EngineError("timeout");
  if (error instanceof Anthropic.AuthenticationError) return new EngineError("key_rejected");
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new EngineError("key_rejected", {
      message: "Anthropic did not allow this API key to make the request. Check the key's permissions in the Anthropic Console.",
    });
  }
  if (error instanceof Anthropic.NotFoundError) return new EngineError("model_unavailable", { details: [model] });
  if (error instanceof Anthropic.RateLimitError) return new EngineError("rate_limited");
  if (error instanceof Anthropic.BadRequestError) return new EngineError("request_rejected", { details: [model, ...apiMessage(error)] });
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new EngineError("timeout");
  if (error instanceof Anthropic.APIConnectionError) return new EngineError("network");
  if (error instanceof Anthropic.InternalServerError) return new EngineError("service_unavailable");

  const status = statusOf(error);
  if (status === 401 || status === 403) return new EngineError("key_rejected");
  if (status === 402) return new EngineError("billing");
  if (status === 404) return new EngineError("model_unavailable", { details: [model] });
  if (status === 413) return new EngineError("document_too_large");
  if (status === 429) return new EngineError("rate_limited");
  if (status === 400 || status === 422) return new EngineError("request_rejected", { details: [model, ...apiMessage(error)] });
  if (status !== undefined && status >= 500) return new EngineError("service_unavailable");
  if ((error as { name?: unknown } | null)?.name === "AbortError") return new EngineError("timeout");
  return new EngineError("unexpected");
}

function buildParams(call: ModelCall): Record<string, unknown> {
  const info = modelInfo(call.model);
  const outputConfig: Record<string, unknown> = {};
  if (call.effort && info?.effort) outputConfig.effort = call.effort;
  if (call.jsonSchema) outputConfig.format = { type: "json_schema", schema: call.jsonSchema };

  return {
    model: call.model,
    max_tokens: Math.min(MAX_TOKENS, info?.maxOutputTokens ?? MAX_TOKENS),
    // The system prompt is the same for every request of a run, so it is
    // cached; a prompt below the model's minimum simply is not.
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: call.messages,
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
  };
}

function readAnswer(message: MessageLike, call: ModelCall): ModelAnswer {
  // A declined request is a normal response with its own stop reason, so it
  // is checked before the content is read.
  if (message.stop_reason === "refusal") throw new EngineError("declined");
  if (message.stop_reason === "max_tokens") throw new EngineError("document_too_large");

  const content = Array.isArray(message.content) ? message.content : [];
  const text = content
    .map((block) => {
      const b = block as { type?: unknown; text?: unknown };
      return b?.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .join("");

  return {
    text,
    content,
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage?.cache_creation_input_tokens ?? 0,
    },
    servedBy: typeof message.model === "string" && message.model !== "" ? message.model : call.model,
  };
}

/**
 * One request to a model, streamed, with retries. Where the model supports
 * it, a request Anthropic's safety systems decline is re-run on Anthropic's
 * recommended substitute inside the same call; `servedBy` says which model
 * answered.
 */
export async function callModel(client: AnthropicLike, call: ModelCall, policy: CallPolicy = {}): Promise<ModelAnswer> {
  const params = buildParams(call);
  const requestOptions: Record<string, unknown> = {};
  if (policy.signal) requestOptions.signal = policy.signal;
  if (policy.timeoutMs) requestOptions.timeout = policy.timeoutMs;

  const send = (withFallback: boolean): Promise<MessageLike> =>
    withFallback
      ? client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" }, requestOptions).finalMessage()
      : client.messages.stream(params, requestOptions).finalMessage();

  const useFallback = modelInfo(call.model)?.fallbacks === true;

  try {
    const message = await withRetry(
      async () => {
        if (!useFallback) return send(false);
        try {
          return await send(true);
        } catch (error) {
          // An account without the fallback feature rejects the request
          // outright. The same request without it is still a valid one.
          if (error instanceof Anthropic.BadRequestError || statusOf(error) === 400) return send(false);
          throw error;
        }
      },
      { ...policy.retry, isRetryable, retryAfterMs, signal: policy.signal },
    );
    return readAnswer(message, call);
  } catch (error) {
    throw toEngineError(error, call.model);
  }
}

/** The number of input tokens a request would use, from Anthropic's token counting endpoint. */
export async function countTokens(
  client: AnthropicLike,
  call: Pick<ModelCall, "model" | "system" | "messages">,
  policy: CallPolicy = {},
): Promise<number> {
  try {
    const result = await withRetry(
      () =>
        client.messages.countTokens(
          { model: call.model, system: call.system, messages: call.messages },
          policy.signal ? { signal: policy.signal } : undefined,
        ),
      { ...policy.retry, isRetryable, retryAfterMs, signal: policy.signal },
    );
    return result.input_tokens;
  } catch (error) {
    throw toEngineError(error, call.model);
  }
}

/** Parse the first JSON object in a model's answer, tolerating a code fence around it. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
