import { aG as UnitKind, c as TranslationUnit, F as FieldManifest, P as PathSegment, U as UnitValue } from './pricing-BbaX6X3K.js';
import { h as TranslationLabels } from './applyNotice-BJDkeyEo.js';

/**
 * The legal approval registry: one entry per piece of legal English text per
 * language, approved once and reused wherever that text appears. Pure
 * functions over plain JSON, shared by the Studio (the approval queue, the
 * publish guard, the stale check) and the server (the engine hook, the
 * approval route, publishing).
 *
 * A legal unit is one legal path's English text (a field marked with
 * `legalText()` or inside a `legalBlock()`), identified by the SHA-256 of the
 * normalised text (trimmed, whitespace collapsed). The registry entry's id is
 * `i18n-legal-<language>-<first 12 hex of the hash>`. It has no period in it
 * on purpose: Sanity hides dotted ids from unauthenticated reads, and the
 * site reads approvals without a token.
 */

type Json = Record<string, unknown>;
declare const LEGAL_APPROVAL_TYPE = "i18n.legalApproval";
declare const LEGAL_APPROVAL_ID_PREFIX = "i18n-legal-";
type LegalApprovalStatus = "pending" | "approved" | "sent_back" | "superseded";
/** Who made a decision, as the Studio knows the signed-in user. */
interface LegalPerson {
    id?: string;
    name?: string;
    email?: string;
}
/** One place a legal unit appears: a translation document and the path inside it. */
interface LegalOccurrence {
    _key: string;
    /** The published id of the translation document (the draft is `drafts.` + this). */
    documentId: string;
    documentType: string;
    path: string;
}
/** One line of a unit's history: every decision ever made on it, and every new proposal. */
interface LegalDecision {
    _key: string;
    status: LegalApprovalStatus;
    decidedBy?: LegalPerson;
    decidedAt: string;
    comment?: string;
    /** The English the decision was made on. */
    sourceHash: string;
}
interface LegalApproval {
    _id: string;
    _type: typeof LEGAL_APPROVAL_TYPE;
    _rev?: string;
    language: string;
    sourceHash: string;
    /** The English text, as it is in the source document. */
    sourceText: string;
    kind: UnitKind;
    /** The proposed or approved translation, readable. */
    translatedText: string;
    /** The same as a JSON string of the unit value (a string, a list, or a Portable Text block), so it can be written back exactly. */
    translatedValue: string;
    status: LegalApprovalStatus;
    decidedBy?: LegalPerson;
    decidedAt?: string;
    comment?: string;
    /** When superseded: the hash of the English that replaced this one. */
    supersededBy?: string;
    occurrences: LegalOccurrence[];
    history: LegalDecision[];
    createdAt: string;
    updatedAt: string;
}
/** `i18n.legal` on a translation: how its legal units stand. */
interface LegalPathRecord {
    _key: string;
    path: string;
    unitId: string;
    sourceHash: string;
    status: "pending" | "approved";
}
interface LegalRecord {
    pending: number;
    approved: number;
    paths: LegalPathRecord[];
}
/** Trimmed, with every run of whitespace collapsed to one space. */
declare function normaliseLegalText(text: string): string;
/** SHA-256 of the normalised English text, 64 hex characters. */
declare function legalSourceHash(text: string): string;
/** `i18n-legal-<language>-<hash12>`. Deterministic, so the same English in the same language is always one entry. */
declare function legalApprovalId(language: string, sourceHash: string): string;
/** The readable text of a unit value: the string, the list joined by line breaks, or the block's spans. */
declare function unitText(value: UnitValue): string;
declare function occurrenceKey(documentId: string, path: string): string;
/** The legal units of a document, in document order. */
declare function legalUnitsOf(doc: Json, manifest: FieldManifest, typeName?: string): TranslationUnit[];
/** Parse a stored `translatedValue`. Null when it cannot be read. */
declare function parseLegalValue(entry: Pick<LegalApproval, "translatedValue" | "translatedText" | "kind">): UnitValue | null;
/**
 * Write a legal value into a document at a path. A string or a list replaces
 * the value. A Portable Text block keeps the target block's spans and marks:
 * span by span when the approved block has the same number of text spans,
 * else the whole approved text goes into the first text span and the others
 * are emptied, so the approved wording is what shows.
 */
