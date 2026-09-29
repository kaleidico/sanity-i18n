import { test } from "node:test";
import assert from "node:assert/strict";
import { createDictionary, interpolate } from "../dist/next/index.js";

test("createDictionary translates, interpolates and binds", () => {
  const d = createDictionary({
    en: { readMore: "Read more", minRead: "{minutes} min read" },
    es: { readMore: "Leer más", minRead: "{minutes} min de lectura" },
  });
  assert.deepEqual(d.languages, ["en", "es"]);
  assert.equal(d.defaultId, "en");
  assert.deepEqual(d.keys, ["readMore", "minRead"]);
  assert.equal(d.t("en", "readMore"), "Read more");
  assert.equal(d.t("es", "readMore"), "Leer más");
  assert.equal(d.t("es", "minRead", { minutes: 4 }), "4 min de lectura");
  assert.equal(d.for("es")("minRead", { minutes: 2 }), "2 min de lectura");
  assert.equal(d.has("es"), true);
  assert.equal(d.has("fr"), false);
  // An unknown language falls back to the default so a page never crashes.
  assert.equal(d.t("fr", "readMore"), "Read more");
  assert.throws(() => d.t("en", "missing"), /unknown key/);
});

test("createDictionary refuses an incomplete language", () => {
  assert.throws(
    () => createDictionary({ en: { a: "A", b: "B" }, es: { a: "A" } }),
    /language "es" is missing 1 key\(s\): b/,
  );
  assert.throws(() => createDictionary({}), /at least one language/);
});

test("interpolate leaves unknown placeholders in place", () => {
  assert.equal(interpolate("Hi {name}, {x}", { name: "Ana" }), "Hi Ana, {x}");
  assert.equal(interpolate("Plain"), "Plain");
});
