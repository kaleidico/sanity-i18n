import { defineField, defineType } from "sanity";

/** Per-document translation states, in the order they are shown. */
export const TRANSLATION_STATUSES = [
  { title: "Draft", value: "draft" },
  { title: "Needs update", value: "needs-update" },
  { title: "Awaiting approval", value: "awaiting-approval" },
  { title: "Approved", value: "approved" },
] as const;

export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number]["value"];

export const TRANSLATION_META_TYPE = "i18n.translationMeta";

/**
 * Minimal metadata document that will link a translated document to its
 * source. Part 2 (document-level translations) adds the references to the
 * source and translated documents, the desk structure entry and the badges.
 * For now it only exists so the schema type name is reserved and stable.
 *
 * It is hidden from omnisearch. Hosts with a custom desk structure should not
 * list it; hosts using the default structure will see it until part 2 wires
 * it properly.
 */
export const translationMetaType = defineType({
  name: TRANSLATION_META_TYPE,
  title: "Translation metadata",
  type: "document",
  __experimental_omnisearch_visibility: false,
  fields: [
    defineField({
      name: "language",
      title: "Language",
      type: "string",
      description: "Language id of the translated document, e.g. es.",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: { list: [...TRANSLATION_STATUSES], layout: "radio" },
      initialValue: "draft",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "sourceHash",
      title: "Source hash",
      type: "string",
      description:
        "Fingerprint of the source document when this translation was last made. A different fingerprint later means the translation needs an update.",
    }),
    defineField({
      name: "legal",
      title: "Legal content",
      type: "boolean",
      description: "Legal or regulated copy that must be approved by a person before it goes live.",
      initialValue: false,
    }),
  ],
  preview: {
    select: { title: "language", subtitle: "status" },
  },
});
