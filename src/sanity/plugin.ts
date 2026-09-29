import { definePlugin } from "sanity";
import { defineLanguages, type LanguagesConfig, type LanguagesInput } from "../core/languages";
import { translationMetaType } from "./translationMeta";

export const I18N_PLUGIN_NAME = "kaleidico-i18n";

export interface I18nPluginConfig {
  /** The languages the site can offer. Pass the result of `defineLanguages()` or a plain array. */
  languages: LanguagesInput;
}

/**
 * Sanity Studio plugin. Today it registers the `i18n.translationMeta` schema
 * type and carries the language config. Parts 2 to 4 add document
 * translation tooling, the desk structure entry and the translation engine
 * settings on top of this same plugin, so hosts add it once.
 */
export const i18nPlugin = definePlugin<I18nPluginConfig>((config) => {
  const languages: LanguagesConfig = defineLanguages(config.languages);

  // Kept on the plugin object so later parts (and tests) can read the
  // normalised language list without a second source of truth.
  return {
    name: I18N_PLUGIN_NAME,
    schema: {
      types: [translationMetaType],
    },
    // Not a Sanity option; harmless extra property that later parts read.
    ...({ i18n: { languages } } as Record<string, unknown>),
  };
});
