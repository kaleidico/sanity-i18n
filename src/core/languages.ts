/**
 * Language configuration shared by every part of the package.
 *
 * This module has no Sanity or Next.js imports so it can be bundled into the
 * `/sanity`, `/next` and `/engine` entry points alike.
 */

export interface Language {
  /**
   * Short language code used in URLs, document metadata and the Site
   * Settings switches. Use BCP 47 style codes such as `es` or `pt-BR`.
   */
  id: string;
  /** The language's name as an English speaking editor would read it, e.g. `Spanish`. */
  title: string;
  /** The language's name in the language itself, e.g. `Español`. Falls back to `title`. */
  nativeTitle?: string;
  /**
   * Marks the source language every translation is made from. Exactly one
   * language is the default. When none is marked, `en` is the default.
   */
  default?: boolean;
}

/** The normalised result of `defineLanguages()`: default language first, then configured order. */
export interface LanguagesConfig {
  languages: Language[];
  defaultLanguage: Language;
}

/** Anything `defineLanguages()` accepts, or its own result. */
export type LanguagesInput =
  | readonly Language[]
  | { languages: readonly Language[] }
  | LanguagesConfig;

export const DEFAULT_LANGUAGE_ID = "en";

const ENGLISH: Language = {
  id: DEFAULT_LANGUAGE_ID,
  title: "English",
  nativeTitle: "English",
  default: true,
};

const ID_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function isConfig(input: LanguagesInput): input is LanguagesConfig {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    "defaultLanguage" in input
  );
}

/**
 * Validate and normalise a list of languages.
 *
 * Rules:
 * - Every id is a short language code (`es`, `pt-BR`) and unique.
 * - At most one language is marked `default`. When none is, English (`en`)
 *   is the default and is added to the front of the list if it is missing.
 * - The result lists the default language first, then the others in the
 *   order they were given.
 *
 * The same config object can be passed to `languagesField()`, `i18nPlugin()`
 * and `readEnabledLanguages()`, so define it once and share it.
 */
export function defineLanguages(input: LanguagesInput): LanguagesConfig {
  if (isConfig(input)) return input;

  const given = Array.isArray(input)
    ? (input as readonly Language[])
    : (input as { languages: readonly Language[] }).languages;

  if (!Array.isArray(given)) {
    throw new Error("defineLanguages: expected an array of languages");
  }

  const seen = new Set<string>();
  for (const lang of given) {
    if (!lang || typeof lang.id !== "string" || !ID_PATTERN.test(lang.id)) {
      throw new Error(
        `defineLanguages: invalid language id ${JSON.stringify(lang?.id)}. Use codes such as "es" or "pt-BR".`,
      );
    }
    if (typeof lang.title !== "string" || lang.title.trim() === "") {
      throw new Error(`defineLanguages: language "${lang.id}" needs a title`);
    }
    if (seen.has(lang.id)) {
      throw new Error(`defineLanguages: language "${lang.id}" is listed twice`);
    }
    seen.add(lang.id);
  }

  const marked = given.filter((l) => l.default === true);
  if (marked.length > 1) {
    throw new Error(
      `defineLanguages: only one language can be the default, got ${marked.map((l) => l.id).join(", ")}`,
    );
  }

  let list: Language[] = given.map((l) => ({ ...l, default: false }));
  let defaultLanguage: Language;

  if (marked.length === 1) {
    defaultLanguage = { ...marked[0], default: true };
  } else {
    const english = list.find((l) => l.id === DEFAULT_LANGUAGE_ID);
    defaultLanguage = english ? { ...english, default: true } : { ...ENGLISH };
  }

  list = [
    defaultLanguage,
    ...list.filter((l) => l.id !== defaultLanguage.id),
  ];

  return { languages: list, defaultLanguage };
}

/**
 * Sanity field names must be plain identifiers, so a language id such as
 * `pt-BR` is stored under the key `pt_BR` inside the `languages` object.
 */
export function languageFieldKey(id: string): string {
  return id.replace(/-/g, "_");
}

/** The shape `readEnabledLanguages()` reads from a Site Settings document. */
export interface SettingsWithLanguages {
  languages?: Record<string, boolean | null | undefined> | null;
  [key: string]: unknown;
}

export interface ReadEnabledLanguagesOptions {
  /** Name of the object field on the settings document. Defaults to `languages`. */
  fieldName?: string;
}

/**
 * Pure helper: given a Site Settings document (or the projected `languages`
 * object from it) return the languages that are switched on, in configured
 * order with the default language first.
 *
 * The default language is always included, whatever the document says, so a
 * site with no `languages` field yet still resolves to `[en]`.
 */
export function readEnabledLanguages(
  settingsDoc: SettingsWithLanguages | null | undefined,
  languages: LanguagesInput,
  options: ReadEnabledLanguagesOptions = {},
): Language[] {
  const config = defineLanguages(languages);
  const fieldName = options.fieldName ?? "languages";
  const raw = settingsDoc?.[fieldName];
  const flags: Record<string, unknown> =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return config.languages.filter((lang) => {
    if (lang.id === config.defaultLanguage.id) return true;
    return flags[languageFieldKey(lang.id)] === true;
  });
}
