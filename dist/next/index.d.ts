import { L as Language } from '../languages-BzBBGlPy.js';
export { D as DEFAULT_LANGUAGE_ID, a as LanguagesConfig, b as LanguagesInput, R as ReadEnabledLanguagesOptions, S as SettingsWithLanguages, d as defineLanguages, l as languageFieldKey, r as readEnabledLanguages } from '../languages-BzBBGlPy.js';
export { A as APPLY_NOTICE_FIELD, b as ApplyNoticeState, c as ApplyNoticeText, d as ApplyNoticeValue, I as I18N_FIELD, L as LANGUAGE_FIELD, e as ResolveApplyNoticeInput, R as ResolvedApplyNotice, f as TRANSLATION_META_ID_PREFIX, T as TRANSLATION_META_TYPE, g as TRANSLATION_STATUSES, h as TranslationLabels, i as TranslationLinksOptions, j as TranslationStatus, a as applyNoticeHideCss, k as hostMatches, l as linkHost, n as localeFilter, m as matchesApplyHost, o as normaliseHostPatterns, r as resolveApplyNotice, s as sharedProjection, p as translationLinks, t as translationMetaId, q as translationStatusLabel } from '../applyNotice-BJDkeyEo.js';
export { I as I18nMiddlewareExclude, L as LocaleRoute, R as ResolveLocaleRouteOptions, i as isExcludedPath, r as resolveLanguageIds, a as resolveLocaleRoute } from '../routing-DWdPJYHX.js';
import * as react from 'react';
import { ReactNode } from 'react';
export { d as CONSENT_FIELD_TYPE, C as ConsentRecord, e as ConsentRecordInput, g as FORM_FIELD_TEXT_KEYS, F as FORM_TEXT_SETTINGS, L as LocalizeFormOptions, h as LocalizedFormMeta, b as buildConsentRecords, c as consentText, a as consentWordingApproved, f as formFieldName, l as localizeForm, o as optionLabel, p as portableTextToPlain, s as submissionWebhookFields } from '../forms-DjgjKAeJ.js';

/**
 * The BCP 47 tag for a language id: `es` becomes `es-US`, `pt-BR` stays as
 * it is. Use it for `Intl.*`, `<html lang>` and JSON-LD `inLanguage`.
 */
declare function languageTag(lang: string, region?: string): string;
/** The value of `inLanguage` in JSON-LD for a page in `lang`. */
declare function inLanguage(lang: string, region?: string): string;
/**
 * The path a page has in a language: the default language stays at the root,
 * every other language gets its prefix. `localePath("es", "/about")` is
 * `/es/about`; `localePath("en", "/")` is `/`; `localePath("es", "/")` is `/es`.
 */
declare function localePath(lang: string, path: string, defaultId?: string): string;
/** The absolute URL of a page in a language. `siteUrl` must not end in a slash. */
declare function localeUrl(siteUrl: string, lang: string, path: string, defaultId?: string): string;
interface BuildAlternatesOptions {
    /** Absolute site origin, e.g. `https://www.example.com`, no trailing slash. */
    siteUrl: string;
    /** The language of the page being rendered. */
    lang: string;
    /** The language served at the root. Defaults to `en`. */
    defaultId?: string;
    /** The page's own path in `lang`, without the language prefix, e.g. `/about`. */
    path: string;
    /**
     * The path of the same page in every other language it exists in, keyed by
     * language id and without the prefix: `{ es: "/sobre-nosotros" }`. Only list
     * languages that are live for this page; hreflang must be reciprocal.
     */
    translations?: Record<string, string | null | undefined>;
}
interface AlternatesResult {
    canonical: string;
    languages: Record<string, string>;
}
/**
 * Next.js `Metadata.alternates` for one page: a self-referencing canonical in
 * the page's own language and an hreflang entry for every language the page
 * exists in, plus `x-default` pointing at the default-language URL.
 *
 * Every language's page should call this with the same set, so each one lists
 * the same alternates and the tags are reciprocal.
 */
