export { L as Language, a as LanguagesConfig, b as LanguagesInput, d as defineLanguages } from '../languages-BzBBGlPy.js';

/**
 * @kaleidico/sanity-i18n/engine
 *
 * Server-only translation engine. Part 4 adds the real implementation: it
 * translates a Sanity document with the client's own Anthropic API key
 * (stored encrypted in Site Settings), applying the glossary, style guide,
 * exact-match checks and a reviewer pass before anything is written back.
 *
 * Nothing in this module may ever run in the browser, because the API key
 * would travel with it. The guard below throws on import in a browser.
 */

interface TranslateDocumentInput {
    /** The source document to translate. */
    document: Record<string, unknown>;
    /** Target language id, e.g. `es`. */
    targetLanguage: string;
}
/**
 * Placeholder for the translation engine. Calling it today throws.
 */
declare function translateDocument(_input: TranslateDocumentInput): Promise<never>;

export { type TranslateDocumentInput, translateDocument };
