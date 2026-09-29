import { test } from "node:test";
import assert from "node:assert/strict";

test("next entry exposes the shared helpers and a loud routing stub", async () => {
  const next = await import("../dist/next/index.js");
  assert.equal(typeof next.readEnabledLanguages, "function");
  assert.equal(typeof next.defineLanguages, "function");
  assert.throws(() => next.defineI18nRoutes({ languages: [] }), /not implemented until part 3/);
});

test("engine entry throws a loud stub on the server", async () => {
  const engine = await import("../dist/engine/index.js");
  await assert.rejects(
    engine.translateDocument({ document: {}, targetLanguage: "es" }),
    /not implemented until part 4/,
  );
});
