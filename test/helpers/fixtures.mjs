// A realistic page: nested blocks, Portable Text with marks and a link, an
// image with alt text, references, fixed choices, shared fields and a slug.
import { createSchema, defineField, defineType } from "sanity";
import { translatable, legalText, noTranslate } from "../../dist/sanity/index.js";

export const languages = [{ id: "es", title: "Spanish", nativeTitle: "Español" }];

const seo = defineType({
  name: "seo",
  type: "object",
  fields: [
    defineField({ name: "metaTitle", type: "string" }),
    defineField({ name: "metaDescription", type: "text" }),
    defineField({ name: "ogImage", type: "image" }),
    defineField({ name: "canonicalUrl", type: "url" }),
    defineField({ name: "noIndex", type: "boolean" }),
  ],
});

const heroBlock = defineType({
  name: "heroBlock",
  type: "object",
  fields: [
    defineField({ name: "headline", type: "string" }),
    defineField({ name: "subheadline", type: "text" }),
    defineField({ name: "ctaLabel", type: "string" }),
    defineField({ name: "ctaHref", type: "string" }),
    defineField({ name: "variant", type: "string", options: { list: ["light", "dark"] } }),
    defineField({ name: "image", type: "image", fields: [defineField({ name: "alt", type: "string" })] }),
    defineField({
      name: "breadcrumbs",
      type: "array",
      of: [{ type: "object", name: "breadcrumb", fields: [defineField({ name: "name", type: "string" }), defineField({ name: "href", type: "string" })] }],
    }),
  ],
});

const richTextBlock = defineType({
  name: "richTextBlock",
  type: "object",
  fields: [
    defineField({ name: "width", type: "string", options: { list: ["reading", "wide"] } }),
    defineField({
      name: "content",
      type: "array",
      of: [
        { type: "block" },
        { type: "image", fields: [defineField({ name: "alt", type: "string" }), defineField({ name: "caption", type: "string" })] },
      ],
    }),
  ],
});

const calculatorBlock = defineType({
  name: "calculatorBlock",
  type: "object",
  fields: [
    defineField({ name: "heading", type: "string" }),
    defineField({ name: "defaultRate", type: "number" }),
    defineField({ name: "points", type: "array", of: [{ type: "string" }] }),
    legalText(defineField({ name: "disclaimer", type: "text" })),
    defineField({ name: "form", type: "reference", to: [{ type: "page" }] }),
    noTranslate(defineField({ name: "fieldName", type: "string" })),
  ],
});

const page = translatable(
  defineType({
    name: "page",
    type: "document",
    fields: [
      defineField({ name: "title", type: "string" }),
      defineField({ name: "slug", type: "slug", options: { source: "title" } }),
      defineField({ name: "nmls", type: "string" }),
      defineField({ name: "photo", type: "image" }),
      defineField({ name: "blocks", type: "array", of: [{ type: "heroBlock" }, { type: "richTextBlock" }, { type: "calculatorBlock" }] }),
      defineField({ name: "seo", type: "seo" }),
    ],
  }),
  { languages, sharedFields: ["nmls", "photo"] },
);

const settings = translatable(
  defineType({
    name: "settings",
    type: "document",
    fields: [defineField({ name: "siteName", type: "string" }), legalText(defineField({ name: "footerDisclaimer", type: "text" }))],
  }),
  { languages },
);

export const schema = createSchema({ name: "test", types: [seo, heroBlock, richTextBlock, calculatorBlock, page, settings] });

export function sourcePage() {
  return {
    _id: "page-conventional-loans",
    _type: "page",
    _rev: "rev1",
    _createdAt: "2026-01-01T00:00:00Z",
    _updatedAt: "2026-01-02T00:00:00Z",
    title: "Conventional Loans",
    slug: { _type: "slug", current: "conventional-loans" },
    nmls: "3087",
    photo: { _type: "image", asset: { _type: "reference", _ref: "image-abc-100x100-jpg" } },
    blocks: [
      {
        _key: "k01",
        _type: "heroBlock",
        headline: "Conventional Loans",
        subheadline: "Down payments may be as low as 3%. Call (866) 866-0653.",
        ctaLabel: "Get pre-approved",
        ctaHref: "https://apply.example.com/start",
        variant: "dark",
        image: { _type: "image", alt: "A family at home", asset: { _type: "reference", _ref: "image-def-200x200-jpg" } },
        breadcrumbs: [
          { _key: "b1", _type: "breadcrumb", name: "Loan Options", href: "/loan-options" },
          { _key: "b2", _type: "breadcrumb", name: "Conventional Loans" },
        ],
      },
      {
        _key: "k02",
        _type: "richTextBlock",
        width: "reading",
        content: [
          {
            _key: "p1",
            _type: "block",
            style: "h2",
            markDefs: [],
            children: [{ _key: "s1", _type: "span", marks: [], text: "How a conventional loan works" }],
          },
          {
            _key: "p2",
            _type: "block",
            style: "normal",
            markDefs: [{ _key: "m1", _type: "link", href: "https://www.example.com/rates" }],
            children: [
              { _key: "s1", _type: "span", marks: [], text: "A 30-year fixed loan at " },
              { _key: "s2", _type: "span", marks: ["strong"], text: "6.5%" },
              { _key: "s3", _type: "span", marks: [], text: " is common. See " },
              { _key: "s4", _type: "span", marks: ["m1"], text: "today's rates" },
              { _key: "s5", _type: "span", marks: [], text: "." },
            ],
          },
          { _key: "i1", _type: "image", alt: "A rate chart", caption: "Rates over 2026", asset: { _type: "reference", _ref: "image-ghi-300x300-png" } },
        ],
      },
      {
        _key: "k03",
        _type: "calculatorBlock",
        heading: "Estimate Your Payment",
        defaultRate: 6.5,
        points: ["Principal and interest", "Taxes and insurance"],
        disclaimer: "Results are estimates and are not a commitment to lend. NMLS 3087.",
        form: { _type: "reference", _ref: "form-lead" },
        fieldName: "loan_amount",
      },
    ],
    seo: { metaTitle: "Conventional Loans | NOVA Home Loans", metaDescription: "Learn how conventional loans work.", noIndex: false, canonicalUrl: "https://www.example.com/conventional-loans" },
  };
}

export const glossary = { doNotTranslate: ["NOVA Home Loans", "NMLS"], terms: [{ source: "down payment", target: "pago inicial", note: "provisional" }] };
export const styleGuide = { market: "es-US", register: "usted", audience: "First-time buyers", notes: "" };
export const spanish = { id: "es", title: "Spanish", nativeTitle: "Español" };
export const english = { id: "en", title: "English", nativeTitle: "English", default: true };
