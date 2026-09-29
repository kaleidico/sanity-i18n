/**
 * Type-level fixture, never bundled: the public helpers must accept the
 * definitions Sanity's `defineField` and `defineType` produce, without a
 * cast. `npm run typecheck` fails if this stops compiling.
 */
import { defineField, defineType } from "sanity";
import { collectLegalPaths, legalBlock, legalText } from "./sanity/legal";
import { translatable } from "./sanity/translatable";

const disclaimer = legalText(defineField({ name: "disclaimer", title: "Disclaimer", type: "text", rows: 3 }));
const label = legalText(defineField({ name: "label", title: "Label", type: "string", options: { list: ["a"] } }));
const consent = legalText(defineField({ name: "consentText", title: "Consent", type: "array", of: [{ type: "block" }] }));
const block = legalBlock(defineType({ name: "disclosureBlock", title: "Disclosure", type: "object", fields: [disclaimer] }));

export const fixtureType = translatable(
  defineType({
    name: "fixture",
    title: "Fixture",
    type: "document",
    fields: [
      defineField({ name: "title", title: "Title", type: "string" }),
      defineField({ name: "slug", title: "Slug", type: "slug", options: { source: "title" } }),
      label,
      consent,
      defineField({ name: "blocks", title: "Blocks", type: "array", of: [{ type: block.name }] }),
    ],
    preview: { select: { title: "title" } },
  }),
  { languages: [{ id: "es", title: "Spanish" }], sharedFields: ["title"], labels: { approved: "Live" } },
);

export const fixturePaths: string[] = collectLegalPaths(fixtureType, { types: [block] });
