import { b as LanguagesInput, a as LanguagesConfig, L as Language } from '../languages-BzBBGlPy.js';
export { D as DEFAULT_LANGUAGE_ID, R as ReadEnabledLanguagesOptions, S as SettingsWithLanguages, d as defineLanguages, l as languageFieldKey, r as readEnabledLanguages } from '../languages-BzBBGlPy.js';
import { c as TranslationLabels, L as LANGUAGE_FIELD, e as TranslationStatus } from '../translations-CSuDvi7D.js';
export { I as I18N_FIELD, a as TRANSLATION_META_ID_PREFIX, T as TRANSLATION_META_TYPE, b as TRANSLATION_STATUSES, t as translationMetaId, g as translationStatusLabel, h as translationStatusList } from '../translations-CSuDvi7D.js';
import * as sanity from 'sanity';
import { FieldDefinition, DocumentDefinition, SchemaTypeDefinition, DocumentBadgeDescription, DocumentBadgeComponent, StringInputProps, SanityClient, DocumentActionComponent, Tool } from 'sanity';
import { StructureBuilder, ListItemBuilder } from 'sanity/structure';
import * as react from 'react';
import { p as JobKind, J as JobMode, at as CompiledSchemaLike, F as FieldManifest, V as TranslationJob } from '../pricing-h5vz3u-Z.js';
export { A as API_KEY_FIELD, C as CostEstimate, D as DEFAULT_REVIEWER_MODEL, i as DEFAULT_TRANSLATOR_MODEL, au as ENGINE_DOCUMENT_TYPES, j as ENGINE_FIELD, av as ENGINE_SETTINGS_FIELDS, E as EngineSettings, l as GLOSSARY_FIELD, G as Glossary, m as GlossaryTerm, n as JOB_ID_PREFIX, o as JOB_TYPE, q as JobStatus, M as MANIFEST_ID, r as MANIFEST_TYPE, s as MODELS, t as ManifestDocumentType, u as ManifestNode, v as ModelInfo, N as NON_TEXT_FIELD_NAME, w as RATES_AS_OF, R as ReviewIssue, z as SECRETS_ID, B as SECRETS_TYPE, I as STYLE_GUIDE_FIELD, a as SourceDiff, K as SourceHashEntry, S as StyleGuide, T as TranslationReport, b as TranslationUnit, Y as buildFieldManifest, a1 as diffSource, a2 as encryptSecret, a4 as extractUnits, ac as publicKeyFingerprint, ad as readEngineSettings, ae as readGlossary, ag as readStyleGuide, al as sourceHashes, an as toSlug, ao as translationId } from '../pricing-h5vz3u-Z.js';

/** Add this to the `groups` array of the host's Site Settings document type. */
declare const LANGUAGES_GROUP: {
    readonly name: "languages";
    readonly title: "Languages";
};
interface LanguagesFieldOptions {
    /** The languages the site can offer. Pass the result of `defineLanguages()` or a plain array. */
    languages: LanguagesInput;
    /**
     * Field group the switches land in. Defaults to `languages`, matching
     * `LANGUAGES_GROUP`. Pass `false` to leave the field ungrouped.
     */
    group?: string | false;
    /** Name of the object field. Defaults to `languages`. Keep in step with `readEnabledLanguages()`. */
    fieldName?: string;
}
/**
 * A `languages` object field for the host's Site Settings, with one switch per
 * configured language. The default language is always on and read only.
 */
declare function languagesField(options: LanguagesFieldOptions): FieldDefinition;

