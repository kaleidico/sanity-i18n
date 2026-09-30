/**
 * What the Studio does for the engine: keep the field manifest current,
 * create a job, tell the server about it and watch it finish. Everything is
 * done with the editor's own session, so an editor can start exactly the
 * work they are allowed to write.
 */
import { useEffect, useState } from "react";
import type { SanityClient } from "sanity";
import {
  JOB_TYPE,
  jobId,
  LEGAL_APPROVERS_FIELD,
  MANIFEST_ID,
  MANIFEST_TYPE,
  readLegalApprovers,
  type JobKind,
  type JobMode,
  type TranslationJob,
} from "../core/engineModel";
import { readEnabledLanguages, type LanguagesConfig } from "../core/languages";
import { buildFieldManifest, type CompiledSchemaLike, type FieldManifest } from "../core/manifest";
import { sha256Hex } from "../core/sha256";
import { LANGUAGE_FIELD } from "../core/translations";

export const DEFAULT_ENDPOINT = "/api/i18n/translate";
export const DEFAULT_APPROVE_ENDPOINT = "/api/i18n/approve";

export interface StudioEngineOptions {
  languages: LanguagesConfig;
  translatableTypes: readonly string[];
  /** Where the site mounts `createTranslateRoute()`. Defaults to `/api/i18n/translate`. */
  endpoint?: string;
  /** Where the site mounts `createApprovalRoute()`. Defaults to `/api/i18n/approve`. */
  approveEndpoint?: string;
  /** The Site Settings document type. Defaults to `settings`. */
  settingsType?: string;
  /** Name of the languages field on Site Settings. Defaults to `languages`. */
  languagesField?: string;
  /** Name of the legal approvers field on Site Settings. Defaults to `i18nLegalApprovers`. */
  legalApproversField?: string;
  /** How many translations the Translations tool runs at once. Defaults to 2. */
  concurrency?: number;
}

/**
 * Build the manifest from the Studio's schema and store it for the server
 * when it changed. Called before every job, so the server always works from
 * the schema the editor is looking at.
 */
export async function ensureManifest(
  client: SanityClient,
  schema: CompiledSchemaLike,
  options: Pick<StudioEngineOptions, "languages" | "translatableTypes">,
): Promise<FieldManifest> {
  const manifest = buildFieldManifest(schema, options.translatableTypes, { defaultLanguage: options.languages.defaultLanguage.id });
  const serialised = JSON.stringify(manifest);
  const hash = sha256Hex(serialised);
  const stored = await client.fetch<string | null>(`*[_id == $id][0].hash`, { id: MANIFEST_ID });
  if (stored !== hash) {
    await client.createOrReplace({ _id: MANIFEST_ID, _type: MANIFEST_TYPE, hash, manifest: serialised, updatedAt: new Date().toISOString() });
  }
  return manifest;
}

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface NewJob {
  kind: JobKind;
  language: string;
  mode?: JobMode;
  sourceId?: string;
  sourceType?: string;
  sourceIds?: string[];
  requestedBy?: string;
  unitId?: string;
  comment?: string;
  approver?: { id?: string; name?: string; email?: string };
}

/** Create a pending job document and return its id. */
export async function createJob(client: SanityClient, job: NewJob): Promise<string> {
  const id = jobId(uuid());
  await client.create({
    _id: id,
    _type: JOB_TYPE,
    status: "pending",
    createdAt: new Date().toISOString(),
    mode: job.mode ?? "full",
    ...job,
  });
  return id;
}

/**
 * Tell the server a job is waiting. The answer arrives when the job is
 * finished, which can take minutes, so callers watch the job document rather
 * than wait on this. It resolves to a plain message when the server could
 * not take the job at all, and to null otherwise.
 */
