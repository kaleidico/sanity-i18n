import { test } from "node:test";
import assert from "node:assert/strict";
import {
  translatable,
  getSharedFields,
  isTranslatable,
  isTranslationDocument,
  I18N_MARKER,
} from "../dist/sanity/index.js";

const languages = [{ id: "es", title: "Spanish", nativeTitle: "Español" }];
const labels = { awaiting_approval: "Awaiting NOVA approval" };

function pageType() {
  return {
    name: "page",
    title: "Page",
    type: "document",
    fields: [
      { name: "title", title: "Title", type: "string" },
      { name: "slug", title: "Slug", type: "slug", options: { source: "title" } },
      { name: "photo", title: "Photo", type: "image", description: "Hero photo.", readOnly: false },
      { name: "nmls", title: "NMLS", type: "string" },
    ],
    preview: { select: { title: "title", subtitle: "slug.current" } },
  };
}

test("translatable adds language and i18n at the top and keeps the rest", () => {
  const original = pageType();
  const t = translatable(original, { languages, sharedFields: ["photo", "nmls"], labels });

  assert.deepEqual(
    t.fields.map((f) => f.name),
    ["language", "i18n", "title", "slug", "photo", "nmls"],
  );
  // The input is not changed.
  assert.deepEqual(original.fields.map((f) => f.name), ["title", "slug", "photo", "nmls"]);

  const language = t.fields[0];
  assert.equal(language.type, "string");
  assert.equal(language.initialValue, "en");
  assert.equal(language.readOnly, true);
  assert.equal(language.hidden, false);

  const i18n = t.fields[1];
  assert.equal(i18n.type, "object");
  assert.equal(i18n.title, "Translation");
  assert.deepEqual(
    i18n.fields.map((f) => f.name),
    ["source", "status", "sourceHash", "translatedAt", "approvedAt", "approvedBy"],
  );
  const source = i18n.fields.find((f) => f.name === "source");
  assert.equal(source.type, "reference");
  assert.equal(source.weak, true);
  assert.equal(source.readOnly, true);
  assert.deepEqual(source.to, [{ type: "page" }]);

  const status = i18n.fields.find((f) => f.name === "status");
  assert.deepEqual(
    status.options.list.map((s) => s.value),
    ["draft", "needs_update", "awaiting_approval", "approved"],
  );
  assert.equal(status.options.list[2].title, "Awaiting NOVA approval");
  assert.equal(status.initialValue, "draft");

  assert.equal(i18n.fields.find((f) => f.name === "sourceHash").hidden, true);
  for (const name of ["translatedAt", "approvedAt", "approvedBy"]) {
    assert.equal(i18n.fields.find((f) => f.name === name).readOnly, true);
  }
});

test("i18n object and status are hidden on default-language documents only", () => {
  const t = translatable(pageType(), { languages });
  const i18n = t.fields[1];
  const status = i18n.fields.find((f) => f.name === "status");
  const en = { document: { _type: "page", language: "en" } };
  const legacy = { document: { _type: "page" } };
  const es = { document: { _type: "page", language: "es" } };
  assert.equal(i18n.hidden(en), true);
  assert.equal(i18n.hidden(legacy), true);
  assert.equal(i18n.hidden(es), false);
  assert.equal(status.hidden(en), true);
  assert.equal(status.hidden(es), false);
});

test("hideLanguageOnDefault hides the language field on the default language", () => {
  const t = translatable(pageType(), { languages, hideLanguageOnDefault: true });
  const language = t.fields[0];
  assert.equal(language.hidden({ document: { language: "en" } }), true);
  assert.equal(language.hidden({ document: {} }), true);
  assert.equal(language.hidden({ document: { language: "es" } }), false);
});

test("shared fields are read only on translations with a note, and recorded on the marker", () => {
  const t = translatable(pageType(), { languages, sharedFields: ["photo", "nmls"] });
  const photo = t.fields.find((f) => f.name === "photo");
  const nmls = t.fields.find((f) => f.name === "nmls");
  const title = t.fields.find((f) => f.name === "title");

  assert.equal(photo.readOnly({ document: { language: "es" } }), true);
  assert.equal(photo.readOnly({ document: { language: "en" } }), false);
  assert.equal(photo.readOnly({ document: {} }), false);
  assert.equal(photo.description, "Hero photo. Shared with the English document; edit it there.");
  assert.equal(nmls.description, "Shared with the English document; edit it there.");
  assert.equal(title.readOnly, undefined);

  assert.deepEqual(getSharedFields(t), ["photo", "nmls"]);
  assert.deepEqual(getSharedFields(pageType()), []);
  assert.equal(isTranslatable(t), true);
  assert.equal(isTranslatable(pageType()), false);
  assert.deepEqual(t[I18N_MARKER], { sharedFields: ["photo", "nmls"], slugField: "slug", defaultLanguage: "en" });
});

