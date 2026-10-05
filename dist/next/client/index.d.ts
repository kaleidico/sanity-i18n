import * as react from 'react';

/**
 * Language configuration shared by every part of the package.
 *
 * This module has no Sanity or Next.js imports so it can be bundled into the
 * `/sanity`, `/next` and `/engine` entry points alike.
 */
interface Language {
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

/**
 * Matching a link against a list of host patterns, and the two small types
 * the client-side notice needs. No imports, so the browser bundle that
 * carries the notice carries nothing else.
 */
/** The words of the dialog, in the page's language. */
interface ApplyNoticeText {
    title: string;
    body: string;
    continueLabel: string;
    cancelLabel: string;
}
/**
 * `off`: do nothing. `active`: intercept matching links and show the notice.
 * `blocked`: hide matching links, because the notice is on and has no
 * approved wording in this language.
 */
type ApplyNoticeState = "off" | "active" | "blocked";
/** The host of a link, lower case, or null for a relative link, a fragment, `mailto:`, `tel:` and anything else that is not http(s). */
declare function linkHost(href: string | null | undefined, base?: string): string | null;
/** True when a host matches a pattern: the same host, or under it when the pattern starts with `*.`. */
declare function hostMatches(host: string, pattern: string): boolean;
/**
 * True when a link goes to one of the hosts the notice applies to. A relative
 * link is the site's own and never matches (pass `base` to resolve it first
 * when the site's own host is on the list).
 */
declare function matchesApplyHost(href: string | null | undefined, patterns: readonly string[], base?: string): boolean;

interface ExternalApplyNoticeClassNames {
    overlay?: string;
    dialog?: string;
    title?: string;
    body?: string;
    actions?: string;
    continue?: string;
    cancel?: string;
}
interface ExternalApplyNoticeProps {
    /** The language of the page. */
    lang: string;
    /** The default language. The component does nothing on a page in it. */
    defaultId: string;
    state: ApplyNoticeState;
    /** The host patterns from `resolveApplyNotice()`. */
    hosts: readonly string[];
    /** The words, in the page's language. Required when `state` is `active`. */
    notice?: ApplyNoticeText;
    classNames?: ExternalApplyNoticeClassNames;
}
declare function ExternalApplyNotice(props: ExternalApplyNoticeProps): react.JSX.Element | null;

interface LanguageSuggestionLabels {
    /** The message, in the suggested language: "Este sitio está disponible en español." */
    text: string;
    /** The link text, in the suggested language: "Ver en español". */
    link: string;
    /** The close button's accessible name, in the suggested language: "Cerrar". */
    dismiss: string;
}
interface LanguageSuggestionProps {
    /** The language of the page being rendered. */
    current: string;
    /** The language served at the root. The strip only shows on pages in this language. */
    defaultId: string;
    /** The languages switched on. Only non-default ones can be suggested. */
    languages: readonly Language[];
    /** Where each language's version of this page is (or its home page): `{ es: "/es/sobre-nosotros" }`. */
    links: Record<string, string | null | undefined>;
    /** Labels per suggested language. A language without labels is never suggested. */
    labels: Record<string, LanguageSuggestionLabels>;
    /** Days a dismissal is remembered. Defaults to 30. */
    days?: number;
    /** `localStorage` key. Defaults to `i18n-suggestion-dismissed`. */
    storageKey?: string;
    className?: string;
    textClassName?: string;
    linkClassName?: string;
    dismissClassName?: string;
    /** Rendered inside the close button. Defaults to a multiplication sign. */
    dismissIcon?: React.ReactNode;
}
/** The first enabled non-default language the browser prefers, matched on the primary subtag. */
declare function pickSuggestedLanguage(preferred: readonly string[], languages: readonly Language[], defaultId: string): Language | undefined;
declare function LanguageSuggestion(props: LanguageSuggestionProps): react.JSX.Element | null;

export { ExternalApplyNotice, type ExternalApplyNoticeClassNames, type ExternalApplyNoticeProps, LanguageSuggestion, type LanguageSuggestionLabels, type LanguageSuggestionProps, hostMatches, linkHost, matchesApplyHost, pickSuggestedLanguage };
