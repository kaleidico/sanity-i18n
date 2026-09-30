import { defineField } from "sanity";
import type { FieldDefinition } from "sanity";
import { API_KEY_FIELD, ENGINE_FIELD, GLOSSARY_FIELD, STYLE_GUIDE_FIELD } from "../core/engineModel";
import { DEFAULT_REVIEWER_MODEL, DEFAULT_TRANSLATOR_MODEL, MODELS } from "../core/pricing";
import { ApiKeyInput } from "./ApiKeyInput";
import { LANGUAGES_GROUP } from "./languagesField";

/**
 * The Site Settings fields of the translation engine. All four belong on the
 * default-language settings document and are the same for every language, so
 * on a translatable settings type list them in `sharedFields`. They are also
 * marked never to be translated, so a missed `sharedFields` entry cannot send
 * a glossary through the translator.
 */

export interface EngineFieldOptions {
  /** Name of the field. Each field has its own default. */
  name?: string;
  /** Field group. Defaults to `languages`, matching `LANGUAGES_GROUP`. Pass `false` to leave the field ungrouped. */
  group?: string | false;
}

const notTranslated = { i18n: { translate: false } } as const;

function grouped(options: EngineFieldOptions): { group?: string } {
  const group = options.group === undefined ? LANGUAGES_GROUP.name : options.group;
  return group ? { group } : {};
}

/** The glossary: what is never translated, and the terms that always translate the same way. */
export function glossaryField(options: EngineFieldOptions = {}): FieldDefinition {
  return defineField({
    name: options.name ?? GLOSSARY_FIELD,
    title: "Translation glossary",
    type: "object",
    description: "Applied to every translation. Change it here and later translations follow it; existing ones are not changed.",
    options: { collapsible: true, collapsed: true, ...notTranslated },
    fields: [
      defineField({
        name: "doNotTranslate",
        title: "Never translate",
        type: "array",
        of: [{ type: "string" }],
        options: { layout: "tags" },
        description: "Names that stay exactly as written in every language: the company, its brands, products and programs, abbreviations.",
      }),
      defineField({
        name: "terms",
        title: "Fixed terms",
        type: "array",
        description: "A term on the left is always translated with the term on the right.",
        of: [
          {
            type: "object",
            name: "term",
            fields: [
              defineField({ name: "source", title: "English term", type: "string", validation: (rule) => rule.required() }),
              defineField({ name: "target", title: "Translation", type: "string", validation: (rule) => rule.required() }),
              defineField({ name: "note", title: "Note", type: "string", description: "When to use it, or that it still needs confirming." }),
            ],
            preview: {
              select: { source: "source", target: "target", note: "note" },
              prepare: ({ source, target, note }) => ({ title: `${source ?? ""} = ${target ?? ""}`, subtitle: note }),
            },
          },
        ],
      }),
    ],
    ...grouped(options),
  });
}

/** The style guide: market, register, audience and any house notes. */
export function styleGuideField(options: EngineFieldOptions = {}): FieldDefinition {
  return defineField({
    name: options.name ?? STYLE_GUIDE_FIELD,
    title: "Translation style guide",
    type: "object",
    description: "How translations should read. Applied to every translation.",
    options: { collapsible: true, collapsed: true, ...notTranslated },
    fields: [
      defineField({
        name: "market",
        title: "Market",
        type: "string",
        initialValue: "es-US",
        description: "Who the translation is for, as a language and country code. es-US is Spanish as used in the United States.",
      }),
      defineField({
        name: "register",
        title: "Register",
        type: "string",
        initialValue: "usted",
        options: {
          layout: "radio",
          list: [
            { title: "Usted (formal)", value: "usted" },
            { title: "Tú (informal)", value: "tu" },
          ],
        },
        description: "How the reader is addressed in Spanish. One choice for the whole site.",
      }),
      defineField({
        name: "audience",
        title: "Audience",
        type: "text",
        rows: 3,
        description: "Who reads the site, in a sentence or two. For example: first-time home buyers and homeowners thinking about refinancing.",
      }),
      defineField({
        name: "notes",
        title: "Notes",
        type: "text",
        rows: 4,
        description: "Anything else a translator should know: words to avoid, tone, how to write dates.",
      }),
    ],
    ...grouped(options),
  });
}

const modelList = MODELS.map((m) => ({ title: `${m.title}. ${m.note}`, value: m.id }));

/** Which Claude model translates and which one reviews. */
export function engineField(options: EngineFieldOptions = {}): FieldDefinition {
  return defineField({
    name: options.name ?? ENGINE_FIELD,
    title: "Translation engine",
    type: "object",
    description: "Which Claude models do the work. Usage is billed by Anthropic to the account that owns the API key below.",
    options: { collapsible: true, collapsed: true, ...notTranslated },
    fields: [
      defineField({
        name: "translatorModel",
        title: "Translator model",
        type: "string",
        initialValue: DEFAULT_TRANSLATOR_MODEL,
        options: { list: modelList },
        description: "Translates each document as a whole.",
      }),
      defineField({
        name: "reviewerModel",
        title: "Reviewer model",
        type: "string",
        initialValue: DEFAULT_REVIEWER_MODEL,
        options: { list: modelList },
        description: "Reads the English and the translation side by side in a separate pass and flags problems for a person.",
      }),
      defineField({
        name: "autoPublishMarketing",
        title: "Publish marketing pages automatically",
        type: "boolean",
        initialValue: false,
        readOnly: true,
        description: "Reserved for the review workflow. For now every translation is saved as a draft and nothing is published.",
      }),
    ],
    ...grouped(options),
  });
}

export interface ApiKeyFieldOptions extends EngineFieldOptions {
  /**
   * The site's public key (SPKI, base64), as printed by
   * `sanity-i18n-generate-keys`. In a Next.js app pass
   * `process.env.NEXT_PUBLIC_I18N_PUBLIC_KEY`. When it is missing the field
   * says that key storage is not configured instead of offering an input.
   */
  publicKey?: string;
}

/**
 * The Anthropic API key. The field stores nothing in Site Settings: the key
 * is encrypted in the browser with the site's public key and only the
 * ciphertext goes to a private document. It is never shown again.
 */
export function apiKeyField(options: ApiKeyFieldOptions = {}): FieldDefinition {
  return defineField({
    name: options.name ?? API_KEY_FIELD,
    title: "Anthropic API key",
    type: "string",
    description:
      "The site owner's own Anthropic API key. Entered once, stored encrypted, never shown again. Translation usage is billed by Anthropic to the account that owns this key.",
    components: { input: ApiKeyInput },
    options: { i18n: { translate: false, publicKey: options.publicKey ?? "" } } as Record<string, unknown>,
    ...grouped(options),
  });
}
