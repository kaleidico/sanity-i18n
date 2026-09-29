import { b as LanguagesInput } from '../languages-BzBBGlPy.js';
export { D as DEFAULT_LANGUAGE_ID, L as Language, a as LanguagesConfig, R as ReadEnabledLanguagesOptions, S as SettingsWithLanguages, d as defineLanguages, l as languageFieldKey, r as readEnabledLanguages } from '../languages-BzBBGlPy.js';
import { c as TranslationLabels, L as LANGUAGE_FIELD, e as TranslationStatus } from '../translations-C_O1i3oQ.js';
export { I as I18N_FIELD, T as TRANSLATION_META_ID_PREFIX, a as TRANSLATION_META_TYPE, b as TRANSLATION_STATUSES, f as translationMetaId, g as translationStatusLabel, h as translationStatusList } from '../translations-C_O1i3oQ.js';
import * as sanity from 'sanity';
import { FieldDefinition, DocumentDefinition, SchemaTypeDefinition, DocumentBadgeDescription, DocumentBadgeComponent } from 'sanity';
import { StructureBuilder, ListItemBuilder } from 'sanity/structure';

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
 *   `translatedAt`, `approvedAt`, `approvedBy`. Hidden on default-language documents.
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
interface WithOptions {
    options?: Record<string, unknown> & {
        i18n?: {
            legal?: boolean;
        };
    };
    description?: unknown;
}
/** Mark a field definition as legal text. Returns a new definition; the input is not changed. */
declare function legalText<T extends WithOptions>(fieldDef: T): T;
/** Mark an object or block type definition as legal text. Returns a new definition; the input is not changed. */
declare function legalBlock<T extends WithOptions>(blockTypeDef: T): T;
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
 * exists in. One per source, id `i18n.meta.<sourceId>` (see `translationMetaId`).
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
}
/**
 * Sanity Studio plugin. Carries the language config, registers the
 * `i18n.translationMeta` document type for the translatable types and adds
 * the language and status badge to them. Parts 4 and 5 add the translate
 * actions and the approval workflow on top of this same plugin, so hosts add
 * it once.
 */
declare const i18nPlugin: sanity.Plugin<I18nPluginConfig>;

export { type CollectLegalPathsOptions, I18N_MARKER, I18N_PLUGIN_NAME, type I18nPluginConfig, LANGUAGES_GROUP, LANGUAGE_FIELD, LEGAL_NOTE, type LanguagesFieldOptions, LanguagesInput, TRANSLATION_BADGE_COLORS, type TranslatableMarker, type TranslatableOptions, type TranslationBadgeOptions, TranslationLabels, type TranslationMetaOptions, TranslationStatus, type TranslationsStructureOptions, collectLegalPaths, getSharedFields, getTranslatableMarker, i18nPlugin, isLegal, isTranslatable, isTranslationDocument, languageFilter, languagesField, legalBlock, legalText, translatable, translationBadge, translationMetaType, translationsStructure };
