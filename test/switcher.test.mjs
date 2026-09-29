import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { LanguageSwitcher, switcherHref } from "../dist/next/index.js";
import { pickSuggestedLanguage } from "../dist/next/client/index.js";

const languages = [
  { id: "en", title: "English", nativeTitle: "English", default: true },
  { id: "es", title: "Spanish", nativeTitle: "Español" },
];
const homeHrefs = { en: "/", es: "/es" };

test("switcher links to the equivalent page, else the language's home", () => {
  const html = renderToStaticMarkup(
    createElement(LanguageSwitcher, {
      current: "en",
      languages,
      links: { es: "/es/prestamos-convencionales" },
      homeHrefs,
      labels: { ariaLabel: "Language" },
    }),
  );
  assert.match(html, /<nav aria-label="Language" data-i18n-switcher/);
  assert.match(html, /<a href="\/es\/prestamos-convencionales" lang="es" hrefLang="es">Español<\/a>/);
  assert.doesNotMatch(html, /English/);

  const fallback = renderToStaticMarkup(
    createElement(LanguageSwitcher, { current: "es", languages, homeHrefs, labels: { ariaLabel: "Idioma" } }),
  );
  assert.match(fallback, /<a href="\/" lang="en" hrefLang="en">English<\/a>/);
  assert.equal(switcherHref("es", { es: null }, homeHrefs), "/es");
});

test("switcher renders nothing with one language, and can show the current one", () => {
  assert.equal(
    renderToStaticMarkup(createElement(LanguageSwitcher, { current: "en", languages: [languages[0]], homeHrefs, labels: { ariaLabel: "Language" } })),
    "",
  );
  const withCurrent = renderToStaticMarkup(
    createElement(LanguageSwitcher, { current: "en", languages, homeHrefs, labels: { ariaLabel: "Language" }, showCurrent: true }),
  );
  assert.match(withCurrent, /<span lang="en" aria-current="true">English<\/span>/);
});

test("pickSuggestedLanguage follows the browser's preference order", () => {
  assert.equal(pickSuggestedLanguage(["es-MX", "en-US"], languages, "en")?.id, "es");
  assert.equal(pickSuggestedLanguage(["es"], languages, "en")?.id, "es");
  assert.equal(pickSuggestedLanguage(["en-US", "es"], languages, "en"), undefined);
  assert.equal(pickSuggestedLanguage(["fr", "es"], languages, "en")?.id, "es");
  assert.equal(pickSuggestedLanguage(["fr"], languages, "en"), undefined);
  assert.equal(pickSuggestedLanguage([], languages, "en"), undefined);
});
