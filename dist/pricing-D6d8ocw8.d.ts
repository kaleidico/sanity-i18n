type ManifestNode = {
    kind: "text";
    legal?: boolean;
} | {
    kind: "list";
    legal?: boolean;
} | {
    kind: "portableText";
    members: Record<string, ManifestNode>;
    legal?: boolean;
} | {
    kind: "object";
    fields: Record<string, ManifestNode>;
    legal?: boolean;
} | {
    kind: "array";
    members: Record<string, ManifestNode>;
    legal?: boolean;
} | {
    kind: "ref";
    type: string;
    legal?: boolean;
};
interface ManifestDocumentType {
    fields: Record<string, ManifestNode>;
    /** Fields read from the source document on a translation; never translated. */
    sharedFields: string[];
    /** The slug field, translated separately into a URL-safe slug. */
    slugField: string | null;
}
interface FieldManifest {
    version: 1;
    defaultLanguage: string;
    documents: Record<string, ManifestDocumentType>;
    /** Named object types, stored once and pointed at with `{ kind: "ref" }`. */
    types: Record<string, ManifestNode>;
}
/** The part of a compiled Sanity schema this module reads. `useSchema()` and `createSchema()` both satisfy it. */
interface CompiledSchemaLike {
    get(name: string): unknown;
}
/**
 * Field names that hold plumbing rather than copy even though the field is a
 * plain string: links, ids, keys, icons, colours. A host that needs such a
 * field translated sets `options: { i18n: { translate: true } }` on it.
 */
declare const NON_TEXT_FIELD_NAME: RegExp;
interface BuildFieldManifestOptions {
    /** The default language id. Defaults to the one recorded by `translatable()`, else `en`. */
    defaultLanguage?: string;
}
/**
 * Build the manifest for the given document types from a compiled schema.
 * Types the schema does not know are left out.
 */
declare function buildFieldManifest(schema: CompiledSchemaLike, documentTypes: readonly string[], options?: BuildFieldManifestOptions): FieldManifest;
/** Follow a `ref` node to the named type it points at. Returns null when the manifest does not have it. */
declare function resolveManifestNode(manifest: FieldManifest, node: ManifestNode): {
    node: Exclude<ManifestNode, {
        kind: "ref";
    }>;
    legal: boolean;
} | null;

/**
 * Paths into a Sanity document, in the same form the Studio uses: field
 * names, array members by `_key`, and an index only where a member has no
 * key (arrays of plain strings).
 *
 * `blocks[_key=="k01"].heading`, `seo.metaTitle`, `tags[2]`
 */
type PathSegment = string | number | {
    _key: string;
};
declare function pathToString(segments: readonly PathSegment[]): string;
declare function parsePath(path: string): PathSegment[];
/** The value at a path, or `undefined` when any step is missing. */
declare function getAtPath(root: unknown, segments: readonly PathSegment[]): unknown;
/**
 * Set the value at a path that already exists up to its last step. Returns
 * false, changing nothing, when a step on the way is missing.
 */
declare function setAtPath(root: unknown, segments: readonly PathSegment[], value: unknown): boolean;

/**
 * The translation payload: what is sent to the model and how its answer is
 * checked and written back. Pure functions over plain JSON, shared by the
 * Studio (change tracking) and the server (translation).
 *
 * A document is cut into units. A unit is the smallest thing that is
 * translated as one piece and hashed as one piece:
 *
 * - `text`: one string field
 * - `list`: an array of plain strings
 * - `block`: one Portable Text block, with its spans, marks and mark
 *   definitions, so a sentence is never split across requests
 *
 * The payload keeps the document's own shape: objects keep their `_key` and
 * `_type`, arrays keep their members in order, and everything that is not
 * text (references, images, numbers, fixed choices, shared fields, slugs) is
 * simply absent.
 */

type UnitKind = "text" | "list" | "block";
interface PrunedSpan {
    _key?: string;
    _type: string;
    marks?: string[];
    text?: string;
}
interface PrunedBlock {
    _key?: string;
    _type: "block";
    style?: string;
    listItem?: string;
    level?: number;
    markDefs?: Record<string, unknown>[];
    children: PrunedSpan[];
}
type UnitValue = string | string[] | PrunedBlock;
interface TranslationUnit {
    /** The unit's path in the document, e.g. `blocks[_key=="k01"].heading`. */
    path: string;
    segments: PathSegment[];
    kind: UnitKind;
    /** The source value: a string, a list of strings, or a pruned Portable Text block. */
    value: UnitValue;
    /** True when the field, or anything above it, is marked legal. */
    legal: boolean;
    /** SHA-256 of the source value. */
    hash: string;
    /** The top-level part of the document this unit sits in, used to split large documents. */
    piece: string;
}
type Json = Record<string, unknown>;
/** True when a string is copy a person would read: it has a letter and is not just a URL, path or email. */
declare function isTranslatableValue(value: unknown): value is string;
/** A Portable Text block reduced to what a translator needs and what must come back unchanged. */
declare function pruneBlock(block: Json): PrunedBlock;
/** The readable text of a pruned block: its spans joined in order. */
declare function blockText(block: PrunedBlock): string;
/**
 * Every translatable unit of a document, in document order. Shared fields,
 * the slug field, `language`, `i18n` and system fields are never included.
 */