/** The marker `translatable()` stores on the type definition. */
declare const I18N_MARKER = "__i18n";
interface TranslatableMarker {
    sharedFields: string[];
    slugField: string;
    defaultLanguage: string;
}
interface TranslatableOptions {
    /**
     * The languages the site can offer. Used to know which language is the
     * default. When omitted, English (`en`) is the default.
     */
    languages?: LanguagesInput;
    /**
     * Fields that are the same in every language: photos, phone numbers, NMLS
     * numbers, references. On a translated document they are read only, with a
     * note to edit them on the default-language document, and the front end
     * reads them from the source document (see `sharedProjection`).
     */
    sharedFields?: readonly string[];
    /** Name of the slug field whose uniqueness is checked per language. Defaults to `slug`. */
    slugField?: string;
    /** Hide the `language` field on default-language documents. Defaults to false. */
    hideLanguageOnDefault?: boolean;
    /** Host overrides for the status titles, e.g. `{ awaiting_approval: "Awaiting NOVA approval" }`. */
    labels?: TranslationLabels;
}
type DocumentLike = {
    [LANGUAGE_FIELD]?: unknown;
    [key: string]: unknown;
} | undefined;
/** True when the document is a translation, i.e. its language is set and is not the default. */
declare function isTranslationDocument(document: DocumentLike, defaultId?: string): boolean;
/**
 * Wrap a Sanity document type definition so each language is its own
 * document linked to the default-language one.
 *
 * Adds, at the top of the type:
 * - `language` (string, read only, initial value = default language)
 * - `i18n` (object "Translation"): `source` reference, `status`, `sourceHash`,
 *   `translatedAt`, `approvedAt`, `approvedBy`, and the engine's hidden
 *   `sourceHashes` and `report`. Hidden on default-language documents.
 *
 * And on the existing fields:
 * - every `sharedFields` entry becomes read only on translations, with a note
 * - the slug field's uniqueness is checked within the same language
 * - the preview subtitle of a translation shows its language and status
 *
 * The input definition is not changed; a new one is returned.
 */
declare function translatable<T extends DocumentDefinition>(documentType: T, options?: TranslatableOptions): T;
/** The shared field names `translatable()` recorded on a type definition, or `[]` when it was not wrapped. */
declare function getSharedFields(typeDef: unknown): string[];
/** The full marker `translatable()` stored on a type definition, or `undefined` when it was not wrapped. */
declare function getTranslatableMarker(typeDef: unknown): TranslatableMarker | undefined;
/** True when a type definition was wrapped with `translatable()`. */
declare function isTranslatable(typeDef: unknown): boolean;

/**
 * Legal marking. A field or block type marked legal carries text that a
 * person must approve before it goes live in another language: disclaimers,
 * disclosures, consent language, NMLS and Equal Housing lines.
 *
 * The mark lives in `options.i18n.legal` so it survives schema compilation
 * and can be read from the definition, the compiled schema type and the
 * field on a compiled object type alike.
 */
declare const LEGAL_NOTE = "(legal text: needs approval before it goes live in another language)";
/**
 * Anything with an optional `options` and `description`: a field definition,
 * an array member or a type definition. Kept loose on purpose so Sanity's
 * own option types (`StringOptions`, `TextOptions`, ...) are accepted as is.
 */
interface WithOptions {
    options?: unknown;
    description?: unknown;
}
/** Mark a field definition as legal text. Returns a new definition; the input is not changed. */
declare function legalText<T extends WithOptions>(fieldDef: T): T;
/** Mark an object or block type definition as legal text. Returns a new definition; the input is not changed. */
declare function legalBlock<T extends WithOptions>(blockTypeDef: T): T;
/**
 * Mark a field as never translated: a machine name, a stored value, an id.
 * The translation engine leaves it exactly as it is in the source. Returns a
 * new definition; the input is not changed.
 *
 * The engine already skips URLs, fixed choices, references, slugs and fields
 * whose name marks them as plumbing (`href`, `ctaUrl`, `gtmId`). Use this for
 * a plain string field it cannot tell apart from copy, such as a form
 * field's `name`. The opposite, `options: { i18n: { translate: true } }`,
 * forces a field to be translated.
 */
declare function noTranslate<T extends WithOptions>(fieldDef: T): T;
/** True when a field, member or schema type carries the legal mark. */
declare function isLegal(schemaTypeOrField: unknown): boolean;
interface CollectLegalPathsOptions {
    /**
     * Named types the document's arrays may reference (`of: [{ type: "consentBlock" }]`).
     * Without them only inline members and fields can be inspected.
     */
    types?: readonly SchemaTypeDefinition[];
}
/**
 * The paths of every legal field in a document type, as strings:
 *
 * - `footerDisclaimer` for a legal field
 * - `contact.consentLine` for a legal field inside an object field
 * - `legalLinks[].label` for a legal field inside an inline array member
 * - `fields[consentField].consentText` for a legal field inside a named array member
 * - `blocks[disclosureBlock]` for a whole array member type marked with `legalBlock`
 *
 * Arrays are followed one level deep: the members' own fields are inspected,
 * but arrays inside those members are not.
 */
declare function collectLegalPaths(documentTypeDef: SchemaTypeDefinition | {
    fields?: unknown[];
}, options?: CollectLegalPathsOptions): string[];

