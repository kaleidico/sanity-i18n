import { test } from "node:test";
import assert from "node:assert/strict";
import { translationsStructure, languageFilter } from "../dist/sanity/index.js";

// A minimal stand-in for Sanity's StructureBuilder that records what was
// built, so the shape of the desk section can be asserted without a Studio.
function fakeBuilder(kind) {
  const spec = { kind };
  const b = {
    spec,
    id: (v) => ((spec.id = v), b),
    title: (v) => ((spec.title = v), b),
    child: (v) => ((spec.child = v), b),
    items: (v) => ((spec.items = v), b),
    schemaType: (v) => ((spec.schemaType = v), b),
    filter: (v) => ((spec.filter = v), b),
    params: (v) => ((spec.params = v), b),
  };
  return b;
}
const S = {
  listItem: () => fakeBuilder("listItem"),
  list: () => fakeBuilder("list"),
  documentTypeList: (type) => {
    const b = fakeBuilder("documentTypeList");
    b.spec.type = type;
    return b;
  },
};

test("languageFilter is the locale clause for desk lists", () => {
  assert.equal(languageFilter("en"), '(language == "en" || !defined(language))');
  assert.equal(languageFilter("es"), 'language == "es"');
});

test("translationsStructure lists every non-default language and each translatable type", () => {
  const item = translationsStructure(S, {
    languages: [{ id: "es", title: "Spanish", nativeTitle: "Español" }, { id: "fr", title: "French" }],
    types: ["page", "blogPost"],
    titles: { page: "Pages", blogPost: "Blog Posts" },
  });

  assert.equal(item.spec.kind, "listItem");
  assert.equal(item.spec.title, "Translations");
  assert.equal(item.spec.id, "i18n-translations");

  const languages = item.spec.child.spec.items;
  assert.deepEqual(languages.map((l) => l.spec.title), ["Spanish (Español)", "French"]);

  const esTypes = languages[0].spec.child.spec.items;
  assert.deepEqual(esTypes.map((t) => t.spec.title), ["Pages", "Blog Posts"]);
  assert.equal(esTypes[0].spec.schemaType, "page");

  const esPages = esTypes[0].spec.child.spec;
  assert.equal(esPages.kind, "documentTypeList");
  assert.equal(esPages.type, "page");
  assert.equal(esPages.title, "Pages (Spanish)");
  assert.equal(esPages.filter, '_type == $type && language == "es"');
  assert.deepEqual(esPages.params, { type: "page" });

  const frPosts = languages[1].spec.child.spec.items[1].spec.child.spec;
  assert.equal(frPosts.filter, '_type == $type && language == "fr"');
  assert.equal(frPosts.title, "blogPost (French)".replace("blogPost", "Blog Posts"));
});

test("translationsStructure with no extra languages gives an empty section", () => {
  const item = translationsStructure(S, { languages: [], types: ["page"], title: "Idiomas" });
  assert.equal(item.spec.title, "Idiomas");
  assert.deepEqual(item.spec.child.spec.items, []);
});
