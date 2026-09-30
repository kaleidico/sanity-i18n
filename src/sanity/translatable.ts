import { defineField } from "sanity";
import type {
  ConditionalProperty,
  ConditionalPropertyCallbackContext,
  DocumentDefinition,
  FieldDefinition,
  PreviewConfig,
  SlugIsUniqueValidator,
} from "sanity";
import {
  DEFAULT_LANGUAGE_ID,
  defineLanguages,
  type LanguagesConfig,
  type LanguagesInput,
} from "../core/languages";
import {
  I18N_FIELD,
  LANGUAGE_FIELD,
  localeFilter,
  translationStatusLabel,
  translationStatusList,
  type TranslationLabels,
} from "../core/translations";

import { legalRecordField, reportField, sourceHashesField, staleSinceField } from "./engineTypes";

/** The marker `translatable()` stores on the type definition. */
export const I18N_MARKER = "__i18n";

export interface TranslatableMarker {
  sharedFields: string[];
  slugField: string;
  defaultLanguage: string;
}

export interface TranslatableOptions {
  /**
   * The languages the site can offer. Used to know which language is the
   * default. When omitted, English (`en`) is the default.
   */
  languages?: LanguagesInput;
  /**
   * Fields that are the same in every language: photos, phone numbers, NMLS
   * numbers, references. On a translated document they are read only, with a
   * note to edit them on the default-language document, and the front end
   * reads them from the source document (see `sharedProjection`).
   */
  sharedFields?: readonly string[];
  /** Name of the slug field whose uniqueness is checked per language. Defaults to `slug`. */
  slugField?: string;
  /** Hide the `language` field on default-language documents. Defaults to false. */
  hideLanguageOnDefault?: boolean;
  /** Host overrides for the status titles, e.g. `{ awaiting_approval: "Awaiting NOVA approval" }`. */
  labels?: TranslationLabels;
}

type DocumentLike = { [LANGUAGE_FIELD]?: unknown; [key: string]: unknown } | undefined;

