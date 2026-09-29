/**
 * Translation metadata shared by every part of the package: the status list,
 * the metadata document id scheme and the GROQ helpers the Next.js side uses
 * to read translated documents.
 *
 * This module has no Sanity or Next.js imports so it can be bundled into the
 * `/sanity`, `/next` and `/engine` entry points alike.
 */
import { DEFAULT_LANGUAGE_ID } from "./languages";

/** Per-document translation states, in the order they are shown. */
export const TRANSLATION_STATUSES = [
  { title: "Draft", value: "draft" },
  { title: "Needs update", value: "needs_update" },
  { title: "Awaiting approval", value: "awaiting_approval" },
  { title: "Approved", value: "approved" },
] as const;

export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number]["value"];

/** Host overrides for the status titles, e.g. `{ awaiting_approval: "Awaiting NOVA approval" }`. */
export type TranslationLabels = Partial<Record<TranslationStatus, string>>;

/** The status list with any host overrides applied, in display order. */
export function translationStatusList(
  labels?: TranslationLabels,
): { title: string; value: TranslationStatus }[] {
  return TRANSLATION_STATUSES.map((s) => ({
    value: s.value,
    title: labels?.[s.value] ?? s.title,
  }));
}

/** The display title for a status value, falling back to the raw value. */
export function translationStatusLabel(
  status: string | null | undefined,
  labels?: TranslationLabels,
): string {
  if (!status) return labels?.draft ?? "Draft";
  const found = TRANSLATION_STATUSES.find((s) => s.value === status);
  if (!found) return status;
  return labels?.[found.value] ?? found.title;
}

/** The schema type name of the metadata document that links one source to all its translations. */
export const TRANSLATION_META_TYPE = "i18n.translationMeta";

/** Prefix of every metadata document id. */
export const TRANSLATION_META_ID_PREFIX = "i18n.meta.";

/**
 * The id of the metadata document for a source document. Deterministic, so
 * there is never more than one per source: `i18n.meta.<sourceId>`. A draft id
 * is normalised to its published id first.
 */
export function translationMetaId(sourceId: string): string {
  const published = sourceId.startsWith("drafts.") ? sourceId.slice("drafts.".length) : sourceId;
  return TRANSLATION_META_ID_PREFIX + published;
}

/** The fields the `language` and `i18n` additions put on a translatable document. */
export const LANGUAGE_FIELD = "language";
export const I18N_FIELD = "i18n";

function groqString(value: string): string {
  return JSON.stringify(value);
}

/**
 * GROQ filter clause that matches documents in one language.
 *
 * For the default language the clause also matches documents that have no
 * `language` field at all, so every document that existed before the package
 * was installed still counts as the default language.
 *
 * `localeFilter("es")` -> `language == "es"`
 * `localeFilter("en")` -> `(language == "en" || !defined(language))`
 */
export function localeFilter(lang: string, defaultId: string = DEFAULT_LANGUAGE_ID): string {
  if (lang === defaultId) {
    return `(${LANGUAGE_FIELD} == ${groqString(lang)} || !defined(${LANGUAGE_FIELD}))`;
  }
  return `${LANGUAGE_FIELD} == ${groqString(lang)}`;
}

/**
 * GROQ projection entries that read shared fields from the source document
 * when the translation does not carry them itself.
 *
 * `sharedProjection(["photo", "nmls"])` ->
 * `"photo": coalesce(photo, i18n.source->photo), "nmls": coalesce(nmls, i18n.source->nmls)`
 *
 * Drop the result into a projection: `*[...]{ ..., ${sharedProjection(fields)} }`.
 */
export function sharedProjection(fields: readonly string[]): string {
  return fields
    .map((field) => `${groqString(field)}: coalesce(${field}, ${I18N_FIELD}.source->${field})`)
    .join(", ");
}

export interface TranslationLinksOptions {
  /** Name of the slug field on the translatable documents. Defaults to `slug`. */
  slugField?: string;
  /** The default language id, used when a document has no `language` field. Defaults to `en`. */
  defaultId?: string;
}

/**
 * GROQ projection entries that give a document its language and the slug of
 * every language it exists in, for the language switcher and hreflang tags.
 *
 * Works from either side of the link: an English document finds its metadata
 * by its own id, a translation by the id its `i18n.source` points at. The
 * metadata document id is deterministic (see `translationMetaId`), so this is
 * a direct id lookup, not a search.
 *
 * Result shape on the fetched document:
 * `{ language: "en", translations: [{ language: "en", slug: "about" }, { language: "es", slug: "sobre-nosotros" }] }`
 */
export function translationLinks(options: TranslationLinksOptions = {}): string {
  const slugField = options.slugField ?? "slug";
  const defaultId = options.defaultId ?? DEFAULT_LANGUAGE_ID;
  const sourceId = `coalesce(^.${I18N_FIELD}.source._ref, ^._id)`;
  return [
    `"language": coalesce(${LANGUAGE_FIELD}, ${groqString(defaultId)})`,
    `"translations": *[_type == ${groqString(TRANSLATION_META_TYPE)} && _id == ${groqString(TRANSLATION_META_ID_PREFIX)} + ${sourceId}][0].translations[]{ language, "slug": document->${slugField}.current }`,
  ].join(", ");
}
