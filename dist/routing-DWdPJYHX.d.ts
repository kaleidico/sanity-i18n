import { b as LanguagesInput } from './languages-BzBBGlPy.js';

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

type I18nMiddlewareExclude = string | RegExp;
type LocaleRoute = {
    kind: "pass";
} | {
    kind: "rewrite";
    pathname: string;
} | {
    kind: "redirect";
    pathname: string;
    status: 308;
};
declare function isExcludedPath(pathname: string, exclude?: I18nMiddlewareExclude[]): boolean;
/** Normalise `languages` (a config, a list of languages or a list of ids) to ids plus the default id. */
declare function resolveLanguageIds(input: LanguagesInput | string[], defaultId?: string): {
    ids: string[];
    defaultId: string;
};
interface ResolveLocaleRouteOptions {
    /** Language ids that may appear as a URL prefix, including the default. */
    ids: readonly string[];
    /** The language served at the root. */
    defaultId: string;
    exclude?: I18nMiddlewareExclude[];
}
/** Decide what to do with a request path. Pure. */
declare function resolveLocaleRoute(pathname: string, options: ResolveLocaleRouteOptions): LocaleRoute;

export { type I18nMiddlewareExclude as I, type LocaleRoute as L, type ResolveLocaleRouteOptions as R, resolveLocaleRoute as a, isExcludedPath as i, resolveLanguageIds as r };