declare function buildAlternates(options: BuildAlternatesOptions): AlternatesResult;
interface OpenGraphLocale {
    locale: string;
    alternateLocale?: string[];
}
/**
 * `og:locale` and `og:locale:alternate` for a page: `es` gives `es_US`, with
 * every other language in `others` listed as an alternate.
 */
declare function openGraphLocale(lang: string, others?: string[], region?: string): OpenGraphLocale;

/**
 * A small typed UI dictionary for the strings the site itself owns: buttons,
 * navigation labels, form labels and errors, the 404 page, the cookie banner.
 * Content comes from Sanity in each language; this is for everything else.
 *
 * ```ts
 * const dictionary = createDictionary({
 *   en: { readMore: "Read more", minRead: "{minutes} min read" },
 *   es: { readMore: "Leer más", minRead: "{minutes} min de lectura" },
 * });
 * dictionary.t("es", "minRead", { minutes: 4 }); // "4 min de lectura"
 * ```
 *
 * Every language must define every key of the default language; TypeScript
 * enforces it, so a missing translation fails the build rather than falling
 * back to English at runtime.
 */
type DictionaryStrings<K extends string> = Record<K, string>;
type DictionaryInput<D extends string, K extends string> = Record<D, DictionaryStrings<K>> & Record<string, DictionaryStrings<K>>;
type TranslateVars = Record<string, string | number>;
interface Dictionary<K extends string> {
    /** The language ids the dictionary covers. */
    languages: string[];
    /** The default language, used when `lang` is not covered. */
    defaultId: string;
    /** Every key, in the order the default language lists them. */
    keys: K[];
    /** True when `lang` has its own strings. */
    has(lang: string): boolean;
    /** The string for `key` in `lang`, with `{name}` placeholders filled from `vars`. */
    t(lang: string, key: K, vars?: TranslateVars): string;
    /** A `t` bound to one language, for components that render in a single language. */
    for(lang: string): (key: K, vars?: TranslateVars) => string;
}
interface CreateDictionaryOptions {
    /** The language whose keys define the key list. Defaults to `en`, or the first language given. */
    defaultId?: string;
}
declare function interpolate(template: string, vars?: TranslateVars): string;
declare function createDictionary<K extends string, D extends string = "en">(input: DictionaryInput<D, K>, options?: CreateDictionaryOptions): Dictionary<K>;

interface LanguageSwitcherProps {
    /** The language of the page being rendered. */
    current: string;
    /** The languages switched on, in display order. */
    languages: readonly Language[];
    /** The same page in other languages, keyed by language id: `{ es: "/es/sobre-nosotros" }`. */
    links?: Record<string, string | null | undefined>;
    /** Each language's home page, used when `links` has no entry for it: `{ en: "/", es: "/es" }`. */
    homeHrefs: Record<string, string>;
    /** `nav` label in the current language, e.g. "Language" or "Idioma". */
    labels: {
        ariaLabel: string;
    };
    /** Also list the current language, as text with `aria-current`. Off by default. */
    showCurrent?: boolean;
    className?: string;
    listClassName?: string;
    itemClassName?: string;
    linkClassName?: string;
    currentClassName?: string;
    /** Rendered before each language name, for an icon or a flag glyph. */
    prefix?: ReactNode;
}
declare function switcherHref(id: string, links: LanguageSwitcherProps["links"], homeHrefs: Record<string, string>): string | undefined;
declare function LanguageSwitcher(props: LanguageSwitcherProps): react.JSX.Element | null;

export { type AlternatesResult, type BuildAlternatesOptions, type CreateDictionaryOptions, type Dictionary, type DictionaryInput, type DictionaryStrings, Language, LanguageSwitcher, type LanguageSwitcherProps, type OpenGraphLocale, type TranslateVars, buildAlternates, createDictionary, inLanguage, interpolate, languageTag, localePath, localeUrl, openGraphLocale, switcherHref };