declare function extractUnits(doc: Json, manifest: FieldManifest, typeName?: string): TranslationUnit[];
/**
 * The payload for a set of units: the document's shape, reduced to those
 * units and the `_key` and `_type` of everything above them.
 */
declare function buildPayload(doc: Json, units: readonly TranslationUnit[]): Json;
/**
 * Compare a translated payload with the one that was sent. The two must have
 * the same keys, the same `_key` and `_type` values, the same array lengths,
 * and inside a Portable Text block the same style, marks and mark
 * definitions. Only the text itself may differ. Returns a list of plain
 * descriptions of every difference, empty when the structure is identical.
 */
declare function validateStructure(sent: unknown, received: unknown): string[];
/** The translated value of one unit, read from a payload of the same shape. `undefined` when it is not there. */
declare function readUnit(payload: unknown, unit: TranslationUnit): UnitValue | undefined;
/**
 * Write translated unit values into a document (a copy of the source, or the
 * document being rebuilt). Spans keep the leading and trailing spaces of the
 * source span, because a space at a span edge separates words across a mark
 * boundary. Returns the paths that could not be written.
 */
declare function applyUnits(target: Json, entries: readonly {
    unit: TranslationUnit;
    value: UnitValue;
}[]): string[];
interface UnitPair {
    path: string;
    source: string;
    translated: string;
    /** Link targets of a Portable Text block, compared as exact values. */
    sourceHrefs?: string[];
    translatedHrefs?: string[];
}
/** The source and translated text of a unit as plain string pairs, for the exact-match check and the reviewer. */
declare function unitPairs(unit: TranslationUnit, translated: UnitValue): UnitPair[];
/** The number of characters of text in a set of units. */
declare function unitCharacters(units: readonly TranslationUnit[]): number;
/** The number of separate strings in a set of units (a block counts each span with text). */
declare function unitStrings(units: readonly TranslationUnit[]): number;
/** The path the hash of everything that is not text is stored under. */
declare const STRUCTURE_HASH_PATH = "__structure";
interface SourceHashEntry {
    _key: string;
    path: string;
    hash: string;
}
/**
 * A fingerprint of everything in the source that is not translated text but
 * is still copied onto the translation: block order, images, links, fixed
 * choices. When it changes, the translation is rebuilt from the source
 * without asking the model for anything.
 */
declare function structureHash(doc: Json, manifest: FieldManifest, units: readonly TranslationUnit[]): string;
/** The per-unit source hashes stored on a translation as `i18n.sourceHashes`, plus the structure hash. */
declare function sourceHashes(doc: Json, manifest: FieldManifest, units?: readonly TranslationUnit[]): SourceHashEntry[];
/** One fingerprint for a whole set of source hashes, stored as `i18n.sourceHash`. */
declare function sourceFingerprint(entries: readonly SourceHashEntry[]): string;
interface SourceDiff {
    /** Units whose English changed since the translation was made. */
    changed: string[];
    /** Units that are new in the English. */
    added: string[];
    /** Units the translation was made from that no longer exist in the English. */
    removed: string[];
    /** True when something that is not text changed: block order, an image, a link target, a fixed choice. */
    structureChanged: boolean;
    /** True when nothing at all changed. */
    upToDate: boolean;
}
/**
 * Compare the source document with the hashes stored on a translation.
 * A translation without stored hashes reports every unit as added.
 */
declare function diffSource(sourceDoc: Json, translationDoc: Json | null | undefined, manifest: FieldManifest): SourceDiff;

/**
 * Check 1, the exact-match check. A pure function over pairs of source and
 * translated text: every number, rate, percentage, dollar amount, NMLS
 * number, phone number, email address, URL, link target, pipe and
 * placeholder in the translation must equal the source.
 *
 * A value that differs is a failure and holds the document. A value that is
 * the same but written in another format (1,234.50 against 1.234,50, or a
 * phone number with different punctuation) is a warning: the site keeps the
 * US format, so a person should look, but nothing is wrong with the number.
 */

