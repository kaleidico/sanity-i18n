import { test } from "node:test";
import assert from "node:assert/strict";
import {
  languagesField,
  LANGUAGES_GROUP,
  defineLanguages,
} from "../dist/sanity/index.js";

const es = { id: "es", title: "Spanish", nativeTitle: "Español" };
const pt = { id: "pt-BR", title: "Portuguese (Brazil)", nativeTitle: "Português (Brasil)" };

test("LANGUAGES_GROUP is the group hosts add to Site Settings", () => {
  assert.deepEqual(LANGUAGES_GROUP, { name: "languages", title: "Languages" });
});

test("languagesField is a languages object in the Languages group", () => {
  const field = languagesField({ languages: [es, pt] });
  assert.equal(field.name, "languages");
  assert.equal(field.type, "object");
  assert.equal(field.title, "Languages");
  assert.equal(field.group, "languages");
  assert.match(field.description, /publishes nothing by itself/);
});

test("languagesField has one boolean per language, English first, on and read only", () => {
  const field = languagesField({ languages: defineLanguages([es, pt]) });
  assert.deepEqual(
    field.fields.map((f) => f.name),
    ["en", "es", "pt_BR"],
  );
  for (const f of field.fields) assert.equal(f.type, "boolean");

  const [en, esField, ptField] = field.fields;
  assert.equal(en.readOnly, true);
  assert.equal(en.initialValue, true);
  assert.match(en.description, /default language/);

  assert.equal(esField.title, "Español");
  assert.equal(esField.readOnly, false);
  assert.equal(esField.initialValue, false);
  assert.match(esField.description, /publishes nothing by itself/);
  assert.match(esField.description, /translated and marked ready/);

  assert.equal(ptField.title, "Português (Brasil)");
});

test("languagesField falls back to the title when there is no native title", () => {
  const field = languagesField({ languages: [{ id: "de", title: "German" }] });
  assert.equal(field.fields.find((f) => f.name === "de").title, "German");
});

test("languagesField lets the host change the group or field name", () => {
  const custom = languagesField({ languages: [es], group: "integrations", fieldName: "locales" });
  assert.equal(custom.group, "integrations");
  assert.equal(custom.name, "locales");

  const ungrouped = languagesField({ languages: [es], group: false });
  assert.equal(ungrouped.group, undefined);
});
