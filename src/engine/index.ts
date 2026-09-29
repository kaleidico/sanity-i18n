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

function assertServer(): void {
  if (typeof window !== "undefined" || typeof document !== "undefined") {
    throw new Error(
      "@kaleidico/sanity-i18n/engine is server-only. Import it from a Route Handler, Server Action or server component, never from client code.",
    );
  }
}

assertServer();

export {
  defineLanguages,
  type Language,
  type LanguagesConfig,
  type LanguagesInput,
} from "../core/languages";

export interface TranslateDocumentInput {
  /** The source document to translate. */
  document: Record<string, unknown>;
  /** Target language id, e.g. `es`. */
  targetLanguage: string;
}

/**
 * Placeholder for the translation engine. Calling it today throws.
 */
export async function translateDocument(_input: TranslateDocumentInput): Promise<never> {
  assertServer();
  throw new Error(
    "@kaleidico/sanity-i18n/engine: translateDocument() is not implemented until part 4 (translation engine).",
  );
}
