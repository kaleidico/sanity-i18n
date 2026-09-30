import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFieldManifest, noTranslate, NON_TEXT_FIELD_NAME } from "../dist/sanity/index.js";
import { schema } from "./helpers/fixtures.mjs";

const manifest = buildFieldManifest(schema, ["page", "settings", "missingType"]);

test("the manifest lists the translatable document types it was asked for and skips unknown ones", () => {
  assert.deepEqual(Object.keys(manifest.documents), ["page", "settings"]);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.defaultLanguage, "en");
});

test("language, i18n, shared fields and the slug are never in a document's fields", () => {
  const page = manifest.documents.page;
  assert.deepEqual(Object.keys(page.fields), ["title", "blocks", "seo"]);
  assert.deepEqual(page.sharedFields, ["nmls", "photo"]);
  assert.equal(page.slugField, "slug");
  assert.equal(manifest.documents.settings.slugField, null);
});

test("named object types are stored once and pointed at", () => {
  assert.deepEqual(manifest.documents.page.fields.seo, { kind: "ref", type: "seo" });
  assert.deepEqual(Object.keys(manifest.documents.page.fields.blocks.members), ["heroBlock", "richTextBlock", "calculatorBlock"]);
  assert.deepEqual(Object.keys(manifest.types).sort(), ["calculatorBlock", "heroBlock", "richTextBlock", "seo"]);
});

test("text is decided by the schema: no URLs, fixed choices, numbers, booleans, references or images", () => {
  assert.deepEqual(Object.keys(manifest.types.seo.fields), ["metaTitle", "metaDescription"]);
  const hero = manifest.types.heroBlock.fields;
  assert.deepEqual(Object.keys(hero), ["headline", "subheadline", "ctaLabel", "image", "breadcrumbs"]);
  // An image contributes its own text fields only.
  assert.deepEqual(hero.image, { kind: "object", fields: { alt: { kind: "text" } } });
  // `href` is plumbing by name, `name` is copy.
  assert.deepEqual(hero.breadcrumbs, { kind: "array", members: { breadcrumb: { kind: "object", fields: { name: { kind: "text" } } } } });
});

test("Portable Text, string lists, legal marks and noTranslate", () => {
  const rich = manifest.types.richTextBlock.fields;
  assert.deepEqual(Object.keys(rich), ["content"]);
  assert.equal(rich.content.kind, "portableText");
  assert.deepEqual(rich.content.members.image, { kind: "object", fields: { alt: { kind: "text" }, caption: { kind: "text" } } });

  const calc = manifest.types.calculatorBlock.fields;
  assert.deepEqual(Object.keys(calc), ["heading", "points", "disclaimer"]);
  assert.deepEqual(calc.points, { kind: "list" });
  assert.deepEqual(calc.disclaimer, { kind: "text", legal: true });
  assert.deepEqual(manifest.documents.settings.fields.footerDisclaimer, { kind: "text", legal: true });
});

test("plumbing field names are recognised, and copy is not", () => {
  for (const name of ["href", "ctaHref", "applyUrl", "gtmId", "resendApiKey", "icon", "bgColor", "embedCode", "anchor"]) assert.ok(NON_TEXT_FIELD_NAME.test(name), name);
  for (const name of ["title", "heading", "ctaLabel", "name", "label", "body", "description", "value", "linkText"]) assert.ok(!NON_TEXT_FIELD_NAME.test(name), name);
});

test("noTranslate marks a field without changing the input", () => {
  const field = { name: "machineName", type: "string", options: { list: undefined } };
  const marked = noTranslate(field);
  assert.equal(marked.options.i18n.translate, false);
  assert.equal(field.options.i18n, undefined);
});
