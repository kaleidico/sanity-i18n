/**
 * @kaleidico/sanity-i18n/next
 *
 * Next.js side, with no Sanity import. Exposes the shared language helpers
 * and the GROQ helpers for reading translated documents. Part 3 adds locale
 * routing under `/es`, hreflang and canonical tags, sitemap alternates, a
 * language switcher and a UI dictionary; until then `defineI18nRoutes()`
 * throws so a half-wired site fails loudly rather than serving untranslated
 * pages under a language prefix.
 */
export {
  defineLanguages,
  readEnabledLanguages,
  languageFieldKey,
  DEFAULT_LANGUAGE_ID,
  type Language,
  type LanguagesConfig,
  type LanguagesInput,
  type SettingsWithLanguages,
  type ReadEnabledLanguagesOptions,
} from "../core/languages";

export {
  localeFilter,
  sharedProjection,
  translationLinks,
  translationMetaId,
  translationStatusLabel,
  TRANSLATION_STATUSES,
  TRANSLATION_META_TYPE,
  TRANSLATION_META_ID_PREFIX,
  LANGUAGE_FIELD,
  I18N_FIELD,
  type TranslationStatus,
  type TranslationLabels,
  type TranslationLinksOptions,
} from "../core/translations";

export interface I18nRoutesConfig {
  languages: import("../core/languages").LanguagesInput;
}

/**
 * Placeholder for the locale routing setup. Calling it today throws so a
 * half-wired site fails loudly rather than serving untranslated pages under
 * a language prefix.
 */
export function defineI18nRoutes(_config: I18nRoutesConfig): never {
  throw new Error(
    "@kaleidico/sanity-i18n/next: defineI18nRoutes() is not implemented until part 3 (locale routing).",
  );
}
