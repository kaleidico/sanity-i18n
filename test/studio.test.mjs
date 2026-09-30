import { test } from "node:test";
import assert from "node:assert/strict";
import { createSchema, defineField, defineType } from "sanity";
import {
  i18nPlugin,
  I18N_HIDDEN_TYPES,
  glossaryField,
  styleGuideField,
  engineField,
  legalApproversField,
  apiKeyField,
  ApiKeyInput,
  KEY_STORAGE_NOT_CONFIGURED,
  translateAction,
  publishWithStaleCheck,
  translationsTool,
  summariseTranslations,
  translationJobType,
  translationSecretsType,
  translationManifestType,
  reportFields,
  buildFieldManifest,
  translatable,
  defineLanguages,
  readGlossary,
  readStyleGuide,
  readEngineSettings,
  ENGINE_SETTINGS_FIELDS,
  MODELS,
  LANGUAGES_GROUP,
} from "../dist/sanity/index.js";

const languages = [{ id: "es", title: "Spanish", nativeTitle: "Español" }];

test("the plugin registers the translate action, the publish check, the tool and the private types", () => {
  const plugin = i18nPlugin({ languages, translatableTypes: ["page"], titles: { page: "Pages" } });
  assert.deepEqual(plugin.schema.types.map((t) => t.name), ["i18n.translationMeta", "i18n.job", "i18n.secrets", "i18n.manifest", "i18n.legalApproval"]);
  assert.deepEqual(I18N_HIDDEN_TYPES, ["i18n.translationMeta", "i18n.secrets", "i18n.manifest", "i18n.job", "i18n.legalApproval"]);
  assert.equal(plugin.i18n.engine, true);

  const publish = () => null;
  publish.action = "publish";
  const other = () => null;
  other.action = "delete";
  const prev = [publish, other];

  const forPage = plugin.document.actions(prev, { schemaType: "page" });
  assert.equal(forPage.length, 3);
  assert.notEqual(forPage[0], publish, "publish is wrapped");
  assert.equal(forPage[0].action, "publish", "and still is the publish action");
  assert.equal(forPage[0].displayName, "PublishTranslation", "the outer wrapper is the publish rule for translations");
  assert.equal(forPage[1], other);
  assert.equal(forPage[2].displayName, "TranslateTo_es");
  // The wrapped action keeps its identity from one render to the next.
  assert.equal(plugin.document.actions(prev, { schemaType: "page" })[0], forPage[0]);
  // Types that are not translatable are left alone.
  assert.equal(plugin.document.actions(prev, { schemaType: "redirect" }), prev);

  assert.equal(plugin.tools.length, 2);
  assert.deepEqual(plugin.tools.map((t) => [t.name, t.title]), [["translations", "Translations"], ["legal-approvals", "Legal approvals"]]);
  assert.ok(plugin.tools.every((t) => typeof t.component === "function"));
  assert.equal(plugin.tools[0].options.titles.page, "Pages");
  assert.equal(plugin.tools[1].options.titles.page, "Pages");

  // The bookkeeping documents are not offered under "new document".
  const templates = ["page", "i18n.job", "i18n.secrets", "i18n.manifest", "i18n.translationMeta", "i18n.legalApproval"].map((templateId) => ({ templateId }));
  assert.deepEqual(plugin.document.newDocumentOptions(templates).map((t) => t.templateId), ["page"]);
});

test("one translate action per language that is not the default", () => {
  const plugin = i18nPlugin({ languages: [{ id: "es", title: "Spanish" }, { id: "pt-BR", title: "Portuguese" }], translatableTypes: ["page"] });
  assert.deepEqual(plugin.document.actions([], { schemaType: "page" }).map((a) => a.displayName), ["TranslateTo_es", "TranslateTo_pt-BR"]);
});

test("engine: false leaves the action, the publish check, the tool and the private types out", () => {
  const plugin = i18nPlugin({ languages, translatableTypes: ["page"], engine: false });
  assert.deepEqual(plugin.schema.types.map((t) => t.name), ["i18n.translationMeta"]);
  const prev = [() => null];
  assert.equal(plugin.document.actions(prev, { schemaType: "page" }), prev);
  assert.deepEqual(plugin.tools, []);
  assert.deepEqual(i18nPlugin({ languages }).tools, []);
});

