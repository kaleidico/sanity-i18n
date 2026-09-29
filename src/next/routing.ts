/**
 * Locale routing decisions, with no Next.js import so they can be tested and
 * reused anywhere. `@kaleidico/sanity-i18n/next/middleware` turns a decision
 * into a `NextResponse`.
 *
 * The site keeps its default language at the root (`/about`) and every other
 * language under a prefix (`/es/sobre-nosotros`). The app itself lives under a
 * `[lang]` segment, so a request is either:
 *
 * - `rewrite`: a default-language path, served from `/<default>/...` without
 *   the public URL changing;
 * - `redirect`: a direct request to `/<default>/...`, sent (308) to the same
 *   path without the prefix so there is exactly one URL per page;
 * - `pass`: `/<lang>/...` for another language it is given, or an excluded
 *   path (`/api`, `/_next`, `/studio`, anything with a file extension, and
 *   anything in `exclude`).
 */
import { defineLanguages, type LanguagesInput } from "../core/languages";

export type I18nMiddlewareExclude = string | RegExp;

export type LocaleRoute =
  | { kind: "pass" }
  | { kind: "rewrite"; pathname: string }
  | { kind: "redirect"; pathname: string; status: 308 };

const ALWAYS_EXCLUDED = ["/api", "/_next", "/studio"];
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

function firstSegment(pathname: string): string {
  const rest = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

function stripPrefix(pathname: string, id: string): string {
  const stripped = pathname.slice(id.length + 1);
  return stripped === "" ? "/" : stripped;
}

/** True when `pathname` is `/<prefix>` or starts with `/<prefix>/`. */
function hasPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

export function isExcludedPath(pathname: string, exclude: I18nMiddlewareExclude[] = []): boolean {
  if (FILE_EXTENSION.test(pathname)) return true;
  for (const rule of [...ALWAYS_EXCLUDED, ...exclude]) {
    if (typeof rule === "string") {
      if (hasPrefix(pathname, rule)) return true;
    } else if (rule.test(pathname)) {
      return true;
    }
  }
  return false;
}

/** Normalise `languages` (a config, a list of languages or a list of ids) to ids plus the default id. */
export function resolveLanguageIds(input: LanguagesInput | string[], defaultId?: string): { ids: string[]; defaultId: string } {
  if (Array.isArray(input) && input.every((l) => typeof l === "string")) {
    const ids = input as string[];
    const def = defaultId ?? "en";
    return { ids: ids.includes(def) ? ids : [def, ...ids], defaultId: def };
  }
  const config = defineLanguages(input as LanguagesInput);
  return { ids: config.languages.map((l) => l.id), defaultId: defaultId ?? config.defaultLanguage.id };
}

export interface ResolveLocaleRouteOptions {
  /** Language ids that may appear as a URL prefix, including the default. */
  ids: readonly string[];
  /** The language served at the root. */
  defaultId: string;
  exclude?: I18nMiddlewareExclude[];
}

/** Decide what to do with a request path. Pure. */
export function resolveLocaleRoute(pathname: string, options: ResolveLocaleRouteOptions): LocaleRoute {
  const { ids, defaultId, exclude = [] } = options;
  if (isExcludedPath(pathname, exclude)) return { kind: "pass" };

  const segment = firstSegment(pathname);

  if (segment === defaultId) {
    return { kind: "redirect", pathname: stripPrefix(pathname, defaultId), status: 308 };
  }

  if (ids.includes(segment)) return { kind: "pass" };

  return { kind: "rewrite", pathname: pathname === "/" ? `/${defaultId}` : `/${defaultId}${pathname}` };
}
