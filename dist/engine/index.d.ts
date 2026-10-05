import { L as Language } from '../languages-BzBBGlPy.js';
export { a as LanguagesConfig, b as LanguagesInput, d as defineLanguages } from '../languages-BzBBGlPy.js';
import { F as FieldManifest, G as Glossary, S as StyleGuide, E as EngineSettings, J as JobMode, T as TranslationReport, a as SourceDiff, b as TranslationDependency, A as ApprovalOutcome, C as CostEstimate, c as TranslationUnit, U as UnitValue, d as CallUsage, e as UnitPair, R as ReviewIssue } from '../pricing-BbaX6X3K.js';
export { f as API_KEY_FIELD, g as CHARS_PER_TOKEN, h as CheckCategory, i as CheckFinding, j as CheckToken, D as DEFAULT_REQUIRED_DEPENDENCY_TYPES, k as DEFAULT_REVIEWER_MODEL, l as DEFAULT_TRANSLATOR_MODEL, m as DependencyPlanInput, n as ENGINE_FIELD, o as ENGINE_SETTINGS_FIELDS, p as ExactMatchResult, q as GLOSSARY_FIELD, r as GlossaryTerm, s as JOB_ID_PREFIX, t as JOB_TYPE, u as JobKind, v as JobStatus, L as LEGAL_APPROVERS_FIELD, M as MANIFEST_ID, w as MANIFEST_TYPE, x as MODELS, y as ManifestDocumentType, z as ManifestNode, B as ModelInfo, N as NON_TEXT_FIELD_NAME, P as PathSegment, H as RATES_AS_OF, I as REVIEW_INPUT_FACTOR, K as REVIEW_OUTPUT_TOKENS, O as SECRETS_ID, Q as SECRETS_TYPE, V as STRUCTURE_HASH_PATH, W as STYLE_GUIDE_FIELD, X as SourceHashEntry, Y as StoredSecret, Z as TRANSLATION_OUTPUT_FACTOR, _ as TokenUsage, $ as TranslationJob, a0 as applyUnits, a1 as blockText, a2 as buildFieldManifest, a3 as buildPayload, a4 as checkExactMatch, a5 as collectReferences, a6 as comparePair, a7 as costOf, a8 as dependencyReasons, a9 as diffSource, aa as encryptSecret, ab as extractTokens, ac as extractUnits, ad as getAtPath, ae as isLegalApprover, af as isTranslatableValue, ag as jobId, ah as modelInfo, ai as parsePath, aj as pathToString, ak as planDependencies, al as pruneBlock, am as publicKeyFingerprint, an as readEngineSettings, ao as readGlossary, ap as readLegalApprovers, aq as readNumber, ar as readStyleGuide, as as readUnit, at as resolveManifestNode, au as setAtPath, av as sourceFingerprint, aw as sourceHashes, ax as structureHash, ay as toSlug, az as translationId, aA as unitCharacters, aB as unitPairs, aC as unitStrings, aD as validateStructure } from '../pricing-BbaX6X3K.js';
import { A as AnthropicLike, E as Effort, C as CallPolicy, S as SanityLike } from '../job-DfpCEMeY.js';
export { a as APPROVAL_JOB_KINDS, b as EngineConfig, c as EngineError, d as EngineErrorCode, J as JobOutcome, K as KEY_STORAGE_NOT_CONFIGURED, M as ModelAnswer, e as ModelCall, f as ModelMessage, R as RetryOptions, g as SanityHttpConfig, T as TRANSLATE_JOB_KINDS, h as asEngineError, i as backoffDelay, j as callModel, k as countTokens, l as createAnthropicClient, m as createLimiter, n as createSanityHttp, o as isRetryable, p as parseJsonObject, q as plainMessage, r as resolveSanity, s as retryAfterMs, t as runJob, u as toEngineError, w as withRetry } from '../job-DfpCEMeY.js';
import { L as LegalPerson } from '../legal-CEFwPMVK.js';
export { a as LEGAL_APPROVAL_ID_PREFIX, b as LEGAL_APPROVAL_TYPE, c as LegalApproval, d as LegalApprovalStatus, e as LegalDecision, f as LegalOccurrence, g as LegalPathRecord, h as LegalPlan, i as LegalPlanInput, j as LegalRecord, P as PublishCheck, S as StaleMark, k as StalePlan, l as StalePlanInput, m as applyLegalValue, n as checkTranslationForPublish, o as legalApprovalId, p as legalPathSegments, q as legalSourceHash, r as legalUnitsOf, s as normaliseLegalText, t as occurrenceKey, u as parseLegalValue, v as planLegalRegistry, w as planStaleTranslations, x as statusAfterRun, y as unitText } from '../legal-CEFwPMVK.js';
export { C as ConsentRecord, F as FORM_TEXT_SETTINGS, b as buildConsentRecords, c as consentText, a as consentWordingApproved, f as formFieldName, l as localizeForm, o as optionLabel, p as portableTextToPlain, s as submissionWebhookFields } from '../forms-DjgjKAeJ.js';
export { A as APPLY_NOTICE_FIELD, R as ResolvedApplyNotice, T as TRANSLATION_META_TYPE, a as applyNoticeHideCss, m as matchesApplyHost, r as resolveApplyNotice, t as translationMetaId } from '../applyNotice-BJDkeyEo.js';

