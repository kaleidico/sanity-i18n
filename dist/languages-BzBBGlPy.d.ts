/**
 * Language configuration shared by every part of the package.
 *
 * This module has no Sanity or Next.js imports so it can be bundled into the
 * `/sanity`, `/next` and `/engine` entry points alike.
 */
interface Language {
    /**
     * Short language code used in URLs, document metadata and the Site
     * Settings switches. Use BCP 47 style codes such as `es` or `pt-BR`.
     */
    id: string;
    /** The language's name as an English speaking editor would read it, e.g. `Spanish`. */
    title: string;
    /** The language's name in the language itself, e.g. `Español`. Falls back to `title`. */
    nativeTitle?: string;
    /**
     * Marks the source language every translation is made from. Exactly one
     * language is the default. When none is marked, `en` is the default.
     */
    default?: boolean;
}
/** The normalised result of `defineLanguages()`: default language first, then configured order. */
interface LanguagesConfig {
    languages: Language[];
    defaultLanguage: Language;
}
/** Anything `defineLanguages()` accepts, or its own result. */
type LanguagesInput = readonly Language[] | {
    languages: readonly Language[];
} | LanguagesConfig;
declare const DEFAULT_LANGUAGE_ID = "en";
/**
 * Validate and normalise a list of languages.
 *
 * Rules:
 * - Every id is a short language code (`es`, `pt-BR`) and unique.
 * - At most one language is marked `default`. When none is, English (`en`)
 *   is the default and is added to the front of the list if it is missing.
 * - The result lists the default language first, then the others in the
 *   order they were given.
 *
 * The same config object can be passed to `languagesField()`, `i18nPlugin()`
 * and `readEnabledLanguages()`, so define it once and share it.
 */
declare function defineLanguages(input: LanguagesInput): LanguagesConfig;
/**
 * Sanity field names must be plain identifiers, so a language id such as
 * `pt-BR` is stored under the key `pt_BR` inside the `languages` object.
 */
declare function languageFieldKey(id: string): string;
/** The shape `readEnabledLanguages()` reads from a Site Settings document. */
interface SettingsWithLanguages {
    languages?: Record<string, boolean | null | undefined> | null;
    [key: string]: unknown;
}
interface ReadEnabledLanguagesOptions {
    /** Name of the object field on the settings document. Defaults to `languages`. */
    fieldName?: string;
}
/**
 * Pure helper: given a Site Settings document (or the projected `languages`
 * object from it) return the languages that are switched on, in configured
 * order with the default language first.
 *
 * The default language is always included, whatever the document says, so a
 * site with no `languages` field yet still resolves to `[en]`.
 */
declare function readEnabledLanguages(settingsDoc: SettingsWithLanguages | null | undefined, languages: LanguagesInput, options?: ReadEnabledLanguagesOptions): Language[];

export { DEFAULT_LANGUAGE_ID as D, type Language as L, type ReadEnabledLanguagesOptions as R, type SettingsWithLanguages as S, type LanguagesConfig as a, type LanguagesInput as b, defineLanguages as d, languageFieldKey as l, readEnabledLanguages as r };