test("the settings fields land in the Languages group and are never sent to the translator", () => {
  const fields = [glossaryField(), styleGuideField(), engineField(), apiKeyField({ publicKey: "PUBLIC" }), legalApproversField()];
  assert.deepEqual(fields.map((f) => f.name), ["i18nGlossary", "i18nStyleGuide", "i18nEngine", "i18nApiKey", "i18nLegalApprovers"]);
  assert.deepEqual(fields.map((f) => f.name), [...ENGINE_SETTINGS_FIELDS]);
  assert.ok(fields.every((f) => f.group === LANGUAGES_GROUP.name));
  assert.ok(fields.every((f) => f.options.i18n.translate === false));
  assert.equal(glossaryField({ group: false }).group, undefined);
  assert.equal(glossaryField({ name: "glossary" }).name, "glossary");

  const [glossary, style, engine, apiKey, approvers] = fields;
  assert.equal(approvers.type, "array");
  assert.equal(approvers.options.layout, "tags");
  assert.deepEqual(glossary.fields.map((f) => f.name), ["doNotTranslate", "terms"]);
  assert.deepEqual(glossary.fields[1].of[0].fields.map((f) => f.name), ["source", "target", "note"]);
  assert.deepEqual(style.fields.map((f) => [f.name, f.initialValue]), [["market", "es-US"], ["register", "usted"], ["audience", undefined], ["notes", undefined]]);
  assert.deepEqual(style.fields[1].options.list.map((o) => o.value), ["usted", "tu"]);
  assert.deepEqual(engine.fields.map((f) => f.name), ["translatorModel", "reviewerModel", "autoPublishMarketing"]);
  assert.deepEqual(engine.fields[0].options.list.map((o) => o.value), MODELS.map((m) => m.id));
  assert.deepEqual([engine.fields[0].initialValue, engine.fields[1].initialValue], ["claude-opus-5-5", "claude-opus-5-5"]);
  assert.equal(engine.fields[2].readOnly, undefined);
  assert.equal(engine.fields[2].initialValue, true);

  assert.equal(apiKey.type, "string");
  assert.equal(apiKey.components.input, ApiKeyInput);
  assert.equal(apiKey.options.i18n.publicKey, "PUBLIC");
  assert.equal(apiKeyField().options.i18n.publicKey, "");
  assert.equal(KEY_STORAGE_NOT_CONFIGURED, "Translation key storage is not configured on this server yet.");
});

test("the settings fields compile and stay out of the manifest even when not listed as shared", () => {
  const settings = translatable(
    defineType({ name: "settings", type: "document", groups: [LANGUAGES_GROUP], fields: [defineField({ name: "siteName", type: "string" }), glossaryField(), styleGuideField(), engineField(), apiKeyField()] }),
    { languages },
  );
  const plugin = i18nPlugin({ languages, translatableTypes: ["settings"] });
  const schema = createSchema({ name: "s", types: [settings, ...plugin.schema.types] });
  assert.deepEqual(schema._validation?.filter((v) => v.problems.some((p) => p.severity === "error")) ?? [], []);
  const manifest = buildFieldManifest(schema, ["settings"]);
  assert.deepEqual(Object.keys(manifest.documents.settings.fields), ["siteName"]);
});

test("the private document types are hidden, read only and describe what the engine stores", () => {
  const job = translationJobType();
  assert.equal(job.name, "i18n.job");
  assert.equal(job.__experimental_omnisearch_visibility, false);
  assert.deepEqual(job.fields.map((f) => f.name), ["kind", "sourceId", "sourceType", "sourceIds", "language", "mode", "requestedBy", "status", "progress", "createdAt", "startedAt", "finishedAt", "report", "estimate", "error"]);
  assert.deepEqual(translationSecretsType().fields[0].fields.map((f) => f.name), ["ciphertext", "last4", "savedAt", "savedBy", "keyFingerprint"]);
  assert.deepEqual(translationManifestType().fields.map((f) => f.name), ["hash", "manifest", "updatedAt"]);
  const names = reportFields().map((f) => f.name);
  for (const name of ["translatorModel", "reviewerModel", "inputTokens", "outputTokens", "costUsd", "check1Passed", "check1Failures", "reviewIssues", "legalPaths", "held", "holdReasons", "proposedSlug"]) assert.ok(names.includes(name), name);
});

