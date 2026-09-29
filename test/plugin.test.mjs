import { test } from "node:test";
import assert from "node:assert/strict";
import {
  i18nPlugin,
  I18N_PLUGIN_NAME,
  translationMetaType,
  TRANSLATION_META_TYPE,
  TRANSLATION_STATUSES,
} from "../dist/sanity/index.js";

test("i18nPlugin is named kaleidico-i18n and registers the translation meta type", () => {
  const plugin = i18nPlugin({ languages: [{ id: "es", title: "Spanish" }] });
  assert.equal(plugin.name, I18N_PLUGIN_NAME);
  assert.equal(I18N_PLUGIN_NAME, "kaleidico-i18n");
  assert.deepEqual(
    plugin.schema.types.map((t) => t.name),
    [TRANSLATION_META_TYPE],
  );
  assert.deepEqual(
    plugin.i18n.languages.languages.map((l) => l.id),
    ["en", "es"],
  );
});

test("translation meta type is a hidden document with the four statuses", () => {
  assert.equal(translationMetaType.name, "i18n.translationMeta");
  assert.equal(translationMetaType.type, "document");
  assert.equal(translationMetaType.__experimental_omnisearch_visibility, false);
  assert.deepEqual(
    translationMetaType.fields.map((f) => f.name),
    ["language", "status", "sourceHash", "legal"],
  );
  assert.deepEqual(
    TRANSLATION_STATUSES.map((s) => s.value),
    ["draft", "needs-update", "awaiting-approval", "approved"],
  );
});
