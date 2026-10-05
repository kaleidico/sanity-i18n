/**
 * @kaleidico/sanity-i18n/next
 *
 * Next.js side, with no Sanity import: the shared language helpers, the GROQ
 * helpers for reading translated documents, locale routing for the
 * middleware, hreflang and canonical tags, Open Graph locales, the language
 * switcher and the UI dictionary. The middleware step lives in
 * `@kaleidico/sanity-i18n/next/middleware` and the client-side suggestion
 * strip in `@kaleidico/sanity-i18n/next/client`, so this entry has no
 * Next.js import and works from `sitemap.ts`, tests and plain Node.
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

export {
  resolveLocaleRoute,
  resolveLanguageIds,
  isExcludedPath,
  type LocaleRoute,
  type ResolveLocaleRouteOptions,
  type I18nMiddlewareExclude,
} from "./routing";

export {
  buildAlternates,
  openGraphLocale,
  inLanguage,
  languageTag,
  localePath,
  localeUrl,
  type BuildAlternatesOptions,
  type AlternatesResult,
  type OpenGraphLocale,
} from "./alternates";

export {
  createDictionary,
  interpolate,
  type Dictionary,
  type DictionaryInput,
  type DictionaryStrings,
  type TranslateVars,
  type CreateDictionaryOptions,
} from "./dictionary";

export { LanguageSwitcher, switcherHref, type LanguageSwitcherProps } from "./switcher";

export {
  localizeForm,
  formFieldName,
  portableTextToPlain,
  buildConsentRecords,
  consentText,
  submissionWebhookFields,
  consentWordingApproved,
  optionLabel,
  FORM_TEXT_SETTINGS,
  FORM_FIELD_TEXT_KEYS,
  CONSENT_FIELD_TYPE,
  type ConsentRecord,
  type ConsentRecordInput,
  type LocalizeFormOptions,
  type LocalizedFormMeta,
} from "../core/forms";

export {
  resolveApplyNotice,
  matchesApplyHost,
  hostMatches,
  linkHost,
  normaliseHostPatterns,
  applyNoticeHideCss,
  APPLY_NOTICE_FIELD,
  type ApplyNoticeValue,
  type ApplyNoticeText,
  type ApplyNoticeState,
  type ResolvedApplyNotice,
  type ResolveApplyNoticeInput,
} from "../core/applyNotice";
