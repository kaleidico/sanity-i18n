/**
 * @kaleidico/sanity-i18n/sanity
 *
 * Sanity Studio side: language config, the Site Settings "Languages" field,
 * the Studio plugin and the pure helper that reads enabled languages back.
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
  languagesField,
  LANGUAGES_GROUP,
  type LanguagesFieldOptions,
} from "./languagesField";

export {
  i18nPlugin,
  I18N_PLUGIN_NAME,
  type I18nPluginConfig,
} from "./plugin";

export {
  translationMetaType,
  TRANSLATION_META_TYPE,
  TRANSLATION_STATUSES,
  type TranslationStatus,
} from "./translationMeta";