interface TranslationMetaOptions {
    /** The document types that were wrapped with `translatable()`. The `document` reference can point at any of them. */
    translatableTypes: readonly string[];
}
/**
 * The metadata document that links one source document to every language it
 * exists in. One per source, id `i18n-meta-<sourceId>` (see `translationMetaId`).
 *
 * Both directions resolve in GROQ: a translation's `i18n.source` points at
 * the source document, and this document lists all languages (the source
 * included) with a weak reference to each.
 *
 * Hidden from omnisearch. Hosts with a custom desk structure should not list
 * it; `translationsStructure()` does not either.
 */
declare function translationMetaType(options: TranslationMetaOptions): DocumentDefinition;

interface TranslationBadgeOptions {
    /** The default language id. Defaults to `en`. */
    defaultId?: string;
    /** Host overrides for the status titles. */
    labels?: TranslationLabels;
}
/**
 * Badge colour per status. Sanity offers four colours; the draft state uses
 * none so it reads as the neutral grey badge.
 */
declare const TRANSLATION_BADGE_COLORS: Record<TranslationStatus, DocumentBadgeDescription["color"] | undefined>;
/**
 * A document badge showing the language in upper case plus, on a
 * translation, the status label: `ES · Awaiting approval`. Default-language
 * documents show just the language. Documents without a `language` field
 * (created before the package was installed) show nothing.
 */
declare function translationBadge(options?: TranslationBadgeOptions): DocumentBadgeComponent;

/**
 * GROQ clause for a desk list that should show one language only. Use it in
 * the list's filter together with the type clause, because `.filter()` on a
 * document type list replaces the default `_type == $type` filter:
 *
 * `S.documentTypeList("page").filter(\`_type == $type && ${languageFilter("en")}\`)`
 *
 * For the default language the clause also matches documents with no
 * `language` field, so existing content stays listed.
 */
declare function languageFilter(languageId: string, defaultId?: string): string;
interface TranslationsStructureOptions {
    /** The languages the site can offer. Every language but the default gets a list. */
    languages: LanguagesInput;
    /** The document types wrapped with `translatable()`, in the order to list them. */
    types: readonly string[];
    /** Titles per type for the list items. Defaults to the type name. */
    titles?: Readonly<Record<string, string>>;
    /** Title of the section. Defaults to "Translations". */
    title?: string;
}
/**
 * A desk section "Translations" with one child per non-default language,
 * each listing the translatable types filtered to that language. Every
 * translation's preview subtitle starts with its status (see `translatable()`),
 * so the lists read as a review queue.
 *
 * Add it to the items of the root list:
 *
 * `S.list().title("Content").items([ ..., translationsStructure(S, { languages, types }) ])`
 */
declare function translationsStructure(S: StructureBuilder, options: TranslationsStructureOptions): ListItemBuilder;

declare const I18N_PLUGIN_NAME = "kaleidico-i18n";
/** The document types the package adds for its own bookkeeping. Leave them out of desk lists. */
declare const I18N_HIDDEN_TYPES: readonly string[];
interface I18nEngineConfig {
    /** Where the site mounts `createTranslateRoute()`. Defaults to `/api/i18n/translate`. */
    endpoint?: string;
    /** The Site Settings document type. Defaults to `settings`. */
    settingsType?: string;
    /** Name of the languages field on Site Settings. Defaults to `languages`. */
    languagesField?: string;
    /** How many translations the Translations tool runs at once. Defaults to 2. */
    concurrency?: number;
}
interface I18nPluginConfig {
    /** The languages the site can offer. Pass the result of `defineLanguages()` or a plain array. */
    languages: LanguagesInput;
    /**
     * The document types wrapped with `translatable()`. They get the language
     * and status badge, and the `i18n.translationMeta` document type is
     * registered so it can reference them. Leave empty until a type is wrapped.
     */
    translatableTypes?: readonly string[];
    /** Host overrides for the status titles, e.g. `{ awaiting_approval: "Awaiting NOVA approval" }`. Keep in step with `translatable()`. */
    labels?: TranslationLabels;
    /** Titles per document type, shown in the Translations tool. Defaults to the type name. */
    titles?: Readonly<Record<string, string>>;
    /**
     * The translation engine in the Studio: the "Translate to <Language>"
     * action, the check that marks translations "Needs update" when the English
     * is published, and the Translations tool. On by default once a type is
     * translatable; pass `false` to leave all three out.
     */
    engine?: I18nEngineConfig | false;
}
/**
 * Sanity Studio plugin. Carries the language config, registers the
 * `i18n.translationMeta` document type for the translatable types, adds the
 * language and status badge to them, and wires the translation engine into
 * the Studio. Hosts add it once.
 */
