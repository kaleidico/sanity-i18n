/**
 * The server side of the review workflow: publishing a translation under
 * the rule, and deciding on a legal unit (approve, send back) with the
 * effects that follow. Everything writes with the server token; who may ask
 * is checked in `runJob` before any of this runs.
 */
import {
  ENGINE_FIELD,
  MANIFEST_ID,
  readEngineSettings,
  type ApprovalOutcome,
} from "../core/engineModel";
import {
  applyLegalValue,
  checkTranslationForPublish,
  LEGAL_APPROVAL_TYPE,
  legalPathSegments,
  parseLegalValue,
  type LegalApproval,
  type LegalDecision,
  type LegalPathRecord,
  type LegalPerson,
  type LegalRecord,
} from "../core/legal";
import type { FieldManifest } from "../core/manifest";
import { getAtPath } from "../core/paths";
import { sha256Hex } from "../core/sha256";
import { I18N_FIELD, LANGUAGE_FIELD } from "../core/translations";
import { dependencyReasons, type TranslationDependency } from "../core/dependencies";
import { loadDependencies } from "./dependencies";
import { EngineError } from "./errors";
import type { SanityLike } from "./sanityHttp";

type Json = Record<string, unknown>;

const SYSTEM_FIELDS = ["_rev", "_createdAt", "_updatedAt", "_system", "_originalId"];

function publishedId(id: string): string {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}

/** The manifest the Studio keeps for the server. Null when it is not there. */
export async function readStoredManifest(sanity: SanityLike): Promise<FieldManifest | null> {
  const stored = await sanity.getDocument(MANIFEST_ID);
  if (typeof stored?.manifest !== "string") return null;
  try {
    const parsed = JSON.parse(stored.manifest) as FieldManifest;
    return parsed && typeof parsed === "object" && parsed.documents ? parsed : null;
  } catch {
    return null;
  }
}

async function loadEntries(sanity: SanityLike, ids: readonly string[]): Promise<Map<string, LegalApproval>> {
  const unique = [...new Set(ids)];
  const docs = unique.length > 0 ? await sanity.getDocuments(unique) : [];
  return new Map(docs.filter((d) => d._type === LEGAL_APPROVAL_TYPE).map((d) => [String(d._id), d as unknown as LegalApproval]));
}

function legalRecordOf(doc: Json): LegalRecord | null {
  const legal = (doc[I18N_FIELD] as { legal?: unknown } | undefined)?.legal;
  if (!legal || typeof legal !== "object") return null;
  const record = legal as Partial<LegalRecord>;
  return { pending: record.pending ?? 0, approved: record.approved ?? 0, paths: Array.isArray(record.paths) ? record.paths : [] };
}