declare function applyLegalValue(target: Json, segments: readonly PathSegment[], value: UnitValue): boolean;
interface LegalPlanInput {
    language: string;
    /** The published id of the translation document. */
    documentId: string;
    documentType: string;
    /** The legal units of the English source. */
    units: readonly TranslationUnit[];
    /** The translation being built. Approved and pending wording is written into it in place. */
    translation: Json;
    /** The registry entries that already exist, by id. */
    entries: ReadonlyMap<string, LegalApproval>;
    now: string;
    /** Who is proposing, for the history line. */
    by?: LegalPerson;
    /** The comment on the history line of a new proposal. */
    note?: string;
}
interface LegalPlan {
    /** Raw Sanity mutations that bring the registry up to date. Apply them together with the translation. */
    mutations: Json[];
    legal: LegalRecord;
}
/**
 * Walk the legal units of a translation and bring the registry into step:
 *
 * - an approved entry overwrites the translation with the approved wording
 * - a pending entry overwrites it with the pending proposal, so every
 *   occurrence shows the approver the same words
 * - no entry: a pending entry is created with the translation as the proposal
 * - a sent back or superseded entry becomes pending again with the new proposal
 *
 * Every entry gains this document as an occurrence. Returns the mutations and
 * the `i18n.legal` record to store on the translation.
 */
declare function planLegalRegistry(input: LegalPlanInput): LegalPlan;
/** The translation status a finished run gives a draft: held stays a draft, pending legal text waits, otherwise approved. */
declare function statusAfterRun(held: boolean, legal: LegalRecord): "draft" | "awaiting_approval" | "approved";
interface PublishCheck {
    ok: boolean;
    /** Plain reasons a person can act on. Empty when ok. */
    reasons: string[];
}
interface PublishCheckOptions {
    labels?: TranslationLabels;
}
/**
 * May this translation go live? Only when its status is Approved, it is not
 * held by the reviewer, no legal unit on it is pending, and every legal path
 * in the document carries the wording the registry approved for it, word for
 * word. A hand edit to legal text after approval therefore needs a new
 * approval before it can be published.
 *
 * `manifest` may be null when the caller cannot build one; the legal paths
 * are then checked from the stored record only.
 */
declare function checkTranslationForPublish(doc: Json, manifest: FieldManifest | null, entries: ReadonlyMap<string, Pick<LegalApproval, "status" | "translatedText">>, options?: PublishCheckOptions): PublishCheck;
interface StaleTranslationInput {
    /** The published translation, if there is one. */
    published?: Json | null;
    /** The draft of the translation, if there is one. */
    draft?: Json | null;
}
interface StalePlanInput {
    /** The English document as just published. */
    source: Json;
    translations: readonly StaleTranslationInput[];
    manifest: FieldManifest;
    now: string;
    /** Ids of the metadata documents that exist. The metadata document is only patched when its id is listed here, so a patch is never sent to a missing one. */
    metaIds?: ReadonlySet<string>;
}
interface StaleMark {
    /** The published id of the translation. */
    id: string;
    language: string;
    status: "awaiting_approval" | "needs_update";
    /** The legal paths whose English wording changed or is new. */
    legalChanged: string[];
    /** Registry entries marked superseded. */
    superseded: string[];
    draftCreated: boolean;
}
interface StalePlan {
    mutations: Json[];
    marks: StaleMark[];
}
/**
 * After a default-language document is published, compare it with each
 * translation's stored hashes. A translation that no longer matches is marked
 * on its DRAFT copy only: `awaiting_approval` when legal wording changed or
 * was added (the old registry entries are marked superseded), `needs_update`
 * otherwise, with `i18n.staleSince` set. A draft is created from the
 * published translation when there is none. The published translation is
 * never touched, so a page stays live as it was last approved. Translations
 * made by hand, with no stored hashes, are left alone.
 */
declare function planStaleTranslations(input: StalePlanInput): StalePlan;
/** Segments for a stored path, for callers that only have the string. */
declare function legalPathSegments(path: string): PathSegment[];

export { type LegalPerson as L, type PublishCheck as P, type StaleMark as S, LEGAL_APPROVAL_ID_PREFIX as a, LEGAL_APPROVAL_TYPE as b, type LegalApproval as c, type LegalApprovalStatus as d, type LegalDecision as e, type LegalOccurrence as f, type LegalPathRecord as g, type LegalPlan as h, type LegalPlanInput as i, type LegalRecord as j, type StalePlan as k, type StalePlanInput as l, applyLegalValue as m, checkTranslationForPublish as n, legalApprovalId as o, legalPathSegments as p, legalSourceHash as q, legalUnitsOf as r, normaliseLegalText as s, occurrenceKey as t, parseLegalValue as u, planLegalRegistry as v, planStaleTranslations as w, statusAfterRun as x, unitText as y };
