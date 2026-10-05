/**
 * @kaleidico/sanity-i18n/sanity
 *
 * Sanity Studio side: language config, the Site Settings "Languages" field,
 * the document-level translation model (`translatable`, legal marks, the
 * metadata document), the desk helpers, the Studio plugin, and the Studio
 * side of the translation engine (settings fields, the key input, the
 * translate action, the stale check on publish, the publish rule on
 * translations, the Translations tool and the Legal approvals tool).
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
  noTranslate,
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
  I18N_HIDDEN_TYPES,
  type I18nPluginConfig,
  type I18nEngineConfig,
} from "./plugin";

// ── Translation engine, Studio side ─────────────────────────────────────

export {
  glossaryField,
  styleGuideField,
  engineField,
  apiKeyField,
  legalApproversField,
  type EngineFieldOptions,
  type ApiKeyFieldOptions,
} from "./engineFields";

export { ApiKeyInput, KEY_STORAGE_NOT_CONFIGURED } from "./ApiKeyInput";

export { translateAction, JobOutcomeView, type TranslateActionOptions } from "./translateAction";

export { publishWithStaleCheck, staleToast, type PublishWithStaleCheckOptions } from "./publishWithStaleCheck";

export { applyNoticeField, type ApplyNoticeFieldOptions } from "./applyNoticeField";
export { APPLY_NOTICE_FIELD, resolveApplyNotice, matchesApplyHost } from "../core/applyNotice";
export { collectReferences, planDependencies, dependencyReasons, DEFAULT_REQUIRED_DEPENDENCY_TYPES, type TranslationDependency } from "../core/dependencies";
export { publishTranslationAction, type PublishTranslationActionOptions } from "./publishTranslationAction";

export { legalApprovalsTool, resubmitLegalUnit, buildLog, LEGAL_APPROVER_NOTICE, type LegalApprovalsToolOptions } from "./LegalApprovalsTool";

export {
  LEGAL_APPROVAL_TYPE,
  LEGAL_APPROVAL_ID_PREFIX,
  normaliseLegalText,
  legalSourceHash,
  legalApprovalId,
  unitText,
  occurrenceKey,
  legalUnitsOf,
  parseLegalValue,
  applyLegalValue,
  planLegalRegistry,
  statusAfterRun,
  checkTranslationForPublish,
  planStaleTranslations,
  legalPathSegments,
  type LegalApproval,
  type LegalApprovalStatus,
  type LegalPerson,
  type LegalOccurrence,
  type LegalDecision,
  type LegalPathRecord,
  type LegalRecord,
  type LegalPlanInput,
  type LegalPlan,
  type PublishCheck,
  type StalePlanInput,
  type StalePlan,
  type StaleMark,
} from "../core/legal";

export { translationsTool, summariseTranslations, type TranslationsToolOptions } from "./TranslationsTool";

export {
  ensureManifest,
  createJob,
  startJob,
  watchJob,
  useLegalApprovers,
  DEFAULT_ENDPOINT,
  DEFAULT_APPROVE_ENDPOINT,
  type StudioEngineOptions,
  type NewJob,
} from "./studioEngine";

export {
  translationJobType,
  translationSecretsType,
  translationManifestType,
  legalApprovalType,
  sourceHashesField,
  reportField,
  reportFields,
  legalRecordField,
  staleSinceField,
} from "./engineTypes";

export {
  buildFieldManifest,
  NON_TEXT_FIELD_NAME,
  type FieldManifest,
  type ManifestNode,
  type ManifestDocumentType,
  type CompiledSchemaLike,
} from "../core/manifest";

export {
  extractUnits,
  diffSource,
  sourceHashes,
  type TranslationUnit,
  type SourceDiff,
  type SourceHashEntry,
} from "../core/payload";

export { MODELS, RATES_AS_OF, DEFAULT_TRANSLATOR_MODEL, DEFAULT_REVIEWER_MODEL, type ModelInfo } from "../core/pricing";

export {
  encryptSecret,
  publicKeyFingerprint,
  translationId,
  toSlug,
  readGlossary,
  readStyleGuide,
  readEngineSettings,
  readLegalApprovers,
  isLegalApprover,
  LEGAL_APPROVERS_FIELD,
  SECRETS_ID,
  SECRETS_TYPE,
  MANIFEST_ID,
  MANIFEST_TYPE,
  JOB_TYPE,
  JOB_ID_PREFIX,
  ENGINE_DOCUMENT_TYPES,
  ENGINE_SETTINGS_FIELDS,
  GLOSSARY_FIELD,
  STYLE_GUIDE_FIELD,
  ENGINE_FIELD,
  API_KEY_FIELD,
  type Glossary,
  type GlossaryTerm,
  type StyleGuide,
  type EngineSettings,
  type TranslationJob,
  type TranslationReport,
  type CostEstimate,
  type ApprovalOutcome,
  type ReviewIssue,
  type JobKind,
  type JobMode,
  type JobStatus,
} from "../core/engineModel";