type CheckCategory = "number" | "percentage" | "currency" | "nmls" | "phone" | "email" | "url" | "href" | "pipe" | "placeholder" | "linebreak" | "order";
interface CheckToken {
    category: Exclude<CheckCategory, "href" | "pipe" | "linebreak" | "order">;
    /** The token as written. */
    raw: string;
    /** The value read the US way (1,234.50). For exact categories, the raw text. */
    value: string;
    /** The value read the European way (1.234,50), when that reading is possible. */
    alt?: string;
    /** Position in the text, to compare order. */
    index: number;
}
interface CheckFinding {
    path: string;
    category: CheckCategory;
    /** The value in the English, or "" when the translation has one the English does not. */
    source: string;
    /** The value in the translation, or "" when it is missing there. */
    translated: string;
    note: string;
}
interface ExactMatchResult {
    passed: boolean;
    /** How many pairs of strings were compared. */
    checked: number;
    failures: CheckFinding[];
    warnings: CheckFinding[];
}
/**
 * The two ways a written number can be read. `us` treats the comma as the
 * thousands separator and the period as the decimal point; `eu` the other
 * way round. Either is null when the text cannot be read that way.
 */
declare function readNumber(raw: string): {
    us: string | null;
    eu: string | null;
};
/** Every exact-match token in a string, in order of appearance. */
declare function extractTokens(text: string): CheckToken[];
/** Compare one pair of strings. */
declare function comparePair(pair: UnitPair): {
    failures: CheckFinding[];
    warnings: CheckFinding[];
};
/** Check 1 over every pair. `passed` is false as soon as one value differs. */
declare function checkExactMatch(pairs: readonly UnitPair[]): ExactMatchResult;

/**
 * What the Studio and the server agree on for the translation engine: the
 * private documents, the settings fields, the job and the report. No Sanity
 * or Node import, so both sides share it.
 */

