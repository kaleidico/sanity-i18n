import { X as TokenUsage, r as JobKind, F as FieldManifest, s as JobStatus } from './pricing-D6d8ocw8.js';
import { b as LanguagesInput } from './languages-BzBBGlPy.js';

/**
 * Every way a run can fail, with the words a person sees. The message is
 * written for an editor in the Studio, not for a log: what happened and what
 * to do next. Messages never contain the API key or document content.
 */
type EngineErrorCode = "bad_request" | "job_not_found" | "job_not_pending" | "source_missing" | "source_not_default_language" | "language_unknown" | "language_not_enabled" | "type_not_translatable" | "manifest_missing" | "key_storage_not_configured" | "missing_key" | "key_unreadable" | "key_rejected" | "billing" | "rate_limited" | "service_unavailable" | "network" | "timeout" | "model_unavailable" | "request_rejected" | "document_too_large" | "structure_mismatch" | "check_failed" | "declined" | "dataset" | "wrong_route" | "unit_not_found" | "unit_not_pending" | "comment_required" | "not_an_approver" | "approver_unverified" | "unexpected";
declare const KEY_STORAGE_NOT_CONFIGURED = "Translation key storage is not configured on this server yet.";
declare class EngineError extends Error {
    readonly code: EngineErrorCode;
    /** Extra detail that is safe to show: a list of paths, a model id. Never a key or document content. */
    readonly details: string[];
    constructor(code: EngineErrorCode, options?: {
        message?: string;
        details?: string[];
    });
}
declare function plainMessage(code: EngineErrorCode): string;
/** Any thrown value as an EngineError, so every failure reaches the job in plain words. */
declare function asEngineError(error: unknown): EngineError;

/**
 * Retries with exponential backoff, and a small concurrency limiter. Both are
 * plain functions with the clock passed in, so tests run without waiting.
 */