export interface PublishTranslationOptions {
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

export interface PublishTranslationResult {
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
export async function publishTranslation(sanity: SanityLike, draftId: string, options: PublishTranslationOptions = {}): Promise<PublishTranslationResult> {
  const now = options.now ?? (() => new Date());
  if (!draftId.startsWith("drafts.")) return { published: false, reason: "Only a draft can be published." };
  const draft = await sanity.getDocument(draftId);
  if (!draft) return { published: false, reason: "There is no draft to publish." };
  const manifest = options.manifest === undefined ? await readStoredManifest(sanity) : options.manifest;
  if (!manifest) return { published: false, reason: "The server does not have the list of translatable fields yet. Open the Studio once and try again." };

  const record = legalRecordOf(draft);
  const entries = await loadEntries(sanity, (record?.paths ?? []).map((p) => p.unitId));
  const check = checkTranslationForPublish(draft, manifest, entries);
  const language = String(draft[LANGUAGE_FIELD] ?? "");
  const dependencies = language ? await loadDependencies(sanity, draft, language, manifest, options.requiredDependencyTypes) : [];
  const reasons = [...check.reasons, ...dependencyReasons(dependencies)];
  if (reasons.length > 0) return { published: false, reason: reasons.join(" "), dependencies };

  const id = publishedId(draftId);
  const published = JSON.parse(JSON.stringify(draft)) as Json;
  for (const field of SYSTEM_FIELDS) delete published[field];
  published._id = id;
  const i18n = { ...((published[I18N_FIELD] ?? {}) as Json) };
  delete i18n.staleSince;
  i18n.publishedAt = now().toISOString();
  published[I18N_FIELD] = i18n;
  await sanity.mutate([{ createOrReplace: published }, { delete: { id: draftId } }]);

  const dependentsPublished: string[] = [];
  if (options.publishDependents) {
    // Approved drafts in this language that refer to the source of what was just published were waiting for it.
    const sourceRef = ((draft[I18N_FIELD] as Json | undefined)?.source as { _ref?: string } | undefined)?._ref;
    if (sourceRef) {
      let waiting: string[] = [];
      try {
        waiting = await sanity.fetch<string[]>(
          `*[_id in path("drafts.**") && ${LANGUAGE_FIELD} == $language && ${I18N_FIELD}.status == "approved" && references($source)]._id`,
          { language, source: sourceRef },
        );
      } catch {
        // Housekeeping: the documents stay approved drafts and can be published by hand.
      }
      for (const waitingId of waiting ?? []) {
        if (waitingId === draftId) continue;
        const result = await publishTranslation(sanity, waitingId, { ...options, manifest, publishDependents: false });
        if (result.published && result.id) dependentsPublished.push(result.id);
      }
    }
  }
  return { published: true, id, dependencies, dependentsPublished };
}

// ── Decisions ────────────────────────────────────────────────────────────

export interface DecisionInput {
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

async function loadUnit(sanity: SanityLike, unitId: string): Promise<LegalApproval> {
  const entry = (await sanity.getDocument(unitId)) as LegalApproval | null;
  if (!entry || entry._type !== LEGAL_APPROVAL_TYPE) throw new EngineError("unit_not_found");
  if (entry.status !== "pending" && entry.status !== "sent_back") throw new EngineError("unit_not_pending");
  return entry;
}

function decision(status: LegalDecision["status"], entry: LegalApproval, by: LegalPerson, at: string, comment: string | undefined): LegalDecision {
  return {
    _key: sha256Hex(`${at}\n${status}\n${entry._id}\n${by.email ?? by.id ?? ""}`).slice(0, 12),
    status,
    decidedBy: by,
    decidedAt: at,
    sourceHash: entry.sourceHash,
    ...(comment ? { comment } : {}),
  };
}

function decisionPatch(entry: LegalApproval, status: "approved" | "sent_back", by: LegalPerson, at: string, comment: string | undefined): Json[] {
  const set: Json = { status, decidedBy: by, decidedAt: at, updatedAt: at };
  if (comment) set.comment = comment;
  return [
    { patch: { id: entry._id, set, unset: comment ? ["supersededBy"] : ["supersededBy", "comment"] } },
    { patch: { id: entry._id, setIfMissing: { history: [] } } },
    { patch: { id: entry._id, insert: { after: "history[-1]", items: [decision(status, entry, by, at, comment)] } } },
  ];
}

async function autoPublishSetting(input: DecisionInput): Promise<boolean> {
  if (typeof input.autoPublish === "boolean") return input.autoPublish;
  const settings = await input.sanity.fetch<Json | null>(
    `*[_type == $type && (${LANGUAGE_FIELD} == $lang || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))][0]`,
    { type: input.settingsType ?? "settings", lang: "en" },
  );
  return readEngineSettings(settings, input.engineField ?? ENGINE_FIELD).autoPublishMarketing;
}

/**
 * Approve a legal unit: record the decision, write the approved wording into
 * every occurrence's draft, recount each draft's legal record, and mark a
 * draft with nothing left pending Approved. With automatic publishing on,
 * a draft that becomes Approved is published under the rule.
 */
export async function approveUnit(input: DecisionInput): Promise<ApprovalOutcome> {
  const { sanity } = input;
  const now = (input.now ?? (() => new Date()))().toISOString();
  const entry = await loadUnit(sanity, input.unitId);
  const value = parseLegalValue(entry);
  const mutations: Json[] = decisionPatch(entry, "approved", input.decidedBy, now, input.comment);
  const outcome: ApprovalOutcome = { unitId: entry._id, status: "approved", translations: [] };
  const becameApproved: string[] = [];

  const draftIds = [...new Set((entry.occurrences ?? []).map((o) => `drafts.${o.documentId}`))];
  const drafts = draftIds.length > 0 ? await sanity.getDocuments(draftIds) : [];
  for (const draft of drafts) {
    const draftId = String(draft._id);
    const record = legalRecordOf(draft);
    if (!record) continue;
    const mine = record.paths.filter((p) => p.unitId === entry._id);
    if (mine.length === 0) continue;

    const set: Json = {};
    for (const path of mine) {
      if (value === null) continue;
      const segments = legalPathSegments(path.path);
      const copy = JSON.parse(JSON.stringify(draft)) as Json;
      if (applyLegalValue(copy, segments, value)) set[path.path] = getAtPath(copy, segments);
    }
    const paths: LegalPathRecord[] = record.paths.map((p) => (p.unitId === entry._id ? { ...p, status: "approved" } : p));
    const pending = paths.filter((p) => p.status === "pending").length;
    const approved = paths.filter((p) => p.status === "approved").length;
    set[`${I18N_FIELD}.legal`] = { pending, approved, paths };

    const i18n = (draft[I18N_FIELD] ?? {}) as Json;
    const held = (i18n.report as { held?: unknown } | undefined)?.held === true;
    let status = String(i18n.status ?? "draft");
    if (pending === 0 && !held && status !== "approved") {
      status = "approved";
      set[`${I18N_FIELD}.status`] = status;
      set[`${I18N_FIELD}.approvedAt`] = now;
      set[`${I18N_FIELD}.approvedBy`] = input.decidedBy.name || input.decidedBy.email || input.decidedBy.id || "Legal approver";
      becameApproved.push(draftId);
    }
    mutations.push({ patch: { id: draftId, set } });
    outcome.translations.push({ documentId: publishedId(draftId), status, published: false });
  }

  await sanity.mutate(mutations);

  if (becameApproved.length > 0 && (await autoPublishSetting(input))) {
    const manifest = input.manifest === undefined ? await readStoredManifest(sanity) : input.manifest;
    for (const draftId of becameApproved) {
      const result = await publishTranslation(sanity, draftId, { manifest, now: input.now, publishDependents: true, requiredDependencyTypes: input.requiredDependencyTypes });
      const row = outcome.translations.find((t) => t.documentId === publishedId(draftId));
      if (row) {
        row.published = result.published;
        if (result.reason) row.note = result.reason;
      }
    }
  }
  return outcome;
}

/** Send a legal unit back with a comment. The translations that carry it stay held; nothing else changes. */
export async function sendBackUnit(input: DecisionInput): Promise<ApprovalOutcome> {
  const comment = (input.comment ?? "").trim();
  if (comment === "") throw new EngineError("comment_required");
  const entry = await loadUnit(input.sanity, input.unitId);
  const now = (input.now ?? (() => new Date()))().toISOString();
  await input.sanity.mutate(decisionPatch(entry, "sent_back", input.decidedBy, now, comment));
  return {
    unitId: entry._id,
    status: "sent_back",
    translations: [...new Set((entry.occurrences ?? []).map((o) => o.documentId))].map((documentId) => ({ documentId, status: "awaiting_approval", published: false })),
  };
}
