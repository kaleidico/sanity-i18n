import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defineLanguages,
  readEnabledLanguages,
  languageFieldKey,
  DEFAULT_LANGUAGE_ID,
} from "../dist/sanity/index.js";

const es = { id: "es", title: "Spanish", nativeTitle: "Español" };
const fr = { id: "fr", title: "French", nativeTitle: "Français" };

test("defineLanguages adds English as the default when it is missing", () => {
  const config = defineLanguages([es, fr]);
  assert.equal(config.defaultLanguage.id, DEFAULT_LANGUAGE_ID);
  assert.deepEqual(
    config.languages.map((l) => l.id),
    ["en", "es", "fr"],
  );
  assert.equal(config.languages[0].default, true);
  assert.equal(config.languages[1].default, false);
});

test("defineLanguages keeps English first when it is listed later", () => {
  const config = defineLanguages([es, { id: "en", title: "English" }, fr]);
  assert.deepEqual(
    config.languages.map((l) => l.id),
    ["en", "es", "fr"],
  );
});

test("defineLanguages honours another language marked default", () => {
  const config = defineLanguages([{ id: "en", title: "English" }, { ...es, default: true }]);
  assert.equal(config.defaultLanguage.id, "es");
  assert.deepEqual(
    config.languages.map((l) => l.id),
    ["es", "en"],
  );
});

test("defineLanguages accepts an object form and passes its own result through", () => {
  const config = defineLanguages({ languages: [es] });
  assert.equal(defineLanguages(config), config);
});

test("defineLanguages rejects duplicates, bad ids, missing titles and two defaults", () => {
  assert.throws(() => defineLanguages([es, es]), /listed twice/);
  assert.throws(() => defineLanguages([{ id: "Spanish", title: "x" }]), /invalid language id/);
  assert.throws(() => defineLanguages([{ id: "es", title: "" }]), /needs a title/);
  assert.throws(
    () => defineLanguages([{ ...es, default: true }, { ...fr, default: true }]),
    /only one language can be the default/,
  );
  assert.throws(() => defineLanguages("es"), /expected an array/);
});

test("languageFieldKey turns region codes into valid field names", () => {
  assert.equal(languageFieldKey("es"), "es");
  assert.equal(languageFieldKey("pt-BR"), "pt_BR");
});

test("readEnabledLanguages returns only English when nothing is set", () => {
  assert.deepEqual(
    readEnabledLanguages({}, [es, fr]).map((l) => l.id),
    ["en"],
  );
  assert.deepEqual(
    readEnabledLanguages(null, [es, fr]).map((l) => l.id),
    ["en"],
  );
  assert.deepEqual(
    readEnabledLanguages({ languages: null }, [es, fr]).map((l) => l.id),
    ["en"],
  );
});

test("readEnabledLanguages returns switched-on languages in configured order, English first", () => {
  const doc = { _type: "settings", languages: { fr: true, es: true, en: false } };
  assert.deepEqual(
    readEnabledLanguages(doc, [es, fr]).map((l) => l.id),
    ["en", "es", "fr"],
  );
  assert.deepEqual(
    readEnabledLanguages({ languages: { fr: true, es: false } }, [es, fr]).map((l) => l.id),
    ["en", "fr"],
  );
});

test("readEnabledLanguages reads region codes through their field key", () => {
  const pt = { id: "pt-BR", title: "Portuguese (Brazil)" };
  assert.deepEqual(
    readEnabledLanguages({ languages: { pt_BR: true } }, [pt]).map((l) => l.id),
    ["en", "pt-BR"],
  );
});

test("readEnabledLanguages honours a custom field name", () => {
  assert.deepEqual(
    readEnabledLanguages({ locales: { es: true } }, [es], { fieldName: "locales" }).map((l) => l.id),
    ["en", "es"],
  );
});
