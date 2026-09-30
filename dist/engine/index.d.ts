import { L as Language } from '../languages-BzBBGlPy.js';
export { a as LanguagesConfig, b as LanguagesInput, d as defineLanguages } from '../languages-BzBBGlPy.js';
import { F as FieldManifest, G as Glossary, S as StyleGuide, E as EngineSettings, J as JobMode, T as TranslationReport, a as SourceDiff, C as CostEstimate, b as TranslationUnit, U as UnitValue, c as CallUsage, d as UnitPair, R as ReviewIssue } from '../pricing-h5vz3u-Z.js';
export { A as API_KEY_FIELD, e as CHARS_PER_TOKEN, f as CheckCategory, g as CheckFinding, h as CheckToken, D as DEFAULT_REVIEWER_MODEL, i as DEFAULT_TRANSLATOR_MODEL, j as ENGINE_FIELD, k as ExactMatchResult, l as GLOSSARY_FIELD, m as GlossaryTerm, n as JOB_ID_PREFIX, o as JOB_TYPE, p as JobKind, q as JobStatus, M as MANIFEST_ID, r as MANIFEST_TYPE, s as MODELS, t as ManifestDocumentType, u as ManifestNode, v as ModelInfo, N as NON_TEXT_FIELD_NAME, P as PathSegment, w as RATES_AS_OF, x as REVIEW_INPUT_FACTOR, y as REVIEW_OUTPUT_TOKENS, z as SECRETS_ID, B as SECRETS_TYPE, H as STRUCTURE_HASH_PATH, I as STYLE_GUIDE_FIELD, K as SourceHashEntry, L as StoredSecret, O as TRANSLATION_OUTPUT_FACTOR, Q as TokenUsage, V as TranslationJob, W as applyUnits, X as blockText, Y as buildFieldManifest, Z as buildPayload, _ as checkExactMatch, $ as comparePair, a0 as costOf, a1 as diffSource, a2 as encryptSecret, a3 as extractTokens, a4 as extractUnits, a5 as getAtPath, a6 as isTranslatableValue, a7 as jobId, a8 as modelInfo, a9 as parsePath, aa as pathToString, ab as pruneBlock, ac as publicKeyFingerprint, ad as readEngineSettings, ae as readGlossary, af as readNumber, ag as readStyleGuide, ah as readUnit, ai as resolveManifestNode, aj as setAtPath, ak as sourceFingerprint, al as sourceHashes, am as structureHash, an as toSlug, ao as translationId, ap as unitCharacters, aq as unitPairs, ar as unitStrings, as as validateStructure } from '../pricing-h5vz3u-Z.js';
import { A as AnthropicLike, E as Effort, C as CallPolicy, S as SanityLike } from '../job-rnQIOkKV.js';
export { a as EngineConfig, b as EngineError, c as EngineErrorCode, J as JobOutcome, K as KEY_STORAGE_NOT_CONFIGURED, M as ModelAnswer, d as ModelCall, e as ModelMessage, R as RetryOptions, f as SanityHttpConfig, g as asEngineError, h as backoffDelay, i as callModel, j as countTokens, k as createAnthropicClient, l as createLimiter, m as createSanityHttp, n as isRetryable, p as parseJsonObject, o as plainMessage, r as resolveSanity, q as retryAfterMs, s as runJob, t as toEngineError, w as withRetry } from '../job-rnQIOkKV.js';
export { T as TRANSLATION_META_TYPE, t as translationMetaId } from '../translations-CSuDvi7D.js';

