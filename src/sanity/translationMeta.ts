import { defineField, defineType } from "sanity";
import type { DocumentDefinition } from "sanity";
import { TRANSLATION_META_TYPE, translationMetaId } from "../core/translations";

export { TRANSLATION_META_TYPE, translationMetaId };

export interface TranslationMetaOptions {
  /** The document types that were wrapped with `translatable()`. The `document` reference can point at any of them. */
  translatableTypes: readonly string[];
}

/**
 * The metadata document that links one source document to every language it
 * exists in. One per source, id `i18n-meta-<sourceId>` (see `translationMetaId`).
 *
 * Both directions resolve in GROQ: a translation's `i18n.source` points at
 * the source document, and this document lists all languages (the source
 * included) with a weak reference to each.
 *
 * Hidden from omnisearch. Hosts with a custom desk structure should not list
 * it; `translationsStructure()` does not either.
 */
export function translationMetaType(options: TranslationMetaOptions): DocumentDefinition {
  const to = options.translatableTypes.map((type) => ({ type }));
  if (to.length === 0) {
    throw new Error("translationMetaType: translatableTypes must list at least one document type");
  }

  return defineType({
    name: TRANSLATION_META_TYPE,
    title: "Translation metadata",
    type: "document",
    __experimental_omnisearch_visibility: false,
    fields: [
      defineField({
        name: "sourceType",
        title: "Source type",
        type: "string",
        description: "Schema type of the source document, e.g. page.",
        readOnly: true,
        validation: (rule) => rule.required(),
      }),
      defineField({
        name: "translations",
        title: "Translations",
        type: "array",
        readOnly: true,
        of: [
          {
            type: "object",
            name: "translation",
            fields: [
              defineField({ name: "language", title: "Language", type: "string", validation: (rule) => rule.required() }),
              defineField({ name: "document", title: "Document", type: "reference", to, weak: true }),
            ],
            preview: { select: { title: "language", subtitle: "document._ref" } },
          },
        ],
      }),
    ],
    preview: {
      select: { title: "sourceType", translations: "translations" },
      prepare: ({ title, translations }) => ({
        title: title ? `Translations of a ${title}` : "Translations",
        subtitle: Array.isArray(translations)
          ? translations.map((t: { language?: string }) => t?.language).filter(Boolean).join(", ")
          : undefined,
      }),
    },
  });
}