function documentLanguage(document: DocumentLike): string | undefined {
  const value = document?.[LANGUAGE_FIELD];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** True when the document is a translation, i.e. its language is set and is not the default. */
export function isTranslationDocument(document: DocumentLike, defaultId: string = DEFAULT_LANGUAGE_ID): boolean {
  const lang = documentLanguage(document);
  return lang !== undefined && lang !== defaultId;
}

function resolveConditional(prop: ConditionalProperty, ctx: ConditionalPropertyCallbackContext): boolean {
  if (typeof prop === "function") return Boolean(prop(ctx));
  return Boolean(prop);
}

function sharedNote(defaultTitle: string): string {
  return `Shared with the ${defaultTitle} document; edit it there.`;
}

/**
 * Wrap a Sanity document type definition so each language is its own
 * document linked to the default-language one.
 *
 * Adds, at the top of the type:
 * - `language` (string, read only, initial value = default language)
 * - `i18n` (object "Translation"): `source` reference, `status`, `sourceHash`,
 *   `translatedAt`, `approvedAt`, `approvedBy`, and the engine's hidden
 *   `sourceHashes`, `report`, `legal`, `staleSince` and `publishedAt`. Hidden
 *   on default-language documents.
 *
 * And on the existing fields:
 * - every `sharedFields` entry becomes read only on translations, with a note
 * - the slug field's uniqueness is checked within the same language
 * - the preview subtitle of a translation shows its language and status
 *
 * The input definition is not changed; a new one is returned.
 */
export function translatable<T extends DocumentDefinition>(documentType: T, options: TranslatableOptions = {}): T {
  const config: LanguagesConfig = defineLanguages(
    options.languages ?? [{ id: DEFAULT_LANGUAGE_ID, title: "English", nativeTitle: "English", default: true }],
  );
  const defaultId = config.defaultLanguage.id;
  const defaultTitle = config.defaultLanguage.title;
  const sharedFields = [...(options.sharedFields ?? [])];
  const slugField = options.slugField ?? "slug";
  const labels = options.labels;

  const isTranslation = (ctx: ConditionalPropertyCallbackContext) =>
    isTranslationDocument(ctx.document as DocumentLike, defaultId);
  const isDefault = (ctx: ConditionalPropertyCallbackContext) => !isTranslation(ctx);

  const languageField = defineField({
    name: LANGUAGE_FIELD,
    title: "Language",
    type: "string",
    initialValue: defaultId,
    readOnly: true,
    hidden: options.hideLanguageOnDefault ? isDefault : false,
    description: `The language this document is written in. ${defaultTitle} documents are the source every translation is made from.`,
    options: {
      list: config.languages.map((l) => ({ title: l.title, value: l.id })),
      layout: "dropdown",
    },
  });

  const i18nField = defineField({
    name: I18N_FIELD,
    title: "Translation",
    type: "object",
    hidden: isDefault,
    options: { collapsible: true, collapsed: false },
    fields: [
      defineField({
        name: "source",
        title: "Source document",
        type: "reference",
        to: [{ type: documentType.name }],
        weak: true,
        readOnly: true,
        description: `The ${defaultTitle} document this one is a translation of.`,
      }),
      defineField({
        name: "status",
        title: "Status",
        type: "string",
        options: { list: translationStatusList(labels), layout: "radio" },
        initialValue: "draft",
        hidden: isDefault,
        description:
          "Draft: not yet ready. Needs update: the source changed since this was translated. Awaiting approval: legal text is waiting for a person to approve it. Approved: live.",
      }),
      defineField({
        name: "sourceHash",
        title: "Source fingerprint",
        type: "string",
        hidden: true,
        description: "Fingerprint of the source document when this translation was last made.",
      }),
      sourceHashesField(),
      defineField({ name: "translatedAt", title: "Translated at", type: "datetime", readOnly: true }),
      defineField({ name: "approvedAt", title: "Approved at", type: "datetime", readOnly: true }),
      defineField({ name: "approvedBy", title: "Approved by", type: "string", readOnly: true }),
      defineField({ name: "publishedAt", title: "Published at", type: "datetime", readOnly: true, hidden: true }),
      staleSinceField(),
      legalRecordField(),
      reportField(),
    ],
  });

  const fields: FieldDefinition[] = (documentType.fields ?? []).map((field) => {
    let next = field as FieldDefinition & { readOnly?: ConditionalProperty; description?: string };

    if (sharedFields.includes(next.name)) {
      const existing = next.readOnly;
      const note = sharedNote(defaultTitle);
      next = {
        ...next,
        readOnly: (ctx: ConditionalPropertyCallbackContext) => isTranslation(ctx) || resolveConditional(existing, ctx),
        description: next.description ? `${next.description} ${note}` : note,
      } as typeof next;
    }

    if (next.name === slugField && next.type === "slug") {
      const slugDef = next as FieldDefinition & { options?: Record<string, unknown> };
      const isUnique: SlugIsUniqueValidator = async (slug, context) => {
        const doc = context.document as DocumentLike;
        const language = documentLanguage(doc) ?? defaultId;
        const id = String(doc?._id ?? "");
        const published = id.replace(/^drafts\./, "");
        const client = context.getClient({ apiVersion: "2024-01-01" });
        const count = await client.fetch<number>(
          `count(*[_type == $type && ${slugField}.current == $slug && ${localeFilter(language, defaultId)} && !(_id in [$draft, $published])])`,
          { type: documentType.name, slug, draft: `drafts.${published}`, published },
        );
        return count === 0;
      };
      next = { ...slugDef, options: { ...(slugDef.options ?? {}), isUnique } } as typeof next;
    }

    return next;
  });

  const preview = withTranslationPreview(documentType.preview, defaultId, labels);

  const marker: TranslatableMarker = { sharedFields, slugField, defaultLanguage: defaultId };

  return {
    ...documentType,
    fields: [languageField, i18nField, ...fields],
    preview,
    [I18N_MARKER]: marker,
  } as T;
}

/**
 * Extend the type's preview so a translation's subtitle starts with its
 * language and status, e.g. `ES · Awaiting approval · /sobre-nosotros`.
 * Default-language documents keep their preview unchanged.
 */
function withTranslationPreview(
  preview: PreviewConfig | undefined,
  defaultId: string,
  labels: TranslationLabels | undefined,
): PreviewConfig {
  const LANG_KEY = "__i18nLanguage";
  const STATUS_KEY = "__i18nStatus";
  const select: Record<string, string> = {
    ...(preview?.select ?? (preview ? {} : { title: "title" })),
    [LANG_KEY]: LANGUAGE_FIELD,
    [STATUS_KEY]: `${I18N_FIELD}.status`,
  };
  const original = preview?.prepare;

  return {
    ...(preview ?? {}),
    select,
    prepare: (value, viewOptions) => {
      const { [LANG_KEY]: lang, [STATUS_KEY]: status, ...rest } = (value ?? {}) as Record<string, unknown>;
      const base = original ? original(rest as never, viewOptions) : { title: rest.title as string | undefined, subtitle: rest.subtitle as string | undefined };
      if (typeof lang !== "string" || lang === "" || lang === defaultId) return base;
      const tag = `${lang.toUpperCase()} · ${translationStatusLabel(status as string | undefined, labels)}`;
      const subtitle = base?.subtitle ? `${tag} · ${base.subtitle}` : tag;
      return { ...base, subtitle };
    },
  };
}

/** The shared field names `translatable()` recorded on a type definition, or `[]` when it was not wrapped. */
export function getSharedFields(typeDef: unknown): string[] {
  const marker = getTranslatableMarker(typeDef);
  return marker ? [...marker.sharedFields] : [];
}

/** The full marker `translatable()` stored on a type definition, or `undefined` when it was not wrapped. */
export function getTranslatableMarker(typeDef: unknown): TranslatableMarker | undefined {
  if (!typeDef || typeof typeDef !== "object") return undefined;
  const marker = (typeDef as Record<string, unknown>)[I18N_MARKER];
  if (!marker || typeof marker !== "object") return undefined;
  const m = marker as Partial<TranslatableMarker>;
  return {
    sharedFields: Array.isArray(m.sharedFields) ? [...m.sharedFields] : [],
    slugField: typeof m.slugField === "string" ? m.slugField : "slug",
    defaultLanguage: typeof m.defaultLanguage === "string" ? m.defaultLanguage : DEFAULT_LANGUAGE_ID,
  };
}

/** True when a type definition was wrapped with `translatable()`. */
export function isTranslatable(typeDef: unknown): boolean {
  return getTranslatableMarker(typeDef) !== undefined;
}
