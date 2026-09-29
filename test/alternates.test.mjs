import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAlternates, openGraphLocale, inLanguage, languageTag, localePath, localeUrl } from "../dist/next/index.js";

const siteUrl = "https://www.example.com";

test("localePath and localeUrl keep the default language at the root", () => {
  assert.equal(localePath("en", "/"), "/");
  assert.equal(localePath("en", "/about"), "/about");
  assert.equal(localePath("es", "/"), "/es");
  assert.equal(localePath("es", "/sobre-nosotros"), "/es/sobre-nosotros");
  assert.equal(localePath("es", "sobre-nosotros"), "/es/sobre-nosotros");
  assert.equal(localeUrl(siteUrl + "/", "es", "/"), "https://www.example.com/es");
  assert.equal(localeUrl(siteUrl, "en", "/"), "https://www.example.com/");
});

test("buildAlternates gives a self canonical and reciprocal hreflang with x-default", () => {
  const en = buildAlternates({ siteUrl, lang: "en", path: "/conventional-loans", translations: { es: "/prestamos-convencionales" } });
  assert.equal(en.canonical, "https://www.example.com/conventional-loans");
  assert.deepEqual(en.languages, {
    "en-US": "https://www.example.com/conventional-loans",
    "es-US": "https://www.example.com/es/prestamos-convencionales",
    "x-default": "https://www.example.com/conventional-loans",
  });

  const es = buildAlternates({ siteUrl, lang: "es", path: "/prestamos-convencionales", translations: { en: "/conventional-loans" } });
  assert.equal(es.canonical, "https://www.example.com/es/prestamos-convencionales");
  assert.deepEqual(es.languages, en.languages);
});

test("buildAlternates lists only the languages that exist for the page", () => {
  const only = buildAlternates({ siteUrl, lang: "en", path: "/careers" });
  assert.deepEqual(only.languages, {
    "en-US": "https://www.example.com/careers",
    "x-default": "https://www.example.com/careers",
  });
  const skipped = buildAlternates({ siteUrl, lang: "en", path: "/careers", translations: { es: null, fr: "" } });
  assert.deepEqual(skipped.languages, only.languages);
});

test("buildAlternates handles the home page and other defaults", () => {
  const home = buildAlternates({ siteUrl, lang: "es", path: "/", translations: { en: "/" } });
  assert.equal(home.canonical, "https://www.example.com/es");
  assert.equal(home.languages["x-default"], "https://www.example.com/");
  const pt = buildAlternates({ siteUrl, lang: "pt-BR", defaultId: "pt-BR", path: "/sobre", translations: { en: "/about" } });
  assert.equal(pt.canonical, "https://www.example.com/sobre");
  assert.equal(pt.languages["pt-BR"], "https://www.example.com/sobre");
  assert.equal(pt.languages["en-US"], "https://www.example.com/en/about");
  assert.equal(pt.languages["x-default"], "https://www.example.com/sobre");
});

test("openGraphLocale, inLanguage and languageTag", () => {
  assert.deepEqual(openGraphLocale("es", ["en", "es"]), { locale: "es_US", alternateLocale: ["en_US"] });
  assert.deepEqual(openGraphLocale("en"), { locale: "en_US" });
  assert.equal(inLanguage("es"), "es-US");
  assert.equal(inLanguage("en"), "en-US");
  assert.equal(languageTag("pt-BR"), "pt-BR");
  assert.equal(languageTag("fr"), "fr");
  assert.equal(languageTag("es", "MX"), "es-MX");
});
