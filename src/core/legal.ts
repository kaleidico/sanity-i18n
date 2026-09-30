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
import type { FieldManifest } from "./manifest";
import { getAtPath, parsePath, setAtPath, type PathSegment } from "./paths";
import {
  blockText,
  diffSource,
  extractUnits,
  readUnit,
  type PrunedBlock,
  type TranslationUnit,
  type UnitKind,
  type UnitValue,
} from "./payload";
import { sha256Hex } from "./sha256";
import { I18N_FIELD, LANGUAGE_FIELD, translationMetaId, translationStatusLabel, type TranslationLabels } from "./translations";

type Json = Record<string, unknown>;

export const LEGAL_APPROVAL_TYPE = "i18n.legalApproval";
export const LEGAL_APPROVAL_ID_PREFIX = "i18n-legal-";

export type LegalApprovalStatus = "pending" | "approved" | "sent_back" | "superseded";

/** Who made a decision, as the Studio knows the signed-in user. */
export interface LegalPerson {
  id?: string;
  name?: string;
  email?: string;
}

/** One place a legal unit appears: a translation document and the path inside it. */
export interface LegalOccurrence {
  _key: string;
  /** The published id of the translation document (the draft is `drafts.` + this). */
  documentId: string;
  documentType: string;
  path: string;
}

/** One line of a unit's history: every decision ever made on it, and every new proposal. */
export interface LegalDecision {
  _key: string;
  status: LegalApprovalStatus;
  decidedBy?: LegalPerson;
  decidedAt: string;
  comment?: string;
  /** The English the decision was made on. */
  sourceHash: string;
}

export interface LegalApproval {
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
export interface LegalPathRecord {
  _key: string;
  path: string;
  unitId: string;
  sourceHash: string;
  status: "pending" | "approved";
}

export interface LegalRecord {
  pending: number;
  approved: number;
  paths: LegalPathRecord[];
}

// ── Hashing and ids ──────────────────────────────────────────────────────

/** Trimmed, with every run of whitespace collapsed to one space. */
export function normaliseLegalText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** SHA-256 of the normalised English text, 64 hex characters. */
export function legalSourceHash(text: string): string {
  return sha256Hex(normaliseLegalText(text));
}

/** `i18n-legal-<language>-<hash12>`. Deterministic, so the same English in the same language is always one entry. */
export function legalApprovalId(language: string, sourceHash: string): string {
  return `${LEGAL_APPROVAL_ID_PREFIX}${language}-${sourceHash.slice(0, 12)}`;
}

/** The readable text of a unit value: the string, the list joined by line breaks, or the block's spans. */
export function unitText(value: UnitValue): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join("\n");
  return blockText(value);
}

export function occurrenceKey(documentId: string, path: string): string {
  return sha256Hex(`${documentId}\n${path}`).slice(0, 12);
}

/** The legal units of a document, in document order. */
export function legalUnitsOf(doc: Json, manifest: FieldManifest, typeName?: string): TranslationUnit[] {
  return extractUnits(doc, manifest, typeName).filter((unit) => unit.legal);
}

