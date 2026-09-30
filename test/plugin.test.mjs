import { test } from "node:test";
import assert from "node:assert/strict";
import {
  i18nPlugin,
  I18N_PLUGIN_NAME,
  translationMetaType,
  translationBadge,
  TRANSLATION_META_TYPE,
  TRANSLATION_BADGE_COLORS,
} from "../dist/sanity/index.js";

test("i18nPlugin is named kaleidico-i18n and registers the meta type for the translatable types", () => {
  const plugin = i18nPlugin({
    languages: [{ id: "es", title: "Spanish" }],
    translatableTypes: ["page", "blogPost"],
  });
  assert.equal(plugin.name, I18N_PLUGIN_NAME);
  assert.equal(I18N_PLUGIN_NAME, "kaleidico-i18n");
  assert.deepEqual(plugin.schema.types.map((t) => t.name), [TRANSLATION_META_TYPE, "i18n.job", "i18n.secrets", "i18n.manifest"]);
  assert.deepEqual(plugin.i18n.languages.languages.map((l) => l.id), ["en", "es"]);
  assert.deepEqual(plugin.i18n.translatableTypes, ["page", "blogPost"]);

  const meta = plugin.schema.types[0];
  const documentRef = meta.fields.find((f) => f.name === "translations").of[0].fields.find((f) => f.name === "document");
  assert.deepEqual(documentRef.to, [{ type: "page" }, { type: "blogPost" }]);
});

test("i18nPlugin without translatable types registers nothing and adds no badge", () => {
  const plugin = i18nPlugin({ languages: [{ id: "es", title: "Spanish" }] });
  assert.deepEqual(plugin.schema.types, []);
  const prev = [() => null];
  assert.equal(plugin.document.badges(prev, { schemaType: "page" }), prev);
});

test("i18nPlugin adds the badge to translatable types only", () => {
  const plugin = i18nPlugin({
    languages: [{ id: "es", title: "Spanish" }],
    translatableTypes: ["page"],
    labels: { awaiting_approval: "Awaiting NOVA approval" },
  });
  const prev = [];
  const forPage = plugin.document.badges(prev, { schemaType: "page" });
  assert.equal(forPage.length, 1);
  assert.equal(plugin.document.badges(prev, { schemaType: "redirect" }), prev);

  const badge = forPage[0];
  assert.deepEqual(badge({ published: { language: "es", i18n: { status: "awaiting_approval" } }, draft: null }), {
    label: "ES · Awaiting NOVA approval",
    title: "Translation status: Awaiting NOVA approval",
    color: "warning",
  });
});

test("translation meta type is a hidden document linking a source to its languages", () => {
  const meta = translationMetaType({ translatableTypes: ["page"] });
  assert.equal(meta.name, "i18n.translationMeta");
  assert.equal(meta.type, "document");
  assert.equal(meta.__experimental_omnisearch_visibility, false);
  assert.deepEqual(meta.fields.map((f) => f.name), ["sourceType", "translations"]);
  const member = meta.fields[1].of[0];
  assert.deepEqual(member.fields.map((f) => f.name), ["language", "document"]);
  assert.equal(member.fields[1].weak, true);
  assert.throws(() => translationMetaType({ translatableTypes: [] }), /at least one document type/);
});

test("translationBadge shows language and status with the right colour", () => {
  const badge = translationBadge();
  assert.equal(badge({ draft: null, published: null }), null);
  assert.equal(badge({ draft: { _type: "page" }, published: null }), null);
  assert.deepEqual(badge({ draft: { language: "en" }, published: null }), { label: "EN", title: "Source language" });
  assert.deepEqual(badge({ draft: { language: "es" }, published: null }), {
    label: "ES · Draft",
    title: "Translation status: Draft",
    color: undefined,
  });
  assert.equal(badge({ draft: { language: "es", i18n: { status: "needs_update" } } }).color, "danger");
  assert.equal(badge({ draft: { language: "es", i18n: { status: "approved" } } }).color, "success");
  // The draft wins over the published version when both exist.
  assert.equal(
    badge({ draft: { language: "es", i18n: { status: "approved" } }, published: { language: "es", i18n: { status: "draft" } } }).color,
    "success",
  );
  assert.deepEqual(TRANSLATION_BADGE_COLORS, { draft: undefined, needs_update: "danger", awaiting_approval: "warning", approved: "success" });
});
