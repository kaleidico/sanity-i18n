/** Per-document translation states, in the order they are shown. */
declare const TRANSLATION_STATUSES: readonly [{
    readonly title: "Draft";
    readonly value: "draft";
}, {
    readonly title: "Needs update";
    readonly value: "needs_update";
}, {
    readonly title: "Awaiting approval";
    readonly value: "awaiting_approval";
}, {
    readonly title: "Approved";
    readonly value: "approved";
}];
type TranslationStatus = (typeof TRANSLATION_STATUSES)[number]["value"];
/** Host overrides for the status titles, e.g. `{ awaiting_approval: "Awaiting NOVA approval" }`. */
type TranslationLabels = Partial<Record<TranslationStatus, string>>;
/** The status list with any host overrides applied, in display order. */
declare function translationStatusList(labels?: TranslationLabels): {
    title: string;
    value: TranslationStatus;
}[];
/** The display title for a status value, falling back to the raw value. */
declare function translationStatusLabel(status: string | null | undefined, labels?: TranslationLabels): string;
/** The schema type name of the metadata document that links one source to all its translations. */
declare const TRANSLATION_META_TYPE = "i18n.translationMeta";
/** Prefix of every metadata document id. */
declare const TRANSLATION_META_ID_PREFIX = "i18n.meta.";
/**
 * The id of the metadata document for a source document. Deterministic, so
 * there is never more than one per source: `i18n.meta.<sourceId>`. A draft id
 * is normalised to its published id first.
 */
declare function translationMetaId(sourceId: string): string;
/** The fields the `language` and `i18n` additions put on a translatable document. */
declare const LANGUAGE_FIELD = "language";
declare const I18N_FIELD = "i18n";
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
declare function localeFilter(lang: string, defaultId?: string): string;
/**
 * GROQ projection entries that read shared fields from the source document
 * when the translation does not carry them itself.
 *
 * `sharedProjection(["photo", "nmls"])` ->
 * `"photo": coalesce(photo, i18n.source->photo), "nmls": coalesce(nmls, i18n.source->nmls)`
 *
 * Drop the result into a projection: `*[...]{ ..., ${sharedProjection(fields)} }`.
 */
declare function sharedProjection(fields: readonly string[]): string;
interface TranslationLinksOptions {
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
declare function translationLinks(options?: TranslationLinksOptions): string;

export { I18N_FIELD as I, LANGUAGE_FIELD as L, TRANSLATION_META_ID_PREFIX as T, TRANSLATION_META_TYPE as a, TRANSLATION_STATUSES as b, type TranslationLabels as c, type TranslationLinksOptions as d, type TranslationStatus as e, translationMetaId as f, translationStatusLabel as g, translationStatusList as h, localeFilter as l, sharedProjection as s, translationLinks as t };
