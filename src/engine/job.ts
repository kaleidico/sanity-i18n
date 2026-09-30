/**
 * Running a job. A job is a private document the Studio creates with the
 * editor's own session; the server does work only for a job it can load with
 * its token and that is still pending. So the right to start a translation
 * is exactly the right to write to the dataset, and a caller without it has
 * nothing to send.
 */
import {
  JOB_TYPE,
  MANIFEST_ID,
  readEngineSettings,
  readGlossary,
  readStyleGuide,
  translationId,
  ENGINE_FIELD,
  GLOSSARY_FIELD,
  STYLE_GUIDE_FIELD,
  type CostEstimate,
  type JobStatus,
  type TranslationJob,
  type TranslationReport,
} from "../core/engineModel";
import { defineLanguages, readEnabledLanguages, type LanguagesInput } from "../core/languages";
import type { FieldManifest } from "../core/manifest";
import { I18N_FIELD, LANGUAGE_FIELD, TRANSLATION_META_TYPE, translationMetaId } from "../core/translations";
import { countTokens, createAnthropicClient, type AnthropicLike, type CallPolicy, type Effort } from "./anthropic";
import { reportForStorage, translateDocument } from "./document";
import { asEngineError, EngineError } from "./errors";
import { estimateCost, type TokenCounter } from "./estimate";
import { createSanityHttp, type SanityHttpConfig, type SanityLike } from "./sanityHttp";
import { loadApiKey } from "./secrets";

type Json = Record<string, unknown>;