test("an existing readOnly on a shared field still applies", () => {
  const type = pageType();
  type.fields[2].readOnly = ({ document }) => document?.locked === true;
  const t = translatable(type, { languages, sharedFields: ["photo"] });
  const photo = t.fields.find((f) => f.name === "photo");
  assert.equal(photo.readOnly({ document: { language: "en", locked: true } }), true);
  assert.equal(photo.readOnly({ document: { language: "en", locked: false } }), false);
  assert.equal(photo.readOnly({ document: { language: "es", locked: false } }), true);
});

test("slug uniqueness is checked within the same language", async () => {
  const t = translatable(pageType(), { languages });
  const slug = t.fields.find((f) => f.name === "slug");
  assert.equal(slug.options.source, "title");
  assert.equal(typeof slug.options.isUnique, "function");

  const calls = [];
  const client = { fetch: async (query, params) => { calls.push({ query, params }); return 0; } };
  const es = await slug.options.isUnique("hola", {
    document: { _id: "drafts.abc", _type: "page", language: "es" },
    getClient: () => client,
  });
  assert.equal(es, true);
  assert.match(calls[0].query, /^count\(\*\[_type == \$type && slug\.current == \$slug && language == "es" && !\(_id in \[\$draft, \$published\]\)\]\)$/);
  assert.deepEqual(calls[0].params, { type: "page", slug: "hola", draft: "drafts.abc", published: "abc" });

  await slug.options.isUnique("hello", { document: { _id: "abc", _type: "page" }, getClient: () => client });
  assert.match(calls[1].query, /\(language == "en" \|\| !defined\(language\)\)/);

  client.fetch = async () => 1;
  assert.equal(await slug.options.isUnique("taken", { document: { _id: "x", language: "es" }, getClient: () => client }), false);
});

test("a custom slug field name is honoured", () => {
  const type = pageType();
  type.fields[1].name = "path";
  const t = translatable(type, { languages, slugField: "path" });
  assert.equal(typeof t.fields.find((f) => f.name === "path").options.isUnique, "function");
  assert.equal(t[I18N_MARKER].slugField, "path");
});

test("preview subtitle of a translation starts with language and status", () => {
  const t = translatable(pageType(), { languages, labels });
  assert.equal(t.preview.select.title, "title");
  assert.equal(t.preview.select.__i18nLanguage, "language");
  assert.equal(t.preview.select.__i18nStatus, "i18n.status");

  const en = t.preview.prepare({ title: "About", subtitle: "about", __i18nLanguage: "en" });
  assert.deepEqual(en, { title: "About", subtitle: "about" });

  const es = t.preview.prepare({ title: "Sobre", subtitle: "sobre", __i18nLanguage: "es", __i18nStatus: "awaiting_approval" });
  assert.deepEqual(es, { title: "Sobre", subtitle: "ES · Awaiting NOVA approval · sobre" });

  const draft = t.preview.prepare({ title: "Sobre", __i18nLanguage: "es" });
  assert.equal(draft.subtitle, "ES · Draft");
});

test("an existing prepare keeps working and a missing preview falls back to title", () => {
  const type = pageType();
  type.preview = { prepare: () => ({ title: "Homepage" }) };
  const t = translatable(type, { languages });
  assert.deepEqual(t.preview.prepare({ __i18nLanguage: "es", __i18nStatus: "approved" }), { title: "Homepage", subtitle: "ES · Approved" });

  delete type.preview;
  const u = translatable(type, { languages });
  assert.equal(u.preview.select.title, "title");
  assert.deepEqual(u.preview.prepare({ title: "X", __i18nLanguage: "en" }), { title: "X", subtitle: undefined });
});

test("isTranslationDocument", () => {
  assert.equal(isTranslationDocument({ language: "es" }), true);
  assert.equal(isTranslationDocument({ language: "en" }), false);
  assert.equal(isTranslationDocument({}), false);
  assert.equal(isTranslationDocument(undefined), false);
  assert.equal(isTranslationDocument({ language: "en" }, "es"), true);
});
