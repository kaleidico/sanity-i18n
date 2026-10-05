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
declare const TRANSLATION_META_ID_PREFIX = "i18n-meta-";
/**
 * The id of the metadata document for a source document. Deterministic, so
 * there is never more than one per source: `i18n-meta-<sourceId>`. A draft id
 * is normalised to its published id first. The prefix has no period on
 * purpose: Sanity hides any document whose id contains one from public
 * (unauthenticated) reads, and the site reads these without a token.
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
 * Each entry carries the linked document's translation `status`, so the
 * front end can list only approved translations (the source document has no
 * status and comes back with `null`).
 *
 * Result shape on the fetched document:
 * `{ language: "en", translations: [{ language: "en", slug: "about", status: null }, { language: "es", slug: "sobre-nosotros", status: "approved" }] }`
 */
declare function translationLinks(options?: TranslationLinksOptions): string;

/**
 * Matching a link against a list of host patterns, and the two small types
 * the client-side notice needs. No imports, so the browser bundle that
 * carries the notice carries nothing else.
 */
/** The words of the dialog, in the page's language. */
interface ApplyNoticeText {
    title: string;
    body: string;
    continueLabel: string;
    cancelLabel: string;
}
/**
 * `off`: do nothing. `active`: intercept matching links and show the notice.
 * `blocked`: hide matching links, because the notice is on and has no
 * approved wording in this language.
 */
type ApplyNoticeState = "off" | "active" | "blocked";
/** Host patterns, tidied: lower case, scheme, path and port dropped, blanks and duplicates removed. */
declare function normaliseHostPatterns(patterns: readonly unknown[] | null | undefined): string[];
/** The host of a link, lower case, or null for a relative link, a fragment, `mailto:`, `tel:` and anything else that is not http(s). */
declare function linkHost(href: string | null | undefined, base?: string): string | null;
/** True when a host matches a pattern: the same host, or under it when the pattern starts with `*.`. */
declare function hostMatches(host: string, pattern: string): boolean;
/**
 * True when a link goes to one of the hosts the notice applies to. A relative
 * link is the site's own and never matches (pass `base` to resolve it first
 * when the site's own host is on the list).
 */
declare function matchesApplyHost(href: string | null | undefined, patterns: readonly string[], base?: string): boolean;

/**
 * The notice shown before a visitor on a translated page follows a link to
 * something that only exists in the default language, such as an online loan
 * application. Pure functions, no Sanity and no Next.js import.
 *
 * The rule, in one place:
 *
 * - On a default-language page nothing happens: no dialog, links untouched.
 * - On any other language's page, a link whose host is on the `appliesTo`
 *   list opens the notice first, but only when the notice is switched on and
 *   its body in that language is approved legal text.
 * - When the notice is switched on and there is no approved body in that
 *   language, those links are hidden on that language's pages. Sending a
 *   visitor to a default-language application with no notice is the one thing
 *   this exists to prevent, so the safe state is no link at all.
 * - When the notice is switched off, links are left alone in every language.
 */

type Json = Record<string, unknown>;
declare const APPLY_NOTICE_FIELD = "i18nApplyNotice";
/** The notice as stored in Site Settings. */
interface ApplyNoticeValue {
    enabled?: boolean | null;
    appliesTo?: string[] | null;
    title?: string | null;
    body?: string | null;
    continueLabel?: string | null;
    cancelLabel?: string | null;
}
interface ResolvedApplyNotice {
    state: ApplyNoticeState;
    /** The host patterns the rule applies to, lower case. Empty when `off`. */
    hosts: string[];
    /** The words to show. Only when `active`. */
    notice?: ApplyNoticeText;
    /** Why, in plain words, for logs and the Studio. */
    reason: string;
}
interface ResolveApplyNoticeInput {
    /** The language of the page. */
    lang: string;
    defaultId?: string;
    /** The notice on the default-language settings document: the switch and the host list are read from here. */
    base: ApplyNoticeValue | null | undefined;
    /**
     * The published, approved settings document in the page's language (with
     * its `i18n` record), or null when there is none. The wording is read from
     * here and nowhere else.
     */
    local: Json | null | undefined;
    /** The registry entries for the ids on `local.i18n.legal.paths`, by id. */
    approvals?: ReadonlyMap<string, {
        status?: string;
        translatedText?: string;
    }> | Record<string, {
        status?: string;
        translatedText?: string;
    }>;
    /** Hosts used when the settings list none. */
    defaultAppliesTo?: readonly string[];
    fieldName?: string;
}
/**
 * Decide what a page in `lang` does about links to the default-language
 * application. See the rule at the top of this file. The body counts as
 * approved only when the settings document in that language is itself
 * approved, its legal record lists the body as approved, and the registry
 * entry it points at is approved with the same words.
 */
declare function resolveApplyNotice(input: ResolveApplyNoticeInput): ResolvedApplyNotice;
/**
 * CSS that hides every link to the listed hosts, for the `blocked` state. It
 * works before any script runs and for links rendered later. A `*.` pattern
 * is matched on the part after the star, which is as close as an attribute
 * selector gets.
 */
declare function applyNoticeHideCss(hosts: readonly string[]): string;

export { APPLY_NOTICE_FIELD as A, I18N_FIELD as I, LANGUAGE_FIELD as L, type ResolvedApplyNotice as R, TRANSLATION_META_TYPE as T, applyNoticeHideCss as a, type ApplyNoticeState as b, type ApplyNoticeText as c, type ApplyNoticeValue as d, type ResolveApplyNoticeInput as e, TRANSLATION_META_ID_PREFIX as f, TRANSLATION_STATUSES as g, type TranslationLabels as h, type TranslationLinksOptions as i, type TranslationStatus as j, hostMatches as k, linkHost as l, matchesApplyHost as m, localeFilter as n, normaliseHostPatterns as o, translationLinks as p, translationStatusLabel as q, resolveApplyNotice as r, sharedProjection as s, translationMetaId as t, translationStatusList as u };
