/**
 * What the Studio and the server agree on for the translation engine: the
 * private documents, the settings fields, the job and the report. No Sanity
 * or Node import, so both sides share it.
 */
import type { CheckFinding } from "./check";
import { DEFAULT_REVIEWER_MODEL, DEFAULT_TRANSLATOR_MODEL } from "./pricing";

// ── Private documents ───────────────────────────────────────────────────
// Every id below has a period in it on purpose. Sanity never returns such a
// document to a request without a token, so none of them is public even on a
// public dataset.

/** The document that holds the encrypted API key. */
export const SECRETS_ID = "i18n.secrets";
export const SECRETS_TYPE = "i18n.secrets";

/** The document the Studio keeps the field manifest in, for the server to read. */
export const MANIFEST_ID = "i18n.manifest";
export const MANIFEST_TYPE = "i18n.manifest";

export const JOB_TYPE = "i18n.job";
export const JOB_ID_PREFIX = "i18n.job.";

export function jobId(uuid: string): string {
  return JOB_ID_PREFIX + uuid;
}

/** The document types the engine adds. Desks and "new document" menus should leave them out. */
export const ENGINE_DOCUMENT_TYPES = [SECRETS_TYPE, MANIFEST_TYPE, JOB_TYPE] as const;

export interface StoredSecret {
  /** RSA-OAEP ciphertext of the API key, base64. */
  ciphertext: string;
  /** The last four characters of the key, to recognise it by. */
  last4: string;
  savedAt: string;
  savedBy?: string;
  /** Short fingerprint of the public key the ciphertext was made with. */
  keyFingerprint: string;
}

// ── Settings fields ─────────────────────────────────────────────────────

export const GLOSSARY_FIELD = "i18nGlossary";
export const STYLE_GUIDE_FIELD = "i18nStyleGuide";
export const ENGINE_FIELD = "i18nEngine";
export const API_KEY_FIELD = "i18nApiKey";

/** The settings fields the engine adds. On a translatable settings type they belong in `sharedFields`. */
export const ENGINE_SETTINGS_FIELDS = [GLOSSARY_FIELD, STYLE_GUIDE_FIELD, ENGINE_FIELD, API_KEY_FIELD] as const;

export interface GlossaryTerm {
  source: string;
  target: string;
  note?: string;
}

export interface Glossary {
  doNotTranslate: string[];
  terms: GlossaryTerm[];
}

export type Register = "usted" | "tu";

export interface StyleGuide {
  /** The market the translation is for, e.g. `es-US`. */
  market: string;
  register: Register;
  audience: string;
  notes: string;
}

export interface EngineSettings {
  translatorModel: string;
  reviewerModel: string;
  /** Reserved for the review workflow. The engine never publishes. */
  autoPublishMarketing: boolean;
}

export const DEFAULT_STYLE_GUIDE: StyleGuide = { market: "es-US", register: "usted", audience: "", notes: "" };
export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  translatorModel: DEFAULT_TRANSLATOR_MODEL,
  reviewerModel: DEFAULT_REVIEWER_MODEL,
  autoPublishMarketing: false,
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The glossary as stored in Site Settings, tidied: blanks dropped, duplicates removed. */
export function readGlossary(settings: Record<string, unknown> | null | undefined, field: string = GLOSSARY_FIELD): Glossary {
  const raw = (settings?.[field] ?? {}) as { doNotTranslate?: unknown; terms?: unknown };
  const doNotTranslate = Array.isArray(raw.doNotTranslate)
    ? [...new Set(raw.doNotTranslate.map(text).filter((t) => t !== ""))]
    : [];
  const terms: GlossaryTerm[] = [];
  if (Array.isArray(raw.terms)) {
    for (const entry of raw.terms) {
      const e = (entry ?? {}) as Record<string, unknown>;
      const source = text(e.source);
      const target = text(e.target);
      if (source === "" || target === "") continue;
      const note = text(e.note);
      terms.push(note ? { source, target, note } : { source, target });
    }
  }
  return { doNotTranslate, terms };
}

export function readStyleGuide(settings: Record<string, unknown> | null | undefined, field: string = STYLE_GUIDE_FIELD): StyleGuide {
  const raw = (settings?.[field] ?? {}) as Record<string, unknown>;
  return {
    market: text(raw.market) || DEFAULT_STYLE_GUIDE.market,
    register: raw.register === "tu" ? "tu" : "usted",
    audience: text(raw.audience),
    notes: text(raw.notes),
  };
}

export function readEngineSettings(settings: Record<string, unknown> | null | undefined, field: string = ENGINE_FIELD): EngineSettings {
  const raw = (settings?.[field] ?? {}) as Record<string, unknown>;
  return {
    translatorModel: text(raw.translatorModel) || DEFAULT_ENGINE_SETTINGS.translatorModel,
    reviewerModel: text(raw.reviewerModel) || DEFAULT_ENGINE_SETTINGS.reviewerModel,
    autoPublishMarketing: raw.autoPublishMarketing === true,
  };
}

// ── Jobs and reports ────────────────────────────────────────────────────

export type JobKind = "translate" | "estimate";
export type JobMode = "full" | "changes";
export type JobStatus = "pending" | "running" | "done" | "held" | "failed";

export interface ReviewIssue {
  path: string;
  severity: "high" | "medium" | "low";
  category: "meaning" | "omission" | "addition" | "tone" | "terminology" | "legal";
  note: string;
}

export interface CallUsage {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TranslationReport {
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
}

export interface CostEstimate {
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

export interface JobError {
  code: string;
  /** Plain words a person can act on. */
  message: string;
  /** Extra detail that is safe to show, such as the paths that did not match. */
  details?: string[];
}

export interface TranslationJob {
  _id: string;
  _type: typeof JOB_TYPE;
  _rev?: string;
  kind: JobKind;
  /** The source document of a translation job. */
  sourceId?: string;
  sourceType?: string;
  /** The source documents of an estimate job. */
  sourceIds?: string[];
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
  error?: JobError;
}

// ── Translation documents ───────────────────────────────────────────────

/** The id of a translation: `<sourceId>-<language>`. Singletons follow the same rule (`settings-es`, `homepage-es`). */
export function translationId(sourceId: string, language: string): string {
  const published = sourceId.startsWith("drafts.") ? sourceId.slice("drafts.".length) : sourceId;
  return `${published}-${language}`;
}

/**
 * A URL-safe slug: lower case, accents removed, anything that is not a
 * letter or a digit turned into a single hyphen.
 */
export function toSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

// ── Key storage ─────────────────────────────────────────────────────────

function fromBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A short fingerprint of a public key (SPKI, base64), to tell which key pair a ciphertext belongs to. */
export async function publicKeyFingerprint(publicKey: string): Promise<string> {
  return (await sha256Bytes(fromBase64(publicKey))).slice(0, 16);
}

/**
 * Encrypt a secret with the site's public key (RSA-OAEP, SHA-256). Runs in
 * the browser with WebCrypto. Only the server's private key can read the
 * result, so nothing the browser stores or the dataset holds can be turned
 * back into the secret.
 */
export async function encryptSecret(publicKey: string, secret: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "spki",
    fromBase64(publicKey) as BufferSource,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const encrypted = await globalThis.crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(secret));
  return toBase64(new Uint8Array(encrypted));
}

export { fromBase64 as base64ToBytes, toBase64 as bytesToBase64 };
