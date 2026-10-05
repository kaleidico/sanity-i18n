/**
 * @kaleidico/sanity-i18n/engine
 *
 * Server-only translation engine. It translates a Sanity document with the
 * site's own Anthropic API key (stored encrypted, see `loadApiKey`), applying
 * the site's glossary and style guide, then runs two checks before anything
 * is written back: an exact-match check on every number, link and other
 * exact value, and a separate reviewer call.
 *
 * Nothing in this module may ever run in the browser, because the API key
 * would travel with it. The guard below throws on import in a browser.
 */

function assertServer(): void {
  if (typeof window !== "undefined" || typeof document !== "undefined") {
    throw new Error(
      "@kaleidico/sanity-i18n/engine is server-only. Import it from a Route Handler, Server Action or server component, never from client code.",
    );
  }
}

assertServer();

export {
  defineLanguages,
  type Language,
  type LanguagesConfig,
  type LanguagesInput,
} from "../core/languages";

export { translateDocument, reportForStorage, type TranslateDocumentInput, type TranslateDocumentResult } from "./document";
export { runJob, resolveSanity, TRANSLATE_JOB_KINDS, APPROVAL_JOB_KINDS, type EngineConfig, type JobOutcome } from "./job";
export { publishTranslation, approveUnit, sendBackUnit, readStoredManifest, type PublishTranslationOptions, type PublishTranslationResult, type DecisionInput } from "./legal";
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
export { loadDependencies } from "./dependencies";
export { collectReferences, planDependencies, dependencyReasons, DEFAULT_REQUIRED_DEPENDENCY_TYPES, type TranslationDependency, type DependencyPlanInput } from "../core/dependencies";
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
  type ConsentRecord,
} from "../core/forms";
export { resolveApplyNotice, matchesApplyHost, applyNoticeHideCss, APPLY_NOTICE_FIELD, type ResolvedApplyNotice } from "../core/applyNotice";
export { estimateCost, tokensFromCharacters, type EstimateCostInput, type TokenCounter } from "./estimate";
export { translateUnits, chunkUnits, translatorRequestPreview, DEFAULT_MAX_CHARS_PER_REQUEST, type TranslateUnitsInput, type TranslateUnitsResult } from "./translate";
export { reviewTranslation, parseReviewerResponse, reviewerRequest, type ReviewInput, type ReviewResult } from "./review";
export { translatorSystemPrompt, reviewerSystemPrompt, REVIEW_SCHEMA, type PromptContext } from "./prompts";
export {
  callModel,
  countTokens,
  createAnthropicClient,
  isRetryable,
  retryAfterMs,
  toEngineError,
  parseJsonObject,
  type AnthropicLike,
  type CallPolicy,
  type Effort,
  type ModelAnswer,
  type ModelCall,
  type ModelMessage,
} from "./anthropic";
export { withRetry, backoffDelay, createLimiter, type RetryOptions } from "./retry";
export { EngineError, asEngineError, plainMessage, KEY_STORAGE_NOT_CONFIGURED, type EngineErrorCode } from "./errors";
export { decryptSecret, loadApiKey, type LoadApiKeyOptions } from "./secrets";
export { createSanityHttp, type SanityHttpConfig, type SanityLike } from "./sanityHttp";

export {
  buildFieldManifest,
  resolveManifestNode,
  NON_TEXT_FIELD_NAME,
  type FieldManifest,
  type ManifestNode,
  type ManifestDocumentType,
} from "../core/manifest";
export {
  extractUnits,
  buildPayload,
  validateStructure,
  applyUnits,
  readUnit,
  unitPairs,
  unitCharacters,
  unitStrings,
  sourceHashes,
  sourceFingerprint,
  structureHash,
  diffSource,
  isTranslatableValue,
  pruneBlock,
  blockText,
  STRUCTURE_HASH_PATH,
  type TranslationUnit,
  type UnitValue,
  type UnitPair,
  type SourceDiff,
  type SourceHashEntry,
} from "../core/payload";
export { checkExactMatch, comparePair, extractTokens, readNumber, type ExactMatchResult, type CheckFinding, type CheckCategory, type CheckToken } from "../core/check";
export { MODELS, RATES_AS_OF, modelInfo, costOf, DEFAULT_TRANSLATOR_MODEL, DEFAULT_REVIEWER_MODEL, CHARS_PER_TOKEN, TRANSLATION_OUTPUT_FACTOR, REVIEW_INPUT_FACTOR, REVIEW_OUTPUT_TOKENS, type ModelInfo, type TokenUsage } from "../core/pricing";
export { sha256Hex, stableStringify } from "../core/sha256";
export { pathToString, parsePath, getAtPath, setAtPath, type PathSegment } from "../core/paths";
export {
  encryptSecret,
  publicKeyFingerprint,
  translationId,
  toSlug,
  jobId,
  readGlossary,
  readStyleGuide,
  readEngineSettings,
  readLegalApprovers,
  isLegalApprover,
  LEGAL_APPROVERS_FIELD,
  ENGINE_SETTINGS_FIELDS,
  SECRETS_ID,
  SECRETS_TYPE,
  MANIFEST_ID,
  MANIFEST_TYPE,
  JOB_TYPE,
  JOB_ID_PREFIX,
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
  type StoredSecret,
} from "../core/engineModel";
export { translationMetaId, TRANSLATION_META_TYPE } from "../core/translations";
