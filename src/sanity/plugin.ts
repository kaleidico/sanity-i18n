import { definePlugin } from "sanity";
import { defineLanguages, type LanguagesConfig, type LanguagesInput } from "../core/languages";
import type { TranslationLabels } from "../core/translations";
import { translationBadge } from "./badge";
import { translationMetaType } from "./translationMeta";

export const I18N_PLUGIN_NAME = "kaleidico-i18n";

export interface I18nPluginConfig {
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
export const i18nPlugin = definePlugin<I18nPluginConfig>((config) => {
  const languages: LanguagesConfig = defineLanguages(config.languages);
  const translatableTypes = [...(config.translatableTypes ?? [])];
  const badge = translationBadge({ defaultId: languages.defaultLanguage.id, labels: config.labels });

  return {
    name: I18N_PLUGIN_NAME,
    schema: {
      types: translatableTypes.length > 0 ? [translationMetaType({ translatableTypes })] : [],
    },
    document: {
      badges: (prev, context) =>
        translatableTypes.includes(context.schemaType) ? [...prev, badge] : prev,
    },
    // Not a Sanity option; harmless extra property that later parts read.
    ...({ i18n: { languages, translatableTypes } } as Record<string, unknown>),
  };
});
