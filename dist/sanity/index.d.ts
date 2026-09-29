import { b as LanguagesInput } from '../languages-BzBBGlPy.js';
export { D as DEFAULT_LANGUAGE_ID, L as Language, a as LanguagesConfig, R as ReadEnabledLanguagesOptions, S as SettingsWithLanguages, d as defineLanguages, l as languageFieldKey, r as readEnabledLanguages } from '../languages-BzBBGlPy.js';
import * as sanity from 'sanity';
import { FieldDefinition } from 'sanity';

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

declare const I18N_PLUGIN_NAME = "kaleidico-i18n";
interface I18nPluginConfig {
    /** The languages the site can offer. Pass the result of `defineLanguages()` or a plain array. */
    languages: LanguagesInput;
}
/**
 * Sanity Studio plugin. Today it registers the `i18n.translationMeta` schema
 * type and carries the language config. Parts 2 to 4 add document
 * translation tooling, the desk structure entry and the translation engine
 * settings on top of this same plugin, so hosts add it once.
 */
declare const i18nPlugin: sanity.Plugin<I18nPluginConfig>;

/** Per-document translation states, in the order they are shown. */
declare const TRANSLATION_STATUSES: readonly [{
    readonly title: "Draft";
    readonly value: "draft";
}, {
    readonly title: "Needs update";
    readonly value: "needs-update";
}, {
    readonly title: "Awaiting approval";
    readonly value: "awaiting-approval";
}, {
    readonly title: "Approved";
    readonly value: "approved";
}];
type TranslationStatus = (typeof TRANSLATION_STATUSES)[number]["value"];
declare const TRANSLATION_META_TYPE = "i18n.translationMeta";
/**
 * Minimal metadata document that will link a translated document to its
 * source. Part 2 (document-level translations) adds the references to the
 * source and translated documents, the desk structure entry and the badges.
 * For now it only exists so the schema type name is reserved and stable.
 *
 * It is hidden from omnisearch. Hosts with a custom desk structure should not
 * list it; hosts using the default structure will see it until part 2 wires
 * it properly.
 */
declare const translationMetaType: {
    type: "document";
    name: "i18n.translationMeta";
} & Omit<sanity.DocumentDefinition, "preview"> & {
    preview?: sanity.PreviewConfig<{
        title: string;
        subtitle: string;
    }, Record<"title" | "subtitle", any>> | undefined;
};

export { I18N_PLUGIN_NAME, type I18nPluginConfig, LANGUAGES_GROUP, type LanguagesFieldOptions, LanguagesInput, TRANSLATION_META_TYPE, TRANSLATION_STATUSES, type TranslationStatus, i18nPlugin, languagesField, translationMetaType };
