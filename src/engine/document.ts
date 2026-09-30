/**
 * Translate one document: decide which units go to the model, translate
 * them, run both checks, and build the translation document. No reading or
 * writing of the dataset happens here; `runJob()` does that around it.
 */
import { checkExactMatch, type ExactMatchResult } from "../core/check";
import {
  translationId,
  type CallUsage,
  type EngineSettings,
  type Glossary,
  type JobMode,
  type ReviewIssue,
  type StyleGuide,
  type TranslationReport,
} from "../core/engineModel";
import type { Language } from "../core/languages";
import type { FieldManifest } from "../core/manifest";
import {
  applyUnits,
  diffSource,
  extractUnits,
  readUnit,
  sourceFingerprint,
  sourceHashes,
  unitPairs,
  type SourceDiff,
  type TranslationUnit,
  type UnitPair,
  type UnitValue,
} from "../core/payload";
import { costOf, RATES_AS_OF } from "../core/pricing";
import { I18N_FIELD, LANGUAGE_FIELD } from "../core/translations";
import type { AnthropicLike, CallPolicy, Effort } from "./anthropic";
import { EngineError } from "./errors";
import { reviewTranslation } from "./review";
import { translateUnits } from "./translate";

type Json = Record<string, unknown>;

const SYSTEM_FIELDS = ["_id", "_rev", "_createdAt", "_updatedAt", "_system", "_originalId"];

export interface TranslateDocumentInput {
  /** The published source document, in the default language. */
  document: Json;
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
  existingTranslation?: Json | null;
  effort?: { translator?: Effort; reviewer?: Effort };
  maxCharsPerRequest?: number;
  concurrency?: number;
  policy?: CallPolicy;
  /** Called as the run moves on, with a short phrase for the person waiting. */
  onProgress?: (stage: string) => void | Promise<void>;
  now?: () => Date;
}

export interface TranslateDocumentResult {
  /**
   * The translation document without an `_id`, ready to be written as a
   * draft. Null when the run is held by the exact-match check, or when there
   * was nothing to do.
   */
  translation: Json | null;
  report: TranslationReport;
  diff: SourceDiff | null;
  /** True when the existing translation already matches the source and nothing was written. */
  upToDate: boolean;
}