test("reading the glossary, style guide and engine settings tidies what editors typed", () => {
  const settings = {
    i18nGlossary: { doNotTranslate: [" NOVA ", "NMLS", "NOVA", "", null], terms: [{ source: " down payment ", target: "pago inicial", note: "provisional" }, { source: "escrow", target: "" }, null] },
    i18nStyleGuide: { market: " es-US ", register: "tu", audience: " Buyers ", notes: null },
    i18nEngine: { translatorModel: "claude-sonnet-5-5", reviewerModel: "", autoPublishMarketing: true },
  };
  assert.deepEqual(readGlossary(settings), { doNotTranslate: ["NOVA", "NMLS"], terms: [{ source: "down payment", target: "pago inicial", note: "provisional" }] });
  assert.deepEqual(readStyleGuide(settings), { market: "es-US", register: "tu", audience: "Buyers", notes: "" });
  assert.deepEqual(readEngineSettings(settings), { translatorModel: "claude-sonnet-5-5", reviewerModel: "claude-opus-5-5", autoPublishMarketing: true });
  assert.deepEqual(readGlossary(null), { doNotTranslate: [], terms: [] });
  assert.deepEqual(readStyleGuide({}), { market: "es-US", register: "usted", audience: "", notes: "" });
  assert.deepEqual(readEngineSettings(undefined), { translatorModel: "claude-opus-5-5", reviewerModel: "claude-opus-5-5", autoPublishMarketing: true });
  assert.equal(readEngineSettings({ i18nEngine: { autoPublishMarketing: false } }).autoPublishMarketing, false);
});

test("the Translations tool counts per type and works out what a run would do", () => {
  const sources = [
    { _id: "page-a", _type: "page" },
    { _id: "page-b", _type: "page" },
    { _id: "page-c", _type: "page" },
    { _id: "page-d", _type: "page" },
    { _id: "page-e", _type: "page" },
    { _id: "post-a", _type: "blogPost" },
  ];
  const translations = [
    { _id: "page-a-es", _type: "page", source: "page-a", status: "approved", hasHashes: true },
    { _id: "page-b-es", _type: "page", source: "page-b", status: "approved", hasHashes: true },
    // The draft is the newer state of the same translation.
    { _id: "drafts.page-b-es", _type: "page", source: "page-b", status: "needs_update", hasHashes: true },
    { _id: "drafts.page-c-es", _type: "page", source: "page-c", status: "awaiting_approval", hasHashes: true },
    { _id: "page-d-es", _type: "page", source: "page-d", status: "needs_update", hasHashes: false },
    { _id: "orphan-es", _type: "page", status: "draft" },
  ];
  assert.deepEqual(summariseTranslations(sources, translations, ["page", "blogPost", "state"]), [
    {
      type: "page",
      total: 5,
      translated: 4,
      needsUpdate: 2,
      awaitingApproval: 1,
      approved: 1,
      work: [
        { sourceId: "page-b", mode: "changes" },
        { sourceId: "page-d", mode: "full" },
        { sourceId: "page-e", mode: "full" },
      ],
    },
    { type: "blogPost", total: 1, translated: 0, needsUpdate: 0, awaitingApproval: 0, approved: 0, work: [{ sourceId: "post-a", mode: "full" }] },
    { type: "state", total: 0, translated: 0, needsUpdate: 0, awaitingApproval: 0, approved: 0, work: [] },
  ]);
});

test("translateAction, publishWithStaleCheck and translationsTool are exported as building blocks", () => {
  const config = defineLanguages(languages);
  const action = translateAction({ languages: config, translatableTypes: ["page"], language: config.languages[1] });
  assert.equal(typeof action, "function");
  const original = () => null;
  original.action = "publish";
  assert.equal(publishWithStaleCheck(original, { languages: config }).action, "publish");
  assert.equal(translationsTool({ languages: config, translatableTypes: ["page"] }).name, "translations");
});
