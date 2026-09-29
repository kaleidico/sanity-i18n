import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localeFilter,
  sharedProjection,
  translationLinks,
  translationMetaId,
  TRANSLATION_META_TYPE,
  TRANSLATION_META_ID_PREFIX,
  TRANSLATION_STATUSES,
  translationStatusLabel,
} from "../dist/next/index.js";

test("localeFilter matches a language, and legacy documents for the default", () => {
  assert.equal(localeFilter("es"), 'language == "es"');
  assert.equal(localeFilter("en"), '(language == "en" || !defined(language))');
  assert.equal(localeFilter("es", "es"), '(language == "es" || !defined(language))');
  assert.equal(localeFilter("pt-BR"), 'language == "pt-BR"');
});

test("sharedProjection reads each shared field from the source when missing", () => {
  assert.equal(
    sharedProjection(["photo", "nmls"]),
    '"photo": coalesce(photo, i18n.source->photo), "nmls": coalesce(nmls, i18n.source->nmls)',
  );
  assert.equal(sharedProjection([]), "");
});

test("translationLinks resolves the metadata document by its deterministic id", () => {
  assert.equal(
    translationLinks(),
    '"language": coalesce(language, "en"), ' +
      '"translations": *[_type == "i18n.translationMeta" && _id == "i18n.meta." + coalesce(^.i18n.source._ref, ^._id)][0].translations[]{ language, "slug": document->slug.current, "status": document->i18n.status }',
  );
  const custom = translationLinks({ slugField: "path", defaultId: "es" });
  assert.match(custom, /"language": coalesce\(language, "es"\)/);
  assert.match(custom, /document->path\.current/);
});

test("translationMetaId is deterministic and strips the drafts prefix", () => {
  assert.equal(TRANSLATION_META_TYPE, "i18n.translationMeta");
  assert.equal(TRANSLATION_META_ID_PREFIX, "i18n.meta.");
  assert.equal(translationMetaId("abc"), "i18n.meta.abc");
  assert.equal(translationMetaId("drafts.abc"), "i18n.meta.abc");
});

test("statuses and labels", () => {
  assert.deepEqual(
    TRANSLATION_STATUSES.map((s) => s.value),
    ["draft", "needs_update", "awaiting_approval", "approved"],
  );
  assert.equal(translationStatusLabel("needs_update"), "Needs update");
  assert.equal(translationStatusLabel("awaiting_approval", { awaiting_approval: "Awaiting NOVA approval" }), "Awaiting NOVA approval");
  assert.equal(translationStatusLabel(undefined), "Draft");
  assert.equal(translationStatusLabel("odd"), "odd");
});
