import { defineField } from "sanity";
import type { FieldDefinition } from "sanity";
import {
  defineLanguages,
  languageFieldKey,
  type LanguagesInput,
} from "../core/languages";

/** Add this to the `groups` array of the host's Site Settings document type. */
export const LANGUAGES_GROUP = { name: "languages", title: "Languages" } as const;

export interface LanguagesFieldOptions {
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

const SWITCH_NOTE =
  "Switching a language on publishes nothing by itself. Pages in this language appear on the site only once they have been translated and marked ready.";

/**
 * A `languages` object field for the host's Site Settings, with one switch per
 * configured language. The default language is always on and read only.
 */
export function languagesField(options: LanguagesFieldOptions): FieldDefinition {
  const config = defineLanguages(options.languages);
  const fieldName = options.fieldName ?? "languages";
  const group = options.group === undefined ? LANGUAGES_GROUP.name : options.group;

  const fields = config.languages.map((lang) => {
    const isDefault = lang.id === config.defaultLanguage.id;
    return defineField({
      name: languageFieldKey(lang.id),
      title: lang.nativeTitle ?? lang.title,
      type: "boolean",
      initialValue: isDefault,
      readOnly: isDefault,
      description: isDefault
        ? `${lang.title} is the default language. Every translation is made from it, so it is always on.`
        : `${lang.title}. ${SWITCH_NOTE}`,
    });
  });

  return defineField({
    name: fieldName,
    title: "Languages",
    type: "object",
    description:
      "Which languages this site offers. The default language is always on. " +
      SWITCH_NOTE,
    options: { collapsible: false },
    fields,
    ...(group ? { group } : {}),
  });
}