type Json$2 = Record<string, unknown>;
interface TranslateDocumentInput {
    /** The published source document, in the default language. */
    document: Json$2;
    /** The language to translate into. */
    language: Language;
    /** The default language the document is written in. */
    sourceLanguage: Language;
    manifest: FieldManifest;
    glossary: Glossary;
    styleGuide: StyleGuide;
    models: Pick<EngineSettings, "translatorModel" | "reviewerModel">;
    /**
     * The Anthropic client, built lazily so a run that has nothing to send to
     * the model (the English changed only in its images, say) needs no key.
     */
    client: () => AnthropicLike | Promise<AnthropicLike>;
    /** `changes` re-translates only what changed since the existing translation was made. Defaults to `full`. */
    mode?: JobMode;
    /** The current translation (its draft if there is one, else the published one). */
    existingTranslation?: Json$2 | null;
    effort?: {
        translator?: Effort;
        reviewer?: Effort;
    };
    maxCharsPerRequest?: number;
    concurrency?: number;
    policy?: CallPolicy;
    /** Called as the run moves on, with a short phrase for the person waiting. */
    onProgress?: (stage: string) => void | Promise<void>;
    now?: () => Date;
}
interface TranslateDocumentResult {
    /**
     * The translation document without an `_id`, ready to be written as a
     * draft. Null when the run is held by the exact-match check, or when there
     * was nothing to do.
     */
    translation: Json$2 | null;
    report: TranslationReport;
    diff: SourceDiff | null;
    /** True when the existing translation already matches the source and nothing was written. */
    upToDate: boolean;
}
declare function translateDocument(input: TranslateDocumentInput): Promise<TranslateDocumentResult>;
/** The report in the shape Sanity stores: lists of objects need a `_key` on every item. */
declare function reportForStorage(report: TranslationReport): Json$2;

/**
 * The cost estimate shown before a bulk run. Token counts come from
 * Anthropic's token counting endpoint when the site's key is available, and
 * from a fixed characters-per-token ratio when it is not. Either way the
 * figure is an estimate: the real usage of every run is recorded on its job.
 *
 * How the figure is put together, per document:
 *
 *   translator input  = the system prompt + the payload, counted
 *   translator output = payload tokens x TRANSLATION_OUTPUT_FACTOR
 *   reviewer input    = the reviewer prompt + the items x REVIEW_INPUT_FACTOR
 *   reviewer output   = REVIEW_OUTPUT_TOKENS
 *
 * and each side is multiplied by the published rate of its model.
 */

type Json$1 = Record<string, unknown>;
/** Counts the input tokens of a request. The engine passes one backed by Anthropic's endpoint. */
type TokenCounter = (request: {
    model: string;
    system: string;
    user: string;
}) => Promise<number>;
interface EstimateCostInput {
    /** The source documents to estimate. */
    documents: readonly Json$1[];
    /** The language to translate into. */
    language: Language;
    sourceLanguage?: Language;
    manifest: FieldManifest;
    models?: {
        translatorModel?: string;
        reviewerModel?: string;
    };
    glossary?: Glossary;
    styleGuide?: StyleGuide;
    /** When given, tokens are counted rather than estimated from characters. */
    countTokens?: TokenCounter;
    /** Above this many documents a sample is counted and the rest are scaled from it. Defaults to 20. */
    sampleSize?: number;
    concurrency?: number;
}
declare function tokensFromCharacters(characters: number): number;
declare function estimateCost(input: EstimateCostInput): Promise<CostEstimate>;

/**
 * The prompts. Generic on purpose: nothing here belongs to one client. The
 * site's own glossary and style guide are read from its Site Settings and
 * added at run time.
 */

interface PromptContext {
    sourceLanguage: {
        id: string;
        title: string;
    };
    targetLanguage: {
        id: string;
        title: string;
        nativeTitle?: string;
    };
    glossary: Glossary;
    styleGuide: StyleGuide;
}
declare function translatorSystemPrompt(ctx: PromptContext): string;
declare function reviewerSystemPrompt(ctx: PromptContext): string;
/** The JSON schema the reviewer's answer must follow. */
declare const REVIEW_SCHEMA: Record<string, unknown>;

/**
 * The translator call: units in, translated units out. A document that fits
 * goes in one request. A larger one is split along its top-level parts, and
 * each request still carries the document's outline and the text on either
 * side, so nothing is translated out of context.
 */

type Json = Record<string, unknown>;
/** Characters of payload JSON per request. Above this the document is split. */
declare const DEFAULT_MAX_CHARS_PER_REQUEST = 24000;
interface TranslateUnitsInput {
    client: AnthropicLike;
    model: string;
    effort?: Effort;
    prompt: PromptContext;
    /** The source document. */
    document: Json;
    /** The units to translate on this run. */
    units: readonly TranslationUnit[];
    /** Every unit of the document, for context when only some are translated. */
    allUnits: readonly TranslationUnit[];
    /** The current translation of the units that are not being translated, as a fixed reference. */
    existing?: ReadonlyMap<string, UnitValue>;
    /** The source slug, when a translated one should be proposed. */
    slug?: string | null;
    maxCharsPerRequest?: number;
    concurrency?: number;
    policy?: CallPolicy;
}
interface TranslateUnitsResult {
    values: Map<string, UnitValue>;
    slug: string | null;
    usage: CallUsage;
    servedBy: string[];
    structureRetries: number;
    requests: number;
}
/** Group units into requests along the document's top-level parts. */
declare function chunkUnits(document: Json, units: readonly TranslationUnit[], maxChars: number): TranslationUnit[][];
declare function translateUnits(input: TranslateUnitsInput): Promise<TranslateUnitsResult>;
/** The translator request for a whole document, as it would be sent. Used for the cost estimate. */
declare function translatorRequestPreview(prompt: PromptContext, document: Json, units: readonly TranslationUnit[], slug?: string | null): {
    system: string;
    user: string;
};

