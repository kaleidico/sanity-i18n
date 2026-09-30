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

export { LanguageSuggestion, type LanguageSuggestionLabels, type LanguageSuggestionProps, pickSuggestedLanguage };