function emptyUsage(model: string): CallUsage {
  return { model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function slugOf(doc: Json | null | undefined, field: string | null): string | null {
  if (!doc || !field) return null;
  const current = (doc[field] as { current?: unknown } | undefined)?.current;
  return typeof current === "string" && current !== "" ? current : null;
}

export async function translateDocument(input: TranslateDocumentInput): Promise<TranslateDocumentResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const source = input.document;
  const typeName = typeof source._type === "string" ? source._type : "";
  const documentType = input.manifest.documents[typeName];
  if (!documentType) throw new EngineError("type_not_translatable", { details: [typeName] });

  const sourceId = String(source._id ?? "").replace(/^drafts\./, "");
  const targetId = translationId(sourceId, input.language.id);
  const existing = input.existingTranslation ?? null;
  const allUnits = extractUnits(source, input.manifest, typeName);
  const hashes = sourceHashes(source, input.manifest, allUnits);

  // Changes mode needs a translation with stored hashes to compare against.
  const hasStoredHashes = Array.isArray((existing?.[I18N_FIELD] as { sourceHashes?: unknown } | undefined)?.sourceHashes);
  const mode: JobMode = input.mode === "changes" && existing && hasStoredHashes ? "changes" : "full";
  const diff = mode === "changes" ? diffSource(source, existing, input.manifest) : null;

  const reused = new Map<string, UnitValue>();
  let toTranslate: TranslationUnit[] = [...allUnits];
  if (diff && existing) {
    const stale = new Set([...diff.changed, ...diff.added]);
    toTranslate = [];
    for (const unit of allUnits) {
      const current = stale.has(unit.path) ? undefined : readUnit(existing, unit);
      if (current === undefined) toTranslate.push(unit);
      else reused.set(unit.path, current);
    }
  }

  const prompt = { sourceLanguage: input.sourceLanguage, targetLanguage: input.language, glossary: input.glossary, styleGuide: input.styleGuide };
  const sourceSlug = slugOf(source, documentType.slugField);
  const existingSlug = slugOf(existing, documentType.slugField);
  const legalPaths = allUnits.filter((u) => u.legal).map((u) => u.path);

  const report: TranslationReport = {
    mode,
    language: input.language.id,
    sourceId,
    translationId: targetId,
    startedAt,
    finishedAt: startedAt,
    translatorModel: input.models.translatorModel,
    reviewerModel: input.models.reviewerModel,
    servedBy: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ratesAsOf: RATES_AS_OF,
    usage: [],
    unitsTotal: allUnits.length,
    unitsTranslated: toTranslate.length,
    unitsReused: reused.size,
    translatedPaths: toTranslate.map((u) => u.path),
    structureRetries: 0,
    check1Passed: true,
    check1Checked: 0,
    check1Failures: [],
    check1Warnings: [],
    reviewPassed: true,
    reviewIssues: [],
    legalPaths,
    sourceSlug,
    proposedSlug: existingSlug,
    held: false,
    holdReasons: [],
    saved: false,
  };

  if (diff?.upToDate && toTranslate.length === 0) {
    report.finishedAt = now().toISOString();
    return { translation: null, report, diff, upToDate: true };
  }

  let translatorUsage = emptyUsage(input.models.translatorModel);
  let reviewerUsage = emptyUsage(input.models.reviewerModel);
  const translated = new Map<string, UnitValue>();
  let check: ExactMatchResult = { passed: true, checked: 0, failures: [], warnings: [] };
  let issues: ReviewIssue[] = [];
  let reviewPassed = true;
  let reviewReadable = true;
  let proposedSlug = existingSlug;

  if (toTranslate.length > 0) {
    const client = await input.client();

    await input.onProgress?.("Translating");
    const result = await translateUnits({
      client,
      model: input.models.translatorModel,
      effort: input.effort?.translator ?? "medium",
      prompt,
      document: source,
      units: toTranslate,
      allUnits,
      existing: reused,
      // A translation that already has an address keeps it, so a live URL never moves.
      slug: existingSlug ? null : sourceSlug,
      maxCharsPerRequest: input.maxCharsPerRequest,
      concurrency: input.concurrency,
      policy: input.policy,
    });
    translatorUsage = result.usage;
    report.structureRetries = result.structureRetries;
    for (const [path, value] of result.values) translated.set(path, value);
    if (!existingSlug) proposedSlug = result.slug;

    await input.onProgress?.("Checking numbers, links and other exact values");
    const pairs: UnitPair[] = toTranslate.flatMap((unit) => unitPairs(unit, translated.get(unit.path) as UnitValue));
    check = checkExactMatch(pairs);

    // A translation with a wrong number is not worth a reviewer's time or the
    // client's money: it is held as it is.
    if (check.passed) {
      await input.onProgress?.("Reviewing the translation");
      const review = await reviewTranslation({
        client,
        model: input.models.reviewerModel,
        effort: input.effort?.reviewer ?? "high",
        prompt,
        pairs,
        legalPaths,
        concurrency: input.concurrency,
        policy: input.policy,
      });
      reviewerUsage = review.usage;
      issues = review.issues;
      reviewPassed = review.passed;
      reviewReadable = review.readable;
      report.servedBy = [...new Set([...result.servedBy, ...review.servedBy])];
    } else {
      report.servedBy = result.servedBy;
    }
  }

  report.usage = [translatorUsage, reviewerUsage].filter((u) => u.requests > 0);
  report.inputTokens = report.usage.reduce((n, u) => n + u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens, 0);
  report.outputTokens = report.usage.reduce((n, u) => n + u.outputTokens, 0);
  report.costUsd = Math.round(report.usage.reduce((n, u) => n + costOf(u, u.model), 0) * 1_000_000) / 1_000_000;
  report.check1Passed = check.passed;
  report.check1Checked = check.checked;
  report.check1Failures = check.failures;
  report.check1Warnings = check.warnings;
  report.reviewPassed = check.passed ? reviewPassed : false;
  report.reviewIssues = issues;
  report.proposedSlug = proposedSlug;

  if (!check.passed) {
    report.held = true;
    report.holdReasons.push(
      `${check.failures.length} exact value(s) in the translation do not match the English. Nothing was saved, and the reviewer was not run.`,
    );
    report.finishedAt = now().toISOString();
    return { translation: null, report, diff, upToDate: false };
  }
  if (!reviewReadable) {
    report.held = true;
    report.holdReasons.push("The reviewer's answer could not be read, so the translation has not been reviewed.");
  }
  const high = issues.filter((i) => i.severity === "high").length;
  if (high > 0) {
    report.held = true;
    report.holdReasons.push(`The reviewer raised ${high} high severity issue(s) that a person needs to look at.`);
  }

  // The translation starts as a copy of the source, so everything that is not
  // text (images, links, references, fixed choices, block order) comes along.
  const translation = JSON.parse(JSON.stringify(source)) as Json;
  for (const field of SYSTEM_FIELDS) delete translation[field];
  for (const field of documentType.sharedFields) delete translation[field];

  const entries = allUnits
    .map((unit) => ({ unit, value: translated.get(unit.path) ?? reused.get(unit.path) }))
    .filter((entry): entry is { unit: TranslationUnit; value: UnitValue } => entry.value !== undefined);
  const missing = applyUnits(translation, entries);
  if (missing.length > 0) throw new EngineError("structure_mismatch", { details: missing.map((p) => `${p}: could not be written`) });

  if (documentType.slugField) {
    if (proposedSlug) translation[documentType.slugField] = { _type: "slug", current: proposedSlug };
    else delete translation[documentType.slugField];
  }

  report.finishedAt = now().toISOString();
  translation[LANGUAGE_FIELD] = input.language.id;
  translation[I18N_FIELD] = {
    source: { _type: "reference", _ref: sourceId, _weak: true },
    status: "draft",
    sourceHash: sourceFingerprint(hashes),
    sourceHashes: hashes,
    translatedAt: report.finishedAt,
    report: reportForStorage(report),
  };

  return { translation, report, diff, upToDate: false };
}

function keyed<T extends object>(items: readonly T[]): (T & { _key: string })[] {
  return items.map((item, i) => ({ _key: `k${i}`, ...item }));
}

/** The report in the shape Sanity stores: lists of objects need a `_key` on every item. */
export function reportForStorage(report: TranslationReport): Json {
  return {
    ...report,
    usage: keyed(report.usage),
    check1Failures: keyed(report.check1Failures),
    check1Warnings: keyed(report.check1Warnings),
    reviewIssues: keyed(report.reviewIssues),
  };
}
