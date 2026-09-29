/**
 * @kaleidico/sanity-i18n/sanity
 *
 * Sanity Studio side: language config, the Site Settings "Languages" field,
 * the document-level translation model (`translatable`, legal marks, the
 * metadata document), the desk helpers and the Studio plugin.
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
  TRANSLATION_STATUSES,
  translationStatusList,
  translationStatusLabel,
  TRANSLATION_META_TYPE,
  TRANSLATION_META_ID_PREFIX,
  translationMetaId,
  LANGUAGE_FIELD,
  I18N_FIELD,
  type TranslationStatus,
  type TranslationLabels,
} from "../core/translations";

export {
  languagesField,
  LANGUAGES_GROUP,
  type LanguagesFieldOptions,
} from "./languagesField";

export {
  translatable,
  getSharedFields,
  getTranslatableMarker,
  isTranslatable,
  isTranslationDocument,
  I18N_MARKER,
  type TranslatableOptions,
  type TranslatableMarker,
} from "./translatable";

export {
  legalText,
  legalBlock,
  isLegal,
  collectLegalPaths,
  LEGAL_NOTE,
  type CollectLegalPathsOptions,
} from "./legal";

export {
  translationMetaType,
  type TranslationMetaOptions,
} from "./translationMeta";

export {
  translationBadge,
  TRANSLATION_BADGE_COLORS,
  type TranslationBadgeOptions,
} from "./badge";

export {
  translationsStructure,
  languageFilter,
  type TranslationsStructureOptions,
} from "./structure";

export {
  i18nPlugin,
  I18N_PLUGIN_NAME,
  type I18nPluginConfig,
} from "./plugin";
