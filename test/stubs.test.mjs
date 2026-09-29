import { test } from "node:test";
import assert from "node:assert/strict";

test("next entry exposes the shared helpers and the routing kit", async () => {
  const next = await import("../dist/next/index.js");
  assert.equal(typeof next.readEnabledLanguages, "function");
  assert.equal(typeof next.defineLanguages, "function");
  assert.equal(typeof next.resolveLocaleRoute, "function");
  assert.equal(typeof next.buildAlternates, "function");
  assert.equal(typeof next.createDictionary, "function");
  assert.equal(typeof next.LanguageSwitcher, "function");
  assert.equal("defineI18nRoutes" in next, false);
});

test("next/middleware entry builds NextResponses from the routing decisions", async () => {
  const mw = await import("../dist/next/middleware/index.js");
  assert.equal(typeof mw.createI18nMiddleware, "function");
});

test("next/client entry is marked for the client and exposes the suggestion strip", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../dist/next/client/index.js", import.meta.url), "utf8");
  assert.ok(source.startsWith('"use client";'));
  const client = await import("../dist/next/client/index.js");
  assert.equal(typeof client.LanguageSuggestion, "function");
  assert.equal(typeof client.pickSuggestedLanguage, "function");
});

test("engine entry throws a loud stub on the server", async () => {
  const engine = await import("../dist/engine/index.js");
  await assert.rejects(
    engine.translateDocument({ document: {}, targetLanguage: "es" }),
    /not implemented until part 4/,
  );
});