export async function startJob(endpoint: string, id: string): Promise<string | null> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: id }),
    });
    if (response.ok) return null;
    if (response.status === 404 || response.status === 405) {
      return `The translation service was not found at ${endpoint}. A developer needs to add the route to the site.`;
    }
    if (response.status === 504 || response.status === 408) return null;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) return body.error.message;
    } catch {
      // Not JSON: fall through to the general message.
    }
    return "The translation service could not start the job. Try again in a moment.";
  } catch {
    // A dropped connection says nothing about the job, which may still be running.
    return null;
  }
}

const FINAL = new Set(["done", "held", "failed"]);

export function isFinished(job: Pick<TranslationJob, "status"> | null | undefined): boolean {
  return !!job && FINAL.has(job.status);
}

/** Read a job until it is finished, reporting each state on the way. Gives up after `timeoutMs` and returns the last state. */
export async function watchJob(
  client: SanityClient,
  id: string,
  onUpdate: (job: TranslationJob) => void,
  options: { intervalMs?: number; timeoutMs?: number; cancelled?: () => boolean } = {},
): Promise<TranslationJob | null> {
  const started = Date.now();
  const interval = options.intervalMs ?? 2000;
  const timeout = options.timeoutMs ?? 6 * 60 * 1000;
  let last: TranslationJob | null = null;
  while (!options.cancelled?.()) {
    try {
      const job = (await client.getDocument(id)) as TranslationJob | undefined;
      if (job) {
        last = job;
        onUpdate(job);
        if (isFinished(job)) return job;
      }
    } catch {
      // A failed read is tried again on the next tick.
    }
    if (Date.now() - started > timeout) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return last;
}

/** The ids of the languages switched on in Site Settings, default first. Null while loading. */
export function useEnabledLanguageIds(client: SanityClient, options: StudioEngineOptions): string[] | null {
  const [ids, setIds] = useState<string[] | null>(null);
  const defaultId = options.languages.defaultLanguage.id;
  const settingsType = options.settingsType ?? "settings";
  const fieldName = options.languagesField ?? "languages";

  useEffect(() => {
    let alive = true;
    client
      .fetch<Record<string, unknown> | null>(
        `*[_type == $type && (${LANGUAGE_FIELD} == $lang || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))][0]{ ${JSON.stringify(fieldName)}: ${fieldName} }`,
        { type: settingsType, lang: defaultId },
      )
      .then((settings) => {
        if (alive) setIds(readEnabledLanguages(settings, options.languages, { fieldName }).map((l) => l.id));
      })
      .catch(() => {
        if (alive) setIds([defaultId]);
      });
    return () => {
      alive = false;
    };
  }, [client, defaultId, settingsType, fieldName, options.languages]);

  return ids;
}

/** The legal approver emails from Site Settings, lower case. Null while loading. */
export function useLegalApprovers(client: SanityClient, options: Pick<StudioEngineOptions, "settingsType" | "legalApproversField" | "languages">): string[] | null {
  const [approvers, setApprovers] = useState<string[] | null>(null);
  const defaultId = options.languages.defaultLanguage.id;
  const settingsType = options.settingsType ?? "settings";
  const fieldName = options.legalApproversField ?? LEGAL_APPROVERS_FIELD;

  useEffect(() => {
    let alive = true;
    client
      .fetch<Record<string, unknown> | null>(
        `*[_type == $type && (${LANGUAGE_FIELD} == $lang || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))][0]{ ${JSON.stringify(fieldName)}: ${fieldName} }`,
        { type: settingsType, lang: defaultId },
      )
      .then((settings) => {
        if (alive) setApprovers(readLegalApprovers(settings, fieldName));
      })
      .catch(() => {
        if (alive) setApprovers([]);
      });
    return () => {
      alive = false;
    };
  }, [client, defaultId, settingsType, fieldName]);

  return approvers;
}

export function formatDollars(amount: number): string {
  if (amount > 0 && amount < 0.01) return "less than $0.01";
  return `$${amount.toFixed(2)}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