/** The document that holds the encrypted API key. */
declare const SECRETS_ID = "i18n.secrets";
declare const SECRETS_TYPE = "i18n.secrets";
/** The document the Studio keeps the field manifest in, for the server to read. */
declare const MANIFEST_ID = "i18n.manifest";
declare const MANIFEST_TYPE = "i18n.manifest";
declare const JOB_TYPE = "i18n.job";
declare const JOB_ID_PREFIX = "i18n.job.";
declare function jobId(uuid: string): string;
/** The document types the engine adds. Desks and "new document" menus should leave them out. */
declare const ENGINE_DOCUMENT_TYPES: readonly ["i18n.secrets", "i18n.manifest", "i18n.job"];
interface StoredSecret {
    /** RSA-OAEP ciphertext of the API key, base64. */
    ciphertext: string;
    /** The last four characters of the key, to recognise it by. */
    last4: string;
    savedAt: string;
    savedBy?: string;
    /** Short fingerprint of the public key the ciphertext was made with. */
    keyFingerprint: string;
}
declare const GLOSSARY_FIELD = "i18nGlossary";
declare const STYLE_GUIDE_FIELD = "i18nStyleGuide";
declare const ENGINE_FIELD = "i18nEngine";
declare const API_KEY_FIELD = "i18nApiKey";
declare const LEGAL_APPROVERS_FIELD = "i18nLegalApprovers";
/** The settings fields the engine adds. On a translatable settings type they belong in `sharedFields`. */
declare const ENGINE_SETTINGS_FIELDS: readonly ["i18nGlossary", "i18nStyleGuide", "i18nEngine", "i18nApiKey", "i18nLegalApprovers"];
interface GlossaryTerm {
    source: string;
    target: string;
    note?: string;
}
interface Glossary {
    doNotTranslate: string[];
    terms: GlossaryTerm[];
}
type Register = "usted" | "tu";
interface StyleGuide {
    /** The market the translation is for, e.g. `es-US`. */
    market: string;
    register: Register;
    audience: string;
    notes: string;
}
interface EngineSettings {
    translatorModel: string;
    reviewerModel: string;
    /**
     * Publish a translation as soon as both checks pass and no legal text on it
     * is waiting for approval (review model b). Off, every translation waits
     * for a person to press Publish. Defaults to on.
     */
    autoPublishMarketing: boolean;
}
/** The glossary as stored in Site Settings, tidied: blanks dropped, duplicates removed. */
declare function readGlossary(settings: Record<string, unknown> | null | undefined, field?: string): Glossary;
declare function readStyleGuide(settings: Record<string, unknown> | null | undefined, field?: string): StyleGuide;
declare function readEngineSettings(settings: Record<string, unknown> | null | undefined, field?: string): EngineSettings;
/** The emails allowed to approve legal text, lower case, blanks and duplicates dropped. */
declare function readLegalApprovers(settings: Record<string, unknown> | null | undefined, field?: string): string[];
/** True when an email is on the approver list (case does not matter). */
declare function isLegalApprover(email: string | null | undefined, approvers: readonly string[]): boolean;
type JobKind = "translate" | "estimate" | "approve" | "send_back";
type JobMode = "full" | "changes";
type JobStatus = "pending" | "running" | "done" | "held" | "failed";
interface ReviewIssue {
    path: string;
    severity: "high" | "medium" | "low";
    category: "meaning" | "omission" | "addition" | "tone" | "terminology" | "legal";
    note: string;
}
interface CallUsage {
    model: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
interface TranslationReport {
    mode: JobMode;
    language: string;
    sourceId: string;
    translationId: string;
    startedAt: string;
    finishedAt: string;
    translatorModel: string;
    reviewerModel: string;
    /** Every model that actually answered, which differs from the chosen ones only after a fallback. */
    servedBy: string[];
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    ratesAsOf: string;
    usage: CallUsage[];
    /** Units in the document, how many went to the model and how many were kept from the existing translation. */
    unitsTotal: number;
    unitsTranslated: number;
    unitsReused: number;
    /** The paths that were sent to the model on this run. */
    translatedPaths: string[];
    /** How many times the model was asked again because the structure did not match. */
    structureRetries: number;
    check1Passed: boolean;
    check1Checked: number;
    check1Failures: CheckFinding[];
    check1Warnings: CheckFinding[];
    reviewPassed: boolean;
    reviewIssues: ReviewIssue[];
    /** The paths in this document that are legal text and need a person's approval. */
    legalPaths: string[];
    sourceSlug: string | null;
    proposedSlug: string | null;
    held: boolean;
    holdReasons: string[];
    /** True when the translation was written to the dataset as a draft. */
    saved: boolean;
    /** The status the draft was given: `draft` when held, `awaiting_approval` with legal text pending, else `approved`. */
    status?: "draft" | "awaiting_approval" | "approved";
    /** Legal units on the document that are waiting for approval, and that carry approved wording. */
    legalPending?: number;
    legalApproved?: number;
    /** True when the run published the translation (approved, and automatic publishing is on). */
    published?: boolean;
    /** Why the translation was not published, in plain words, when it was approved but stayed a draft. */
    publishNote?: string;
}
/** What an approval job did. */
interface ApprovalOutcome {
    unitId: string;
    status: "approved" | "sent_back";
    /** Every translation the decision touched. */
    translations: {
        documentId: string;
        status: string;
        published: boolean;
        note?: string;
    }[];
}
interface CostEstimate {
    documents: number;
    strings: number;
    characters: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    translatorModel: string;
    reviewerModel: string;
    ratesAsOf: string;
    /** `counted`: every document went through the token counter. `sampled`: a sample did and the rest were scaled from it. `characters`: no key was available, so characters were divided by a fixed ratio. */
    method: "counted" | "sampled" | "characters";
    /** How many documents went through the token counter. */
    counted: number;
    note: string;
}
interface JobError {
    code: string;
    /** Plain words a person can act on. */
    message: string;
    /** Extra detail that is safe to show, such as the paths that did not match. */
    details?: string[];
}
interface TranslationJob {
    _id: string;
    _type: typeof JOB_TYPE;
    _rev?: string;
    kind: JobKind;
    /** The source document of a translation job. */
    sourceId?: string;
    sourceType?: string;
    /** The source documents of an estimate job. */
    sourceIds?: string[];
    /** The registry entry an approval job decides on. */
    unitId?: string;
    /** The approver's comment. Required to send a unit back. */
    comment?: string;
    /** The signed-in Studio user who asked for the decision, as the Studio saw them. The route checks the job was created by this user. */
    approver?: {
        id?: string;
        name?: string;
        email?: string;
    };
    language: string;
    mode: JobMode;
    requestedBy?: string;
    status: JobStatus;
    /** What the server is doing right now, in plain words. */
    progress?: string;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    report?: TranslationReport;
    estimate?: CostEstimate;
    approval?: ApprovalOutcome;
    error?: JobError;
}
/** The id of a translation: `<sourceId>-<language>`. Singletons follow the same rule (`settings-es`, `homepage-es`). */
declare function translationId(sourceId: string, language: string): string;
/**
 * A URL-safe slug: lower case, accents removed, anything that is not a
 * letter or a digit turned into a single hyphen.
 */
declare function toSlug(input: string): string;
/** A short fingerprint of a public key (SPKI, base64), to tell which key pair a ciphertext belongs to. */
declare function publicKeyFingerprint(publicKey: string): Promise<string>;
/**
 * Encrypt a secret with the site's public key (RSA-OAEP, SHA-256). Runs in
 * the browser with WebCrypto. Only the server's private key can read the
 * result, so nothing the browser stores or the dataset holds can be turned
 * back into the secret.
 */
declare function encryptSecret(publicKey: string, secret: string): Promise<string>;

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
declare const RATES_AS_OF = "2026-09-25";
interface ModelInfo {
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
declare const MODELS: readonly ModelInfo[];
declare const DEFAULT_TRANSLATOR_MODEL = "claude-opus-5-5";
declare const DEFAULT_REVIEWER_MODEL = "claude-opus-5-5";
declare function modelInfo(id: string): ModelInfo | undefined;
interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}
/** US dollars for a number of tokens on a model, to six decimal places. Unknown models cost 0 and should be reported as unpriced. */
declare function costOf(usage: TokenUsage, modelId: string): number;
/**
 * Characters per token when the token counting endpoint cannot be used (no
 * key saved yet). Payloads are JSON with short keys, so they tokenise worse
 * than plain prose; 3 is deliberately on the cautious side.
 */
declare const CHARS_PER_TOKEN = 3;
/**
 * Output tokens for a translation, as a multiple of the payload's input
 * tokens: the same JSON comes back, Spanish runs longer than English, and
 * the model's reasoning is billed as output.
 */
declare const TRANSLATION_OUTPUT_FACTOR = 1.6;
/** The reviewer reads the source and the translation side by side. */
declare const REVIEW_INPUT_FACTOR = 2.3;
/** Output tokens allowed for one reviewer answer, reasoning included. */
declare const REVIEW_OUTPUT_TOKENS = 1500;

export { buildFieldManifest as $, type ApprovalOutcome as A, REVIEW_OUTPUT_TOKENS as B, type CostEstimate as C, DEFAULT_REVIEWER_MODEL as D, type EngineSettings as E, type FieldManifest as F, type Glossary as G, SECRETS_ID as H, SECRETS_TYPE as I, type JobMode as J, STRUCTURE_HASH_PATH as K, LEGAL_APPROVERS_FIELD as L, MANIFEST_ID as M, NON_TEXT_FIELD_NAME as N, STYLE_GUIDE_FIELD as O, type PathSegment as P, type SourceHashEntry as Q, type ReviewIssue as R, type StyleGuide as S, type TranslationReport as T, type UnitValue as U, type StoredSecret as V, TRANSLATION_OUTPUT_FACTOR as W, type TokenUsage as X, type TranslationJob as Y, applyUnits as Z, blockText as _, type SourceDiff as a, buildPayload as a0, checkExactMatch as a1, comparePair as a2, costOf as a3, diffSource as a4, encryptSecret as a5, extractTokens as a6, extractUnits as a7, getAtPath as a8, isLegalApprover as a9, type UnitKind as aA, isTranslatableValue as aa, jobId as ab, modelInfo as ac, parsePath as ad, pathToString as ae, pruneBlock as af, publicKeyFingerprint as ag, readEngineSettings as ah, readGlossary as ai, readLegalApprovers as aj, readNumber as ak, readStyleGuide as al, readUnit as am, resolveManifestNode as an, setAtPath as ao, sourceFingerprint as ap, sourceHashes as aq, structureHash as ar, toSlug as as, translationId as at, unitCharacters as au, unitPairs as av, unitStrings as aw, validateStructure as ax, type CompiledSchemaLike as ay, ENGINE_DOCUMENT_TYPES as az, type TranslationUnit as b, type CallUsage as c, type UnitPair as d, API_KEY_FIELD as e, CHARS_PER_TOKEN as f, type CheckCategory as g, type CheckFinding as h, type CheckToken as i, DEFAULT_TRANSLATOR_MODEL as j, ENGINE_FIELD as k, ENGINE_SETTINGS_FIELDS as l, type ExactMatchResult as m, GLOSSARY_FIELD as n, type GlossaryTerm as o, JOB_ID_PREFIX as p, JOB_TYPE as q, type JobKind as r, type JobStatus as s, MANIFEST_TYPE as t, MODELS as u, type ManifestDocumentType as v, type ManifestNode as w, type ModelInfo as x, RATES_AS_OF as y, REVIEW_INPUT_FACTOR as z };