interface RetryOptions {
    /** How many times to try again after the first failure. Defaults to 3. */
    maxRetries?: number;
    /** First wait in milliseconds; doubles each time. Defaults to 1000. */
    baseDelayMs?: number;
    /** The longest single wait. Defaults to 30000. */
    maxDelayMs?: number;
    /** True for an error worth trying again. */
    isRetryable: (error: unknown) => boolean;
    /** A wait the server asked for (a `retry-after` header), in milliseconds. */
    retryAfterMs?: (error: unknown) => number | undefined;
    sleep?: (ms: number) => Promise<void>;
    /** Between 0 and 1; spreads the waits so parallel requests do not retry together. */
    random?: () => number;
    signal?: AbortSignal;
    onRetry?: (info: {
        attempt: number;
        delayMs: number;
    }) => void;
}
declare function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random: number): number;
declare function withRetry<T>(run: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T>;
/** Run at most `concurrency` tasks at once. */
declare function createLimiter(concurrency: number): <T>(task: () => Promise<T>) => Promise<T>;

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
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
interface AnthropicLike {
    messages: {
        stream(params: Record<string, unknown>, options?: Record<string, unknown>): StreamLike;
        countTokens(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{
            input_tokens: number;
        }>;
    };
    beta: {
        messages: {
            stream(params: Record<string, unknown>, options?: Record<string, unknown>): StreamLike;
        };
    };
}
/** Build the real client for a key. The engine does its own retries, so the SDK's are off. */
declare function createAnthropicClient(apiKey: string, options?: {
    timeoutMs?: number;
}): AnthropicLike;
interface ModelMessage {
    role: "user" | "assistant";
    content: string | unknown[];
}
interface ModelCall {
    model: string;
    system: string;
    messages: ModelMessage[];
    effort?: Effort;
    /** A JSON schema the answer must follow. */
    jsonSchema?: Record<string, unknown>;
}
interface ModelAnswer {
    text: string;
    /** The answer's content blocks, passed back unchanged when the conversation continues. */
    content: unknown[];
    usage: Required<TokenUsage>;
    /** The model that answered. Differs from the one asked for only after a fallback. */
    servedBy: string;
}
interface CallPolicy {
    retry?: Pick<RetryOptions, "maxRetries" | "baseDelayMs" | "maxDelayMs" | "sleep" | "random" | "onRetry">;
    /** Time limit for one request, in milliseconds. */
    timeoutMs?: number;
    signal?: AbortSignal;
}
/** True for the failures worth trying again: rate limits, overload, server errors and dropped connections. */
declare function isRetryable(error: unknown): boolean;
/** The wait Anthropic asked for in a `retry-after` header, in milliseconds. */
declare function retryAfterMs(error: unknown): number | undefined;
/** Turn an SDK error into the engine's own, with words a person can act on. */
declare function toEngineError(error: unknown, model: string): EngineError;
/**
 * One request to a model, streamed, with retries. Where the model supports
 * it, a request Anthropic's safety systems decline is re-run on Anthropic's
 * recommended substitute inside the same call; `servedBy` says which model
 * answered.
 */
declare function callModel(client: AnthropicLike, call: ModelCall, policy?: CallPolicy): Promise<ModelAnswer>;
/** The number of input tokens a request would use, from Anthropic's token counting endpoint. */
declare function countTokens(client: AnthropicLike, call: Pick<ModelCall, "model" | "system" | "messages">, policy?: CallPolicy): Promise<number>;
/** Parse the first JSON object in a model's answer, tolerating a code fence around it. */
declare function parseJsonObject(text: string): Record<string, unknown> | null;

type Json = Record<string, unknown>;
interface SanityLike {
    fetch<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T>;
    getDocument(id: string): Promise<Json | null>;
    getDocuments(ids: readonly string[]): Promise<Json[]>;
    mutate(mutations: readonly Json[]): Promise<void>;
    /**
     * The Sanity user id that created a document, from its transaction history.
     * Null when the history has no author. Optional: a client without it cannot
     * verify who created a job, and the approval route then refuses.
     */
    documentAuthor?(id: string): Promise<string | null>;
}
interface SanityHttpConfig {
    projectId: string;
    dataset: string;
    /** A token that can read and write the dataset. Server only. */
    token: string;
    apiVersion?: string;
    fetch?: typeof globalThis.fetch;
}
declare function createSanityHttp(config: SanityHttpConfig): SanityLike;

/**
 * Running a job. A job is a private document the Studio creates with the
 * editor's own session; the server does work only for a job it can load with
 * its token and that is still pending. So the right to start a translation
 * is exactly the right to write to the dataset, and a caller without it has
 * nothing to send.
 */

interface EngineConfig {
    /** How to reach the dataset: project, dataset and a read and write token. */
    sanity: SanityHttpConfig | SanityLike;
    /** The languages the site can offer, the same list the Studio plugin gets. */
    languages: LanguagesInput;
    /** The private key (PKCS8, base64). Defaults to the `I18N_PRIVATE_KEY` environment variable. */
    privateKey?: string;
    /** The public key (SPKI, base64). Defaults to `NEXT_PUBLIC_I18N_PUBLIC_KEY`. Only used to explain a key pair mismatch. */
    publicKey?: string;
    /** Where the glossary, style guide, engine settings and approver list live. Defaults to the `settings` type and the package's field names. */
    settings?: {
        type?: string;
        glossaryField?: string;
        styleGuideField?: string;
        engineField?: string;
        languagesField?: string;
        legalApproversField?: string;
    };
    /**
     * Publish a translation as soon as it is approved. Defaults to the
     * "Publish marketing pages automatically" switch in Site Settings (on
     * unless switched off). Pass false to keep every translation a draft.
     */
    autoPublish?: boolean;
    /**
     * Check that an approval job was created by the Studio user it names, from
     * the document's transaction history. Defaults to true. Only for tests.
     */
    verifyJobAuthor?: boolean;
    /** The field manifest. Defaults to the one the Studio keeps in the private `i18n.manifest` document. */
    manifest?: FieldManifest;
    /** Build the Anthropic client for a key. Defaults to the real SDK client; tests pass a fake. */
    anthropic?: (apiKey: string) => AnthropicLike;
    /** Refuse a language that is switched off in Site Settings. Defaults to true. */
    requireEnabledLanguage?: boolean;
    effort?: {
        translator?: Effort;
        reviewer?: Effort;
    };
    /** Characters of payload per request before a document is split. */
    maxCharsPerRequest?: number;
    /** Requests to Anthropic at once within a run. Defaults to 2. */
    concurrency?: number;
    /** Time limit for one request to Anthropic, in milliseconds. Defaults to 180000. */
    requestTimeoutMs?: number;
    /** Time limit for a whole job, kept below the host's own limit so the job is always closed. Defaults to 270000. */
    deadlineMs?: number;
    retry?: CallPolicy["retry"];
    now?: () => Date;
}
interface JobOutcome {
    /** The HTTP status the route answers with. */
    httpStatus: number;
    ok: boolean;
    status?: JobStatus;
    error?: {
        code: string;
        message: string;
    };
}
declare function resolveSanity(config: EngineConfig): SanityLike;
/**
 * Run one job by id. Refuses anything that is not a pending job. Every
 * failure after the job is claimed is written to the job in plain words, so
 * the person waiting in the Studio always gets an answer.
 */
declare const TRANSLATE_JOB_KINDS: readonly JobKind[];
declare const APPROVAL_JOB_KINDS: readonly JobKind[];
declare function runJob(config: EngineConfig, id: string, allowedKinds?: readonly JobKind[]): Promise<JobOutcome>;

export { type AnthropicLike as A, type CallPolicy as C, type Effort as E, type JobOutcome as J, KEY_STORAGE_NOT_CONFIGURED as K, type ModelAnswer as M, type RetryOptions as R, type SanityLike as S, TRANSLATE_JOB_KINDS as T, APPROVAL_JOB_KINDS as a, type EngineConfig as b, EngineError as c, type EngineErrorCode as d, type ModelCall as e, type ModelMessage as f, type SanityHttpConfig as g, asEngineError as h, backoffDelay as i, callModel as j, countTokens as k, createAnthropicClient as l, createLimiter as m, createSanityHttp as n, isRetryable as o, parseJsonObject as p, plainMessage as q, resolveSanity as r, retryAfterMs as s, runJob as t, toEngineError as u, withRetry as w };
