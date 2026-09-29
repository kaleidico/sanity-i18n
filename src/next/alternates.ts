/**
 * Per-language URLs, hreflang and canonical tags, Open Graph locales and the
 * JSON-LD `inLanguage` value. Pure functions, no Next.js import, so the same
 * helpers serve `generateMetadata`, `sitemap.ts` and structured data.
 */
import { DEFAULT_LANGUAGE_ID } from "../core/languages";

/** Default region per language for BCP 47 tags and Open Graph locales. */
const DEFAULT_REGIONS: Record<string, string> = {
  en: "US",
  es: "US",
};

/**
 * The BCP 47 tag for a language id: `es` becomes `es-US`, `pt-BR` stays as
 * it is. Use it for `Intl.*`, `<html lang>` and JSON-LD `inLanguage`.
 */
export function languageTag(lang: string, region?: string): string {
  if (lang.includes("-")) return lang;
  const r = region ?? DEFAULT_REGIONS[lang];
  return r ? `${lang}-${r}` : lang;
}

/** The value of `inLanguage` in JSON-LD for a page in `lang`. */
export function inLanguage(lang: string, region?: string): string {
  return languageTag(lang, region);
}

/**
 * The path a page has in a language: the default language stays at the root,
 * every other language gets its prefix. `localePath("es", "/about")` is
 * `/es/about`; `localePath("en", "/")` is `/`; `localePath("es", "/")` is `/es`.
 */
export function localePath(lang: string, path: string, defaultId: string = DEFAULT_LANGUAGE_ID): string {
  const clean = path === "" ? "/" : path.startsWith("/") ? path : `/${path}`;
  if (lang === defaultId) return clean;
  return clean === "/" ? `/${lang}` : `/${lang}${clean}`;
}

/** The absolute URL of a page in a language. `siteUrl` must not end in a slash. */
export function localeUrl(siteUrl: string, lang: string, path: string, defaultId: string = DEFAULT_LANGUAGE_ID): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}${localePath(lang, path, defaultId)}`;
}

export interface BuildAlternatesOptions {
  /** Absolute site origin, e.g. `https://www.example.com`, no trailing slash. */
  siteUrl: string;
  /** The language of the page being rendered. */
  lang: string;
  /** The language served at the root. Defaults to `en`. */
  defaultId?: string;
  /** The page's own path in `lang`, without the language prefix, e.g. `/about`. */
  path: string;
  /**
   * The path of the same page in every other language it exists in, keyed by
   * language id and without the prefix: `{ es: "/sobre-nosotros" }`. Only list
   * languages that are live for this page; hreflang must be reciprocal.
   */
  translations?: Record<string, string | null | undefined>;
}

export interface AlternatesResult {
  canonical: string;
  languages: Record<string, string>;
}

/**
 * Next.js `Metadata.alternates` for one page: a self-referencing canonical in
 * the page's own language and an hreflang entry for every language the page
 * exists in, plus `x-default` pointing at the default-language URL.
 *
 * Every language's page should call this with the same set, so each one lists
 * the same alternates and the tags are reciprocal.
 */
export function buildAlternates(options: BuildAlternatesOptions): AlternatesResult {
  const defaultId = options.defaultId ?? DEFAULT_LANGUAGE_ID;
  const paths: Record<string, string> = {};
  for (const [id, path] of Object.entries(options.translations ?? {})) {
    if (typeof path === "string" && path !== "") paths[id] = path;
  }
  paths[options.lang] = options.path;

  const languages: Record<string, string> = {};
  const ordered = [
    ...(defaultId in paths ? [defaultId] : []),
    ...Object.keys(paths).filter((id) => id !== defaultId).sort(),
  ];
  for (const id of ordered) {
    languages[languageTag(id)] = localeUrl(options.siteUrl, id, paths[id], defaultId);
  }
  const xDefault = defaultId in paths ? paths[defaultId] : options.path;
  languages["x-default"] = localeUrl(options.siteUrl, defaultId in paths ? defaultId : options.lang, xDefault, defaultId);

  return {
    canonical: localeUrl(options.siteUrl, options.lang, options.path, defaultId),
    languages,
  };
}

export interface OpenGraphLocale {
  locale: string;
  alternateLocale?: string[];
}

/**
 * `og:locale` and `og:locale:alternate` for a page: `es` gives `es_US`, with
 * every other language in `others` listed as an alternate.
 */
export function openGraphLocale(lang: string, others: string[] = [], region?: string): OpenGraphLocale {
  const toOg = (id: string) => languageTag(id, region).replace("-", "_");
  const alternateLocale = others.filter((id) => id !== lang).map(toOg);
  return alternateLocale.length > 0 ? { locale: toOg(lang), alternateLocale } : { locale: toOg(lang) };
}