declare const i18nPlugin: sanity.Plugin<I18nPluginConfig>;

/**
 * The Site Settings fields of the translation engine. All four belong on the
 * default-language settings document and are the same for every language, so
 * on a translatable settings type list them in `sharedFields`. They are also
 * marked never to be translated, so a missed `sharedFields` entry cannot send
 * a glossary through the translator.
 */
interface EngineFieldOptions {
    /** Name of the field. Each field has its own default. */
    name?: string;
    /** Field group. Defaults to `languages`, matching `LANGUAGES_GROUP`. Pass `false` to leave the field ungrouped. */
    group?: string | false;
}
/** The glossary: what is never translated, and the terms that always translate the same way. */
declare function glossaryField(options?: EngineFieldOptions): FieldDefinition;
/** The style guide: market, register, audience and any house notes. */
declare function styleGuideField(options?: EngineFieldOptions): FieldDefinition;
/** Which Claude model translates and which one reviews. */
declare function engineField(options?: EngineFieldOptions): FieldDefinition;
interface ApiKeyFieldOptions extends EngineFieldOptions {
    /**
     * The site's public key (SPKI, base64), as printed by
     * `sanity-i18n-generate-keys`. In a Next.js app pass
     * `process.env.NEXT_PUBLIC_I18N_PUBLIC_KEY`. When it is missing the field
     * says that key storage is not configured instead of offering an input.
     */
    publicKey?: string;
}
/**
 * The Anthropic API key. The field stores nothing in Site Settings: the key
 * is encrypted in the browser with the site's public key and only the
 * ciphertext goes to a private document. It is never shown again.
 */
declare function apiKeyField(options?: ApiKeyFieldOptions): FieldDefinition;

/** Shown in place of the input when the site has no public key to encrypt with. */
declare const KEY_STORAGE_NOT_CONFIGURED = "Translation key storage is not configured on this server yet.";
/**
 * The input for the site's Anthropic API key. It never holds a saved key:
 * what is typed is encrypted in the browser with the site's public key, only
 * the ciphertext is written (to the private `i18n.secrets` document, with the
 * editor's own session), and the field is cleared. After that the Studio can
 * only say that a key is saved and what its last four characters are.
 */
declare function ApiKeyInput(props: StringInputProps): react.JSX.Element;

declare const DEFAULT_ENDPOINT = "/api/i18n/translate";
interface StudioEngineOptions {
    languages: LanguagesConfig;
    translatableTypes: readonly string[];
    /** Where the site mounts `createTranslateRoute()`. Defaults to `/api/i18n/translate`. */
    endpoint?: string;
    /** The Site Settings document type. Defaults to `settings`. */
    settingsType?: string;
    /** Name of the languages field on Site Settings. Defaults to `languages`. */
    languagesField?: string;
    /** How many translations the Translations tool runs at once. Defaults to 2. */
    concurrency?: number;
}
/**
 * Build the manifest from the Studio's schema and store it for the server
 * when it changed. Called before every job, so the server always works from
 * the schema the editor is looking at.
 */
declare function ensureManifest(client: SanityClient, schema: CompiledSchemaLike, options: Pick<StudioEngineOptions, "languages" | "translatableTypes">): Promise<FieldManifest>;
interface NewJob {
    kind: JobKind;
    language: string;
    mode?: JobMode;
    sourceId?: string;
    sourceType?: string;
    sourceIds?: string[];
    requestedBy?: string;
}
/** Create a pending job document and return its id. */
declare function createJob(client: SanityClient, job: NewJob): Promise<string>;
/**
 * Tell the server a job is waiting. The answer arrives when the job is
 * finished, which can take minutes, so callers watch the job document rather
 * than wait on this. It resolves to a plain message when the server could
 * not take the job at all, and to null otherwise.
 */
declare function startJob(endpoint: string, id: string): Promise<string | null>;
/** Read a job until it is finished, reporting each state on the way. Gives up after `timeoutMs` and returns the last state. */
declare function watchJob(client: SanityClient, id: string, onUpdate: (job: TranslationJob) => void, options?: {
    intervalMs?: number;
    timeoutMs?: number;
    cancelled?: () => boolean;
}): Promise<TranslationJob | null>;