function publishedId(id: string): string {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse a stored `translatedValue`. Null when it cannot be read. */
export function parseLegalValue(entry: Pick<LegalApproval, "translatedValue" | "translatedText" | "kind">): UnitValue | null {
  try {
    const parsed = JSON.parse(entry.translatedValue) as unknown;
    if (entry.kind === "text" && typeof parsed === "string") return parsed;
    if (entry.kind === "list" && Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed as string[];
    if (entry.kind === "block" && isObject(parsed) && Array.isArray(parsed.children)) return parsed as unknown as PrunedBlock;
  } catch {
    // Fall through: a text unit can still be rebuilt from the readable text.
  }
  return entry.kind === "text" ? entry.translatedText : null;
}

/**
 * Write a legal value into a document at a path. A string or a list replaces
 * the value. A Portable Text block keeps the target block's spans and marks:
 * span by span when the approved block has the same number of text spans,
 * else the whole approved text goes into the first text span and the others
 * are emptied, so the approved wording is what shows.
 */
export function applyLegalValue(target: Json, segments: readonly PathSegment[], value: UnitValue): boolean {
  if (typeof value === "string" || Array.isArray(value)) return setAtPath(target, segments, JSON.parse(JSON.stringify(value)));
  const block = getAtPath(target, segments);
  if (!isObject(block) || !Array.isArray(block.children)) return false;
  const spans = (block.children as unknown[]).filter((c): c is Json => isObject(c) && c._type === "span");
  const approved = value.children.filter((c) => c._type === "span" && typeof c.text === "string");
  if (spans.length === 0) return false;
  if (spans.length === approved.length) {
    spans.forEach((span, i) => {
      span.text = approved[i].text;
    });
    return true;
  }
  spans.forEach((span, i) => {
    span.text = i === 0 ? blockText(value) : "";
  });
  return true;
}

// ── The engine hook: reconcile a translation with the registry ──────────

export interface LegalPlanInput {
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

export interface LegalPlan {
  /** Raw Sanity mutations that bring the registry up to date. Apply them together with the translation. */
  mutations: Json[];
  legal: LegalRecord;
}

const NEW_PROPOSAL = "Proposed by a translation run";

/** An idempotent "add this occurrence" patch: remove any copy first, then append. */
function occurrencePatch(id: string, occurrence: LegalOccurrence): Json[] {
  return [
    { patch: { id, setIfMissing: { occurrences: [] } } },
    { patch: { id, unset: [`occurrences[_key == ${JSON.stringify(occurrence._key)}]`] } },
    { patch: { id, insert: { after: "occurrences[-1]", items: [occurrence] } } },
  ];
}

function historyPatch(id: string, decision: LegalDecision): Json[] {
  return [
    { patch: { id, setIfMissing: { history: [] } } },
    { patch: { id, insert: { after: "history[-1]", items: [decision] } } },
  ];
}

function decisionKey(now: string, status: string, seed: string): string {
  return sha256Hex(`${now}\n${status}\n${seed}`).slice(0, 12);
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
export function planLegalRegistry(input: LegalPlanInput): LegalPlan {
  const mutations: Json[] = [];
  const paths: LegalPathRecord[] = [];
  let pending = 0;
  let approved = 0;

  for (const unit of input.units) {
    const proposal = readUnit(input.translation, unit);
    if (proposal === undefined) continue;
    const sourceText = unitText(unit.value);
    const sourceHash = legalSourceHash(sourceText);
    const id = legalApprovalId(input.language, sourceHash);
    const occurrence: LegalOccurrence = {
      _key: occurrenceKey(input.documentId, unit.path),
      documentId: input.documentId,
      documentType: input.documentType,
      path: unit.path,
    };
    const entry = input.entries.get(id);
    let status: LegalPathRecord["status"] = "pending";

    if (!entry) {
      const decision: LegalDecision = {
        _key: decisionKey(input.now, "pending", id),
        status: "pending",
        decidedAt: input.now,
        sourceHash,
        comment: input.note ?? NEW_PROPOSAL,
        ...(input.by ? { decidedBy: input.by } : {}),
      };
      const doc: LegalApproval = {
        _id: id,
        _type: LEGAL_APPROVAL_TYPE,
        language: input.language,
        sourceHash,
        sourceText,
        kind: unit.kind,
        translatedText: unitText(proposal),
        translatedValue: JSON.stringify(proposal),
        status: "pending",
        occurrences: [],
        history: [decision],
        createdAt: input.now,
        updatedAt: input.now,
      };
      // createIfNotExists, so two runs that meet the same new text at once both keep their occurrence.
      mutations.push({ createIfNotExists: doc }, ...occurrencePatch(id, occurrence));
    } else if (entry.status === "approved") {
      const value = parseLegalValue(entry);
      if (value !== null) applyLegalValue(input.translation, unit.segments, value);
      status = "approved";
      mutations.push(...occurrencePatch(id, occurrence));
    } else if (entry.status === "pending") {
      const value = parseLegalValue(entry);
      if (value !== null) applyLegalValue(input.translation, unit.segments, value);
      mutations.push(...occurrencePatch(id, occurrence));
    } else {
      // Sent back, or superseded by an English change that has since been reverted: a fresh proposal, pending again.
      const decision: LegalDecision = {
        _key: decisionKey(input.now, "pending", id),
        status: "pending",
        decidedAt: input.now,
        sourceHash,
        comment: input.note ?? NEW_PROPOSAL,
        ...(input.by ? { decidedBy: input.by } : {}),
      };
      mutations.push(
        {
          patch: {
            id,
            set: { status: "pending", translatedText: unitText(proposal), translatedValue: JSON.stringify(proposal), updatedAt: input.now },
            unset: ["decidedBy", "decidedAt", "comment", "supersededBy"],
          },
        },
        ...historyPatch(id, decision),
        ...occurrencePatch(id, occurrence),
      );
    }

    if (status === "approved") approved++;
    else pending++;
    paths.push({ _key: sha256Hex(unit.path).slice(0, 12), path: unit.path, unitId: id, sourceHash, status });
  }

  return { mutations, legal: { pending, approved, paths } };
}

/** The translation status a finished run gives a draft: held stays a draft, pending legal text waits, otherwise approved. */
export function statusAfterRun(held: boolean, legal: LegalRecord): "draft" | "awaiting_approval" | "approved" {
  if (held) return "draft";
  return legal.pending > 0 ? "awaiting_approval" : "approved";
}

// ── The publish rule ─────────────────────────────────────────────────────

export interface PublishCheck {
  ok: boolean;
  /** Plain reasons a person can act on. Empty when ok. */
  reasons: string[];
}

export interface PublishCheckOptions {
  labels?: TranslationLabels;
}

function readLegalRecord(doc: Json): LegalRecord | null {
  const legal = (doc[I18N_FIELD] as { legal?: unknown } | undefined)?.legal;
  if (!isObject(legal)) return null;
  return {
    pending: typeof legal.pending === "number" ? legal.pending : 0,
    approved: typeof legal.approved === "number" ? legal.approved : 0,
    paths: Array.isArray(legal.paths) ? (legal.paths as LegalPathRecord[]) : [],
  };
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
export function checkTranslationForPublish(
  doc: Json,
  manifest: FieldManifest | null,
  entries: ReadonlyMap<string, Pick<LegalApproval, "status" | "translatedText">>,
  options: PublishCheckOptions = {},
): PublishCheck {
  const reasons: string[] = [];
  const i18n = (doc[I18N_FIELD] ?? {}) as Json;
  const status = typeof i18n.status === "string" ? i18n.status : "draft";
  if (status !== "approved") {
    reasons.push(`The translation is ${translationStatusLabel(status, options.labels)}, not ${translationStatusLabel("approved", options.labels)}.`);
  }
  if ((i18n.report as { held?: unknown } | undefined)?.held === true) {
    reasons.push("The translation is held for a person to look at; see the translation report.");
  }
  const record = readLegalRecord(doc);
  if (record && record.pending > 0) {
    reasons.push(`${record.pending} piece(s) of legal text are waiting for approval.`);
  }
  for (const path of record?.paths ?? []) {
    const entry = entries.get(path.unitId);
    if (!entry || entry.status !== "approved") {
      reasons.push(`Legal text at ${path.path} is ${entry ? entry.status.replace("_", " ") : "not in the approval queue"}.`);
    }
  }
  if (manifest) {
    const units = legalUnitsOf(doc, manifest);
    for (const unit of units) {
      const path = record?.paths.find((p) => p.path === unit.path);
      if (!path) {
        reasons.push(`Legal text at ${unit.path} has not been through the approval queue.`);
        continue;
      }
      const entry = entries.get(path.unitId);
      if (!entry || entry.status !== "approved") continue; // Already reported above.
      if (normaliseLegalText(entry.translatedText) !== normaliseLegalText(unitText(unit.value))) {
        reasons.push(`Legal text at ${unit.path} differs from the approved wording.`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

// ── Re-lock when the English changes ────────────────────────────────────

export interface StaleTranslationInput {
  /** The published translation, if there is one. */
  published?: Json | null;
  /** The draft of the translation, if there is one. */
  draft?: Json | null;
}

export interface StalePlanInput {
  /** The English document as just published. */
  source: Json;
  translations: readonly StaleTranslationInput[];
  manifest: FieldManifest;
  now: string;
  /** Ids of the metadata documents that exist. The metadata document is only patched when its id is listed here, so a patch is never sent to a missing one. */
  metaIds?: ReadonlySet<string>;
}

export interface StaleMark {
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

export interface StalePlan {
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
export function planStaleTranslations(input: StalePlanInput): StalePlan {
  const mutations: Json[] = [];
  const marks: StaleMark[] = [];
  const sourceUnits = extractUnits(input.source, input.manifest);
  const legalByPath = new Map(sourceUnits.filter((u) => u.legal).map((u) => [u.path, u]));
  const sourceId = publishedId(String(input.source._id ?? ""));
  const metaId = translationMetaId(sourceId);
  const touchedLanguages: string[] = [];

  for (const t of input.translations) {
    const current = t.draft ?? t.published;
    if (!current) continue;
    const i18n = (current[I18N_FIELD] ?? {}) as Json;
    if (!Array.isArray(i18n.sourceHashes)) continue;
    const diff = diffSource(input.source, current, input.manifest);
    if (diff.upToDate) continue;

    const id = publishedId(String(current._id ?? ""));
    const language = String(current[LANGUAGE_FIELD] ?? "");
    const draftId = `drafts.${id}`;
    const legalChanged = [...diff.changed, ...diff.added].filter((path) => legalByPath.has(path));
    const status: StaleMark["status"] = legalChanged.length > 0 ? "awaiting_approval" : "needs_update";
    const alreadyStale = typeof i18n.staleSince === "string";
    const superseded: string[] = [];

    if (!t.draft && t.published) {
      const copy = JSON.parse(JSON.stringify(t.published)) as Json;
      for (const field of ["_rev", "_createdAt", "_updatedAt"]) delete copy[field];
      mutations.push({ createIfNotExists: { ...copy, _id: draftId } });
    }
    mutations.push({ patch: { id: draftId, set: { [`${I18N_FIELD}.status`]: status, [`${I18N_FIELD}.staleSince`]: input.now } } });

    if (!alreadyStale) {
      const record = readLegalRecord(current);
      for (const path of legalChanged) {
        const stored = record?.paths.find((p) => p.path === path);
        const unit = legalByPath.get(path);
        if (!stored || !unit) continue;
        const newHash = legalSourceHash(unitText(unit.value));
        if (newHash === stored.sourceHash) continue;
        superseded.push(stored.unitId);
        mutations.push(
          { patch: { id: stored.unitId, set: { status: "superseded", supersededBy: newHash, updatedAt: input.now } } },
          ...historyPatch(stored.unitId, {
            _key: decisionKey(input.now, "superseded", stored.unitId),
            status: "superseded",
            decidedAt: input.now,
            sourceHash: stored.sourceHash,
            comment: `The English wording changed in ${sourceId}.`,
          }),
        );
      }
    }

    if (language && !touchedLanguages.includes(language)) touchedLanguages.push(language);
    marks.push({ id, language, status, legalChanged, superseded, draftCreated: !t.draft && !!t.published });
  }

  if (marks.length > 0 && input.metaIds?.has(metaId)) {
    const set: Json = { staleSince: input.now };
    for (const language of touchedLanguages) set[`translations[_key == ${JSON.stringify(language)}].staleSince`] = input.now;
    mutations.push({ patch: { id: metaId, set } });
  }

  return { mutations, marks };
}

/** Segments for a stored path, for callers that only have the string. */
export function legalPathSegments(path: string): PathSegment[] {
  return parsePath(path);
}
