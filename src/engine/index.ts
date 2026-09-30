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
export { runJob, resolveSanity, type EngineConfig, type JobOutcome } from "./job";
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
  type ReviewIssue,
  type JobKind,
  type JobMode,
  type JobStatus,
  type StoredSecret,
} from "../core/engineModel";
export { translationMetaId, TRANSLATION_META_TYPE } from "../core/translations";
