import { NextRequest, NextResponse } from 'next/server.js';
import { b as LanguagesInput } from '../../languages-BzBBGlPy.js';
import { I as I18nMiddlewareExclude } from '../../routing-DWdPJYHX.js';
export { L as LocaleRoute, i as isExcludedPath, r as resolveLanguageIds, a as resolveLocaleRoute } from '../../routing-DWdPJYHX.js';

/**
 * @kaleidico/sanity-i18n/next/middleware
 *
 * The Next.js middleware step for locale routing. Kept in its own entry so
 * `@kaleidico/sanity-i18n/next` stays free of Next.js imports and can be used
 * from `sitemap.ts`, tests and plain Node.
 */

interface I18nMiddlewareOptions {
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
type I18nMiddleware = (request: NextRequest) => NextResponse | undefined;
type I18nMiddlewareAsync = (request: NextRequest) => Promise<NextResponse | undefined>;
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
declare function createI18nMiddleware(options: I18nMiddlewareOptions & {
    languages: LanguagesInput | string[];
}): I18nMiddleware;
declare function createI18nMiddleware(options: I18nMiddlewareOptions & {
    languages: () => unknown;
}): I18nMiddlewareAsync;

export { type I18nMiddleware, type I18nMiddlewareAsync, I18nMiddlewareExclude, type I18nMiddlewareOptions, createI18nMiddleware };