export interface EngineConfig {
  /** How to reach the dataset: project, dataset and a read and write token. */
  sanity: SanityHttpConfig | SanityLike;
  /** The languages the site can offer, the same list the Studio plugin gets. */
  languages: LanguagesInput;
  /** The private key (PKCS8, base64). Defaults to the `I18N_PRIVATE_KEY` environment variable. */
  privateKey?: string;
  /** The public key (SPKI, base64). Defaults to `NEXT_PUBLIC_I18N_PUBLIC_KEY`. Only used to explain a key pair mismatch. */
  publicKey?: string;
  /** Where the glossary, style guide and engine settings live. Defaults to the `settings` type and the package's field names. */
  settings?: { type?: string; glossaryField?: string; styleGuideField?: string; engineField?: string; languagesField?: string };
  /** The field manifest. Defaults to the one the Studio keeps in the private `i18n.manifest` document. */
  manifest?: FieldManifest;
  /** Build the Anthropic client for a key. Defaults to the real SDK client; tests pass a fake. */
  anthropic?: (apiKey: string) => AnthropicLike;
  /** Refuse a language that is switched off in Site Settings. Defaults to true. */
  requireEnabledLanguage?: boolean;
  effort?: { translator?: Effort; reviewer?: Effort };
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

export interface JobOutcome {
  /** The HTTP status the route answers with. */
  httpStatus: number;
  ok: boolean;
  status?: JobStatus;
  error?: { code: string; message: string };
}

function isSanityLike(value: EngineConfig["sanity"]): value is SanityLike {
  return typeof (value as SanityLike).getDocument === "function";
}

export function resolveSanity(config: EngineConfig): SanityLike {
  return isSanityLike(config.sanity) ? config.sanity : createSanityHttp(config.sanity);
}

function publishedId(id: string): string {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}

async function loadManifest(config: EngineConfig, sanity: SanityLike): Promise<FieldManifest> {
  if (config.manifest) return config.manifest;
  const stored = await sanity.getDocument(MANIFEST_ID);
  if (typeof stored?.manifest === "string") {
    try {
      const parsed = JSON.parse(stored.manifest) as FieldManifest;
      if (parsed && typeof parsed === "object" && parsed.documents) return parsed;
    } catch {
      // Fall through to the plain message below.
    }
  }
  throw new EngineError("manifest_missing");
}

async function loadSettings(config: EngineConfig, sanity: SanityLike, defaultId: string): Promise<Json | null> {
  return sanity.fetch<Json | null>(
    `*[_type == $type && (${LANGUAGE_FIELD} == $lang || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))][0]`,
    { type: config.settings?.type ?? "settings", lang: defaultId },
  );
}

async function uniqueSlug(sanity: SanityLike, type: string, language: string, slugField: string, slug: string, ownId: string): Promise<string> {
  const taken = await sanity.fetch<string[]>(
    `*[_type == $type && ${LANGUAGE_FIELD} == $lang && !(_id in [$id, $draft]) && string::startsWith(${slugField}.current, $slug)].${slugField}.current`,
    { type, lang: language, id: ownId, draft: `drafts.${ownId}`, slug },
  );
  const used = new Set(taken ?? []);
  if (!used.has(slug)) return slug;
  for (let n = 2; n < 1000; n++) if (!used.has(`${slug}-${n}`)) return `${slug}-${n}`;
  return `${slug}-${Date.now()}`;
}

const weakRef = (id: string) => ({ _type: "reference", _ref: id, _weak: true });

async function metaMutation(sanity: SanityLike, sourceId: string, sourceType: string, defaultId: string, language: string, targetId: string): Promise<Json | null> {
  const id = translationMetaId(sourceId);
  const existing = await sanity.getDocument(id);
  const before = Array.isArray(existing?.translations) ? (existing.translations as Json[]) : [];
  const wanted: Record<string, string> = { [defaultId]: sourceId, [language]: targetId };
  const kept = before.filter((entry) => typeof entry?.language === "string" && !(entry.language in wanted));
  const translations = [
    { _key: defaultId, _type: "translation", language: defaultId, document: weakRef(sourceId) },
    ...kept,
    { _key: language, _type: "translation", language, document: weakRef(targetId) },
  ];
  const same =
    existing &&
    existing.sourceType === sourceType &&
    before.length === translations.length &&
    Object.entries(wanted).every(([lang, ref]) =>
      before.some((entry) => entry.language === lang && (entry.document as { _ref?: string } | undefined)?._ref === ref),
    );
  if (same) return null;
  return { createOrReplace: { _id: id, _type: TRANSLATION_META_TYPE, sourceType, translations } };
}

interface RunContext {
  config: EngineConfig;
  sanity: SanityLike;
  job: TranslationJob;
  policy: CallPolicy;
  progress: (text: string) => Promise<void>;
  clientFor: () => Promise<AnthropicLike>;
}

async function runTranslate(ctx: RunContext): Promise<{ status: JobStatus; report: TranslationReport }> {
  const { config, sanity, job } = ctx;
  const languages = defineLanguages(config.languages);
  const defaultLanguage = languages.defaultLanguage;
  const target = languages.languages.find((l) => l.id === job.language);
  if (!target || target.id === defaultLanguage.id) throw new EngineError("language_unknown");

  const settings = await loadSettings(config, sanity, defaultLanguage.id);
  if (config.requireEnabledLanguage !== false) {
    const enabled = readEnabledLanguages(settings, languages, { fieldName: config.settings?.languagesField });
    if (!enabled.some((l) => l.id === target.id)) throw new EngineError("language_not_enabled");
  }

  const sourceId = publishedId(String(job.sourceId ?? ""));
  if (sourceId === "") throw new EngineError("source_missing");
  const source = await sanity.getDocument(sourceId);
  if (!source) throw new EngineError("source_missing");
  const sourceLanguage = source[LANGUAGE_FIELD];
  if (typeof sourceLanguage === "string" && sourceLanguage !== "" && sourceLanguage !== defaultLanguage.id) {
    throw new EngineError("source_not_default_language");
  }

  const manifest = await loadManifest(config, sanity);
  const typeName = String(source._type ?? "");
  const documentType = manifest.documents[typeName];
  if (!documentType) throw new EngineError("type_not_translatable", { details: [typeName] });

  const targetId = translationId(sourceId, target.id);
  const found = await sanity.getDocuments([`drafts.${targetId}`, targetId]);
  const existing = found.find((d) => d._id === `drafts.${targetId}`) ?? found.find((d) => d._id === targetId) ?? null;

  const result = await translateDocument({
    document: source,
    language: target,
    sourceLanguage: defaultLanguage,
    manifest,
    glossary: readGlossary(settings, config.settings?.glossaryField ?? GLOSSARY_FIELD),
    styleGuide: readStyleGuide(settings, config.settings?.styleGuideField ?? STYLE_GUIDE_FIELD),
    models: readEngineSettings(settings, config.settings?.engineField ?? ENGINE_FIELD),
    client: ctx.clientFor,
    mode: job.mode === "changes" ? "changes" : "full",
    existingTranslation: existing,
    effort: config.effort,
    maxCharsPerRequest: config.maxCharsPerRequest,
    concurrency: config.concurrency ?? 2,
    policy: ctx.policy,
    onProgress: ctx.progress,
    now: config.now,
  });

  const report = result.report;
  if (!result.translation) return { status: report.held ? "held" : "done", report };

  // A run that outlived its time limit has already been reported as failed. It must not write afterwards.
  if (ctx.policy.signal?.aborted) throw new EngineError("timeout");
  await ctx.progress("Saving the draft");
  const translation = result.translation;
  if (documentType.slugField) {
    const current = (translation[documentType.slugField] as { current?: string } | undefined)?.current;
    if (current) {
      const slug = await uniqueSlug(sanity, typeName, target.id, documentType.slugField, current, targetId);
      translation[documentType.slugField] = { _type: "slug", current: slug };
      report.proposedSlug = slug;
    }
  }
  report.saved = true;
  (translation[I18N_FIELD] as Json).report = reportForStorage(report);

  const mutations: Json[] = [{ createOrReplace: { ...translation, _id: `drafts.${targetId}`, _type: typeName } }];
  const meta = await metaMutation(sanity, sourceId, typeName, defaultLanguage.id, target.id, targetId);
  if (meta) mutations.push(meta);
  await sanity.mutate(mutations);

  return { status: report.held ? "held" : "done", report };
}

async function runEstimate(ctx: RunContext): Promise<CostEstimate> {
  const { config, sanity, job } = ctx;
  const languages = defineLanguages(config.languages);
  const defaultLanguage = languages.defaultLanguage;
  const target = languages.languages.find((l) => l.id === job.language);
  if (!target || target.id === defaultLanguage.id) throw new EngineError("language_unknown");

  await ctx.progress("Reading the documents");
  const ids = [...new Set((job.sourceIds ?? []).map((id) => publishedId(String(id))))].filter((id) => id !== "");
  const [settings, manifest, documents] = await Promise.all([
    loadSettings(config, sanity, defaultLanguage.id),
    loadManifest(config, sanity),
    sanity.getDocuments(ids),
  ]);
  const models = readEngineSettings(settings, config.settings?.engineField ?? ENGINE_FIELD);

  // Counting tokens needs the key. Without one the estimate still works, from characters.
  let counter: TokenCounter | undefined;
  try {
    const client = await ctx.clientFor();
    counter = ({ model, system, user }) => countTokens(client, { model, system, messages: [{ role: "user", content: user }] }, ctx.policy);
  } catch (error) {
    const code = asEngineError(error).code;
    if (code !== "missing_key" && code !== "key_storage_not_configured" && code !== "key_unreadable") throw error;
  }

  await ctx.progress(counter ? "Counting tokens" : "Estimating from the length of the text");
  return estimateCost({
    documents,
    language: target,
    sourceLanguage: defaultLanguage,
    manifest,
    models,
    glossary: readGlossary(settings, config.settings?.glossaryField ?? GLOSSARY_FIELD),
    styleGuide: readStyleGuide(settings, config.settings?.styleGuideField ?? STYLE_GUIDE_FIELD),
    countTokens: counter,
  });
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Finished jobs older than thirty days are removed, so the job list does not grow for ever. */
async function pruneOldJobs(sanity: SanityLike, now: Date): Promise<void> {
  try {
    const ids = await sanity.fetch<string[]>(`*[_type == $type && defined(finishedAt) && finishedAt < $cutoff][0...100]._id`, {
      type: JOB_TYPE,
      cutoff: new Date(now.getTime() - THIRTY_DAYS_MS).toISOString(),
    });
    if (ids && ids.length > 0) await sanity.mutate(ids.map((id) => ({ delete: { id } })));
  } catch {
    // Housekeeping only. A failure here must not change the outcome of the job.
  }
}

/**
 * Run one job by id. Refuses anything that is not a pending job. Every
 * failure after the job is claimed is written to the job in plain words, so
 * the person waiting in the Studio always gets an answer.
 */
export async function runJob(config: EngineConfig, id: string): Promise<JobOutcome> {
  const now = config.now ?? (() => new Date());
  const fail = (httpStatus: number, error: EngineError): JobOutcome => ({
    httpStatus,
    ok: false,
    error: { code: error.code, message: error.message },
  });

  let sanity: SanityLike;
  let job: TranslationJob | null;
  try {
    sanity = resolveSanity(config);
    job = (await sanity.getDocument(id)) as TranslationJob | null;
  } catch (error) {
    return fail(500, asEngineError(error));
  }
  if (!job || job._type !== JOB_TYPE) return fail(404, new EngineError("job_not_found"));
  if (job.status !== "pending") return fail(409, new EngineError("job_not_pending"));

  // Claim the job. The revision check makes a second request for the same job lose.
  try {
    await sanity.mutate([
      { patch: { id, ...(job._rev ? { ifRevisionID: job._rev } : {}), set: { status: "running", startedAt: now().toISOString(), progress: "Starting" } } },
    ]);
  } catch (error) {
    const engineError = asEngineError(error);
    return engineError.details.some((d) => d.includes("409"))
      ? fail(409, new EngineError("job_not_pending"))
      : fail(500, engineError);
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new EngineError("timeout"));
    }, config.deadlineMs ?? 270_000);
  });
  const policy: CallPolicy = { retry: config.retry, timeoutMs: config.requestTimeoutMs ?? 180_000, signal: controller.signal };

  const progress = async (text: string) => {
    try {
      await sanity.mutate([{ patch: { id, set: { progress: text } } }]);
    } catch {
      // Progress is a courtesy. The job itself carries on.
    }
  };

  let cachedClient: AnthropicLike | undefined;
  const clientFor = async () => {
    if (!cachedClient) {
      const apiKey = await loadApiKey(sanity, { privateKey: config.privateKey, publicKey: config.publicKey });
      cachedClient = config.anthropic ? config.anthropic(apiKey) : createAnthropicClient(apiKey, { timeoutMs: policy.timeoutMs });
    }
    return cachedClient;
  };

  const ctx: RunContext = { config, sanity, job, policy, progress, clientFor };
  let outcome: JobOutcome;
  let set: Json;

  try {
    if (job.kind === "estimate") {
      const estimate = await Promise.race([runEstimate(ctx), deadline]);
      set = { status: "done", estimate, progress: "Finished" };
      outcome = { httpStatus: 200, ok: true, status: "done" };
    } else {
      const { status, report } = await Promise.race([runTranslate(ctx), deadline]);
      set = { status, report: reportForStorage(report), progress: "Finished" };
      outcome = { httpStatus: 200, ok: true, status };
    }
  } catch (error) {
    const engineError = controller.signal.aborted ? new EngineError("timeout") : asEngineError(error);
    set = {
      status: "failed",
      progress: "Finished",
      error: { code: engineError.code, message: engineError.message, details: engineError.details.slice(0, 25) },
    };
    outcome = { httpStatus: 200, ok: false, status: "failed", error: { code: engineError.code, message: engineError.message } };
  } finally {
    clearTimeout(timer);
  }

  try {
    await sanity.mutate([{ patch: { id, set: { ...set, finishedAt: now().toISOString() } } }]);
  } catch (error) {
    return fail(500, asEngineError(error));
  }
  await pruneOldJobs(sanity, now());
  return outcome;
}
