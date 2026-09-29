/**
 * A small typed UI dictionary for the strings the site itself owns: buttons,
 * navigation labels, form labels and errors, the 404 page, the cookie banner.
 * Content comes from Sanity in each language; this is for everything else.
 *
 * ```ts
 * const dictionary = createDictionary({
 *   en: { readMore: "Read more", minRead: "{minutes} min read" },
 *   es: { readMore: "Leer más", minRead: "{minutes} min de lectura" },
 * });
 * dictionary.t("es", "minRead", { minutes: 4 }); // "4 min de lectura"
 * ```
 *
 * Every language must define every key of the default language; TypeScript
 * enforces it, so a missing translation fails the build rather than falling
 * back to English at runtime.
 */

export type DictionaryStrings<K extends string> = Record<K, string>;

export type DictionaryInput<D extends string, K extends string> = Record<D, DictionaryStrings<K>> &
  Record<string, DictionaryStrings<K>>;

export type TranslateVars = Record<string, string | number>;

export interface Dictionary<K extends string> {
  /** The language ids the dictionary covers. */
  languages: string[];
  /** The default language, used when `lang` is not covered. */
  defaultId: string;
  /** Every key, in the order the default language lists them. */
  keys: K[];
  /** True when `lang` has its own strings. */
  has(lang: string): boolean;
  /** The string for `key` in `lang`, with `{name}` placeholders filled from `vars`. */
  t(lang: string, key: K, vars?: TranslateVars): string;
  /** A `t` bound to one language, for components that render in a single language. */
  for(lang: string): (key: K, vars?: TranslateVars) => string;
}

export interface CreateDictionaryOptions {
  /** The language whose keys define the key list. Defaults to `en`, or the first language given. */
  defaultId?: string;
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function createDictionary<K extends string, D extends string = "en">(
  input: DictionaryInput<D, K>,
  options: CreateDictionaryOptions = {},
): Dictionary<K> {
  const languages = Object.keys(input);
  if (languages.length === 0) {
    throw new Error("createDictionary: at least one language is required");
  }
  const defaultId = options.defaultId ?? (languages.includes("en") ? "en" : languages[0]);
  const base = input[defaultId];
  if (!base) {
    throw new Error(`createDictionary: no strings for the default language "${defaultId}"`);
  }
  const keys = Object.keys(base) as K[];

  for (const lang of languages) {
    const missing = keys.filter((key) => typeof input[lang][key] !== "string");
    if (missing.length > 0) {
      throw new Error(`createDictionary: language "${lang}" is missing ${missing.length} key(s): ${missing.join(", ")}`);
    }
  }

  const strings = (lang: string): DictionaryStrings<K> => input[lang] ?? base;

  const t = (lang: string, key: K, vars?: TranslateVars): string => {
    const value = strings(lang)[key] ?? base[key];
    if (typeof value !== "string") {
      throw new Error(`createDictionary: unknown key "${String(key)}"`);
    }
    return interpolate(value, vars);
  };

  return {
    languages,
    defaultId,
    keys,
    has: (lang) => lang in input,
    t,
    for: (lang) => (key, vars) => t(lang, key, vars),
  };
}