type Json$3 = Record<string, unknown>;
interface TranslateDocumentInput {
    /** The published source document, in the default language. */
    document: Json$3;
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
    existingTranslation?: Json$3 | null;
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
    translation: Json$3 | null;
    report: TranslationReport;
    diff: SourceDiff | null;
    /** True when the existing translation already matches the source and nothing was written. */
    upToDate: boolean;
}
declare function translateDocument(input: TranslateDocumentInput): Promise<TranslateDocumentResult>;
/** The report in the shape Sanity stores: lists of objects need a `_key` on every item. */
declare function reportForStorage(report: TranslationReport): Json$3;

/**
 * The server side of the review workflow: publishing a translation under
 * the rule, and deciding on a legal unit (approve, send back) with the
 * effects that follow. Everything writes with the server token; who may ask
 * is checked in `runJob` before any of this runs.
 */

/** The manifest the Studio keeps for the server. Null when it is not there. */
declare function readStoredManifest(sanity: SanityLike): Promise<FieldManifest | null>;
interface PublishTranslationOptions {
    /** The field manifest. Defaults to the one the Studio keeps in `i18n.manifest`; without any, publishing is refused. */
    manifest?: FieldManifest | null;
    /**
     * Document types whose translation must be approved and live before a
     * document that refers to them can be published. Defaults to `["form"]`: a
     * page never goes live in a language its embedded form does not exist in.
     * Pass an empty list to switch the rule off.
     */
    requiredDependencyTypes?: readonly string[];
    /**
     * After publishing, also publish the approved drafts in the same language
     * that were only waiting for this document (a page waiting for its form).
     * The engine passes true when automatic publishing is on.
     */
    publishDependents?: boolean;
    now?: () => Date;
}
interface PublishTranslationResult {
    published: boolean;
    /** The published document id when it was published. */
    id?: string;
    /** Why not, in plain words. */
    reason?: string;
    /** The translatable documents this one refers to and how each stands in this language. */
    dependencies?: TranslationDependency[];
    /** Documents that were waiting for this one and were published with it. */
    dependentsPublished?: string[];
}
/**
 * Publish a translation draft, but only under the rule: its status is
 * Approved, it is not held, no legal unit on it is pending, and every legal
 * path carries the wording the registry approved. Publishing is Sanity's
 * own: the published document is replaced by the draft and the draft is
 * removed. Refuses with a plain reason otherwise, and never touches the
 * published document then.
 */
declare function publishTranslation(sanity: SanityLike, draftId: string, options?: PublishTranslationOptions): Promise<PublishTranslationResult>;
interface DecisionInput {
    sanity: SanityLike;
    unitId: string;
    decidedBy: LegalPerson;
    comment?: string;
    /** Publish a translation that becomes approved by this decision. Defaults to the engine setting in Site Settings. */
    autoPublish?: boolean;
    settingsType?: string;
    engineField?: string;
    manifest?: FieldManifest | null;
    /** See `PublishTranslationOptions.requiredDependencyTypes`. */
    requiredDependencyTypes?: readonly string[];
    now?: () => Date;
}
/**
 * Approve a legal unit: record the decision, write the approved wording into
 * every occurrence's draft, recount each draft's legal record, and mark a
 * draft with nothing left pending Approved. With automatic publishing on,
 * a draft that becomes Approved is published under the rule.
 */
declare function approveUnit(input: DecisionInput): Promise<ApprovalOutcome>;
/** Send a legal unit back with a comment. The translations that carry it stay held; nothing else changes. */
declare function sendBackUnit(input: DecisionInput): Promise<ApprovalOutcome>;

/**
 * Loading what a translation depends on: the translatable documents it
 * refers to and their published translations in the same language.
 */

type Json$2 = Record<string, unknown>;
declare function loadDependencies(sanity: SanityLike, document: Json$2, language: string, manifest: FieldManifest, requiredTypes?: readonly string[]): Promise<TranslationDependency[]>;

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

export { AnthropicLike, ApprovalOutcome, CallPolicy, CostEstimate, DEFAULT_MAX_CHARS_PER_REQUEST, type DecisionInput, Effort, EngineSettings, type EstimateCostInput, FieldManifest, Glossary, JobMode, Language, LegalPerson, type LoadApiKeyOptions, type PromptContext, type PublishTranslationOptions, type PublishTranslationResult, REVIEW_SCHEMA, type ReviewInput, ReviewIssue, type ReviewResult, SanityLike, SourceDiff, StyleGuide, type TokenCounter, type TranslateDocumentInput, type TranslateDocumentResult, type TranslateUnitsInput, type TranslateUnitsResult, TranslationDependency, TranslationReport, TranslationUnit, UnitPair, UnitValue, approveUnit, chunkUnits, decryptSecret, estimateCost, loadApiKey, loadDependencies, parseReviewerResponse, publishTranslation, readStoredManifest, reportForStorage, reviewTranslation, reviewerRequest, reviewerSystemPrompt, sendBackUnit, sha256Hex, stableStringify, tokensFromCharacters, translateDocument, translateUnits, translatorRequestPreview, translatorSystemPrompt };
