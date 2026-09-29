import { b as LanguagesInput } from '../languages-BzBBGlPy.js';
export { D as DEFAULT_LANGUAGE_ID, L as Language, a as LanguagesConfig, R as ReadEnabledLanguagesOptions, S as SettingsWithLanguages, d as defineLanguages, l as languageFieldKey, r as readEnabledLanguages } from '../languages-BzBBGlPy.js';

interface I18nRoutesConfig {
    languages: LanguagesInput;
}
/**
 * Placeholder for the locale routing setup. Calling it today throws so a
 * half-wired site fails loudly rather than serving untranslated pages under
 * a language prefix.
 */
declare function defineI18nRoutes(_config: I18nRoutesConfig): never;

export { type I18nRoutesConfig, LanguagesInput, defineI18nRoutes };
