/**
 * @kaleidico/sanity-i18n/next/middleware
 *
 * The Next.js middleware step for locale routing. Kept in its own entry so
 * `@kaleidico/sanity-i18n/next` stays free of Next.js imports and can be used
 * from `sitemap.ts`, tests and plain Node.
 */
import { NextResponse, type NextRequest } from "next/server.js";
import type { LanguagesInput } from "../../core/languages";
import { resolveLanguageIds, resolveLocaleRoute, type I18nMiddlewareExclude } from "../routing";

export type { I18nMiddlewareExclude, LocaleRoute } from "../routing";
export { resolveLocaleRoute, resolveLanguageIds, isExcludedPath } from "../routing";

export interface I18nMiddlewareOptions {
  /**
   * The languages that may appear as a URL prefix: the full config, a list of
   * ids, or the languages currently switched on in Site Settings. Pass a
   * function to resolve them per request (for example from a cached settings
   * fetch); the returned middleware is then async.
   */
  languages: LanguagesInput | string[] | (() => LanguagesInput | string[] | Promise<LanguagesInput | string[]>);
  /** The language served at the root. Defaults to the config's default language, or `en`. */
  defaultId?: string;
  /**
   * Paths to leave alone, as prefixes (`/preview`) or patterns. `/api`,
   * `/_next`, `/studio` and any path whose last segment has a file extension
   * are always excluded.
   */
  exclude?: I18nMiddlewareExclude[];
}

export type I18nMiddleware = (request: NextRequest) => NextResponse | undefined;
export type I18nMiddlewareAsync = (request: NextRequest) => Promise<NextResponse | undefined>;

function respond(request: NextRequest, ids: string[], defaultId: string, exclude: I18nMiddlewareExclude[]): NextResponse | undefined {
  const route = resolveLocaleRoute(request.nextUrl.pathname, { ids, defaultId, exclude });
  if (route.kind === "pass") return undefined;
  const url = request.nextUrl.clone();
  url.pathname = route.pathname;
  return route.kind === "redirect" ? NextResponse.redirect(url, route.status) : NextResponse.rewrite(url);
}

/**
 * Build the locale-routing step of a Next.js middleware. Call it first and
 * return its result when it gives one; otherwise carry on with the site's own
 * middleware logic.
 *
 * ```ts
 * const i18n = createI18nMiddleware({ languages, exclude: ["/preview"] });
 * export function middleware(request: NextRequest) {
 *   return i18n(request) ?? NextResponse.next();
 * }
 * ```
 *
 * With a static `languages` list the returned function is synchronous. Pass a
 * function to resolve the enabled languages per request and it becomes async.
 */
export function createI18nMiddleware(options: I18nMiddlewareOptions & { languages: LanguagesInput | string[] }): I18nMiddleware;
export function createI18nMiddleware(options: I18nMiddlewareOptions & { languages: () => unknown }): I18nMiddlewareAsync;
export function createI18nMiddleware(options: I18nMiddlewareOptions): I18nMiddleware | I18nMiddlewareAsync {
  const exclude = options.exclude ?? [];

  if (typeof options.languages === "function") {
    const resolve = options.languages;
    return async (request: NextRequest) => {
      const { ids, defaultId } = resolveLanguageIds(await resolve(), options.defaultId);
      return respond(request, ids, defaultId, exclude);
    };
  }

  const { ids, defaultId } = resolveLanguageIds(options.languages, options.defaultId);
  return (request: NextRequest) => respond(request, ids, defaultId, exclude);
}