/**
 * Check 2, the reviewer: a second, separate model call that reads the source
 * and the translation side by side and reports meaning drift, omissions,
 * additions, tone, terminology and legal wording for a person to look at.
 */

/**
 * Read the reviewer's answer. Anything that is not a well-formed issue is
 * dropped rather than trusted; an unknown severity is treated as medium so a
 * malformed answer can never clear a document by accident, and `ok` is false
 * when the answer could not be read at all.
 */
declare function parseReviewerResponse(text: string, knownPaths?: ReadonlySet<string>): {
    ok: boolean;
    issues: ReviewIssue[];
};
interface ReviewInput {
    client: AnthropicLike;
    model: string;
    effort?: Effort;
    prompt: PromptContext;
    pairs: readonly UnitPair[];
    legalPaths: readonly string[];
    maxCharsPerRequest?: number;
    concurrency?: number;
    policy?: CallPolicy;
}
interface ReviewResult {
    /** False when there is a high severity issue, or an answer could not be read. */
    passed: boolean;
    issues: ReviewIssue[];
    usage: CallUsage;
    servedBy: string[];
    /** True when every reviewer answer could be read. */
    readable: boolean;
}
declare function reviewerRequest(prompt: PromptContext, pairs: readonly UnitPair[], legalPaths: readonly string[]): string;
declare function reviewTranslation(input: ReviewInput): Promise<ReviewResult>;

/** Read a secret that was encrypted with the matching public key (RSA-OAEP, SHA-256; PKCS8 private key, base64). */
declare function decryptSecret(privateKey: string, ciphertext: string): Promise<string>;
interface LoadApiKeyOptions {
    /** The private key (PKCS8, base64). Defaults to the `I18N_PRIVATE_KEY` environment variable. */
    privateKey?: string;
    /** The public key (SPKI, base64), used only to say so when the saved key belongs to another key pair. */
    publicKey?: string;
}
/**
 * The site's API key, read from the private `i18n.secrets` document and
 * decrypted. Throws an EngineError in plain words when key storage is not set
 * up, no key was saved, or the saved key cannot be read with this server's
 * private key.
 */
declare function loadApiKey(sanity: SanityLike, options?: LoadApiKeyOptions): Promise<string>;

/**
 * SHA-256 as a plain synchronous function, so the same hashing code runs in
 * the Studio (browser), on the server and in tests without an async step or
 * a Node import. Used for change tracking, never for secrets.
 */
/** The SHA-256 digest of a string (UTF-8), as 64 lower-case hex characters. */
declare function sha256Hex(input: string): string;
/** JSON with object keys sorted, so equal values always serialise to the same string. */
declare function stableStringify(value: unknown): string;

export { AnthropicLike, CallPolicy, CostEstimate, DEFAULT_MAX_CHARS_PER_REQUEST, Effort, EngineSettings, type EstimateCostInput, FieldManifest, Glossary, JobMode, Language, type LoadApiKeyOptions, type PromptContext, REVIEW_SCHEMA, type ReviewInput, ReviewIssue, type ReviewResult, SanityLike, SourceDiff, StyleGuide, type TokenCounter, type TranslateDocumentInput, type TranslateDocumentResult, type TranslateUnitsInput, type TranslateUnitsResult, TranslationReport, TranslationUnit, UnitPair, UnitValue, chunkUnits, decryptSecret, estimateCost, loadApiKey, parseReviewerResponse, reportForStorage, reviewTranslation, reviewerRequest, reviewerSystemPrompt, sha256Hex, stableStringify, tokensFromCharacters, translateDocument, translateUnits, translatorRequestPreview, translatorSystemPrompt };