interface TranslateActionOptions extends StudioEngineOptions {
    /** The language this action translates into. */
    language: Language;
    labels?: TranslationLabels;
}
declare function JobOutcomeView({ job, languageTitle }: {
    job: TranslationJob;
    languageTitle: string;
}): react.JSX.Element | null;
/**
 * The document action "Translate to <Language>". Shown on default-language
 * documents of a translatable type, for a language that is switched on in
 * Site Settings. It translates the published document, so it is disabled
 * until there is one.
 */
declare function translateAction(options: TranslateActionOptions): DocumentActionComponent;

interface PublishWithStaleCheckOptions {
    languages: LanguagesConfig;
}
/**
 * Wrap the publish action so that publishing a default-language document
 * checks its translations. A translation whose stored source hashes no longer
 * match the English is marked "Needs update". Translations made by hand,
 * which have no stored hashes, are left alone because there is nothing to
 * compare them with.
 */
declare function publishWithStaleCheck(original: DocumentActionComponent, options: PublishWithStaleCheckOptions): DocumentActionComponent;

interface TranslationsToolOptions extends StudioEngineOptions {
    /** Titles per document type. Defaults to the type name. */
    titles?: Readonly<Record<string, string>>;
    labels?: TranslationLabels;
}
interface SourceRow {
    _id: string;
    _type: string;
}
interface TranslationRow {
    _id: string;
    _type: string;
    source?: string;
    status?: string;
    hasHashes?: boolean;
}
interface TypeCounts {
    type: string;
    total: number;
    translated: number;
    needsUpdate: number;
    awaitingApproval: number;
    approved: number;
    /** What a run would do: translate documents that have no translation, update the ones that need it. */
    work: {
        sourceId: string;
        mode: JobMode;
    }[];
}
declare function summarise(sources: SourceRow[], translations: TranslationRow[], types: readonly string[]): TypeCounts[];
/** The "Translations" Studio tool: counts per language and type, a cost estimate, and a bulk run. */
declare function translationsTool(options: TranslationsToolOptions): Tool<TranslationsToolOptions>;

/** `i18n.sourceHashes`: one SHA-256 per translated unit of the source, plus one for everything that is not text. */
declare function sourceHashesField(): FieldDefinition;
/** The fields of a run's report. Stored on the job and, as `i18n.report`, on the translation. */
declare function reportFields(): FieldDefinition[];
/** `i18n.report`: the report of the run that produced this translation. */
declare function reportField(): FieldDefinition;
/** `i18n.job`: a request for the server to translate or estimate. Private: its id has a period in it. */
declare function translationJobType(): DocumentDefinition;
/** `i18n.secrets`: the encrypted API key. Private: its id has a period in it, and the key cannot be read back from it. */
declare function translationSecretsType(): DocumentDefinition;
/** `i18n.manifest`: the list of translatable fields the Studio keeps for the server. */
declare function translationManifestType(): DocumentDefinition;

export { type ApiKeyFieldOptions, ApiKeyInput, type CollectLegalPathsOptions, CompiledSchemaLike, DEFAULT_ENDPOINT, type EngineFieldOptions, FieldManifest, I18N_HIDDEN_TYPES, I18N_MARKER, I18N_PLUGIN_NAME, type I18nEngineConfig, type I18nPluginConfig, JobMode, JobOutcomeView, KEY_STORAGE_NOT_CONFIGURED, LANGUAGES_GROUP, LANGUAGE_FIELD, LEGAL_NOTE, Language, LanguagesConfig, type LanguagesFieldOptions, LanguagesInput, type NewJob, type PublishWithStaleCheckOptions, type StudioEngineOptions, TRANSLATION_BADGE_COLORS, type TranslatableMarker, type TranslatableOptions, type TranslateActionOptions, type TranslationBadgeOptions, TranslationJob, TranslationLabels, type TranslationMetaOptions, TranslationStatus, type TranslationsStructureOptions, type TranslationsToolOptions, apiKeyField, collectLegalPaths, createJob, engineField, ensureManifest, getSharedFields, getTranslatableMarker, glossaryField, i18nPlugin, isLegal, isTranslatable, isTranslationDocument, languageFilter, languagesField, legalBlock, legalText, noTranslate, publishWithStaleCheck, reportField, reportFields, sourceHashesField, startJob, styleGuideField, summarise as summariseTranslations, translatable, translateAction, translationBadge, translationJobType, translationManifestType, translationMetaType, translationSecretsType, translationsStructure, translationsTool, watchJob };
