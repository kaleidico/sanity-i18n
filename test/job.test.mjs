import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildFieldManifest, encryptSecret, publicKeyFingerprint, runJob, EngineError } from "../dist/engine/index.js";
import { createTranslateRoute } from "../dist/engine/route/index.js";
import { schema, sourcePage, languages, glossary, styleGuide } from "./helpers/fixtures.mjs";
import { createFakeAnthropic, memorySanity } from "./helpers/fake.mjs";

const manifest = buildFieldManifest(schema, ["page", "settings"]);
const keyLines = execFileSync("node", [new URL("../scripts/generate-keys.mjs", import.meta.url).pathname], { encoding: "utf8" }).trim().split("\n");
const publicKey = keyLines[0].slice("NEXT_PUBLIC_I18N_PUBLIC_KEY=".length);
const privateKey = keyLines[1].slice("I18N_PRIVATE_KEY=".length);
const SECRET = "sk-test-0000-not-a-real-key-wxyz";
const JOB = "i18n.job.11111111-2222-3333-4444-555555555555";
const noWait = { sleep: async () => {}, random: () => 0 };

async function secretsDoc() {
  return { _id: "i18n.secrets", _type: "i18n.secrets", anthropicKey: { ciphertext: await encryptSecret(publicKey, SECRET), last4: "wxyz", savedAt: "2026-09-30T00:00:00Z", keyFingerprint: await publicKeyFingerprint(publicKey) } };
}

const settingsDoc = (es = true) => ({
  _id: "settings",
  _type: "settings",
  siteName: "NOVA Home Loans",
  languages: { en: true, es },
  i18nGlossary: glossary,
  i18nStyleGuide: styleGuide,
  i18nEngine: { translatorModel: "claude-sonnet-5-5", reviewerModel: "claude-opus-5-5" },
});

const job = (extra = {}) => ({ _id: JOB, _type: "i18n.job", kind: "translate", sourceId: "page-conventional-loans", sourceType: "page", language: "es", mode: "full", status: "pending", createdAt: "2026-09-30T12:00:00Z", ...extra });

async function setup({ docs, fake = createFakeAnthropic(), config = {} } = {}) {
  const sanity = memorySanity(docs ?? [sourcePage(), settingsDoc(), await secretsDoc(), job()]);
  const keys = [];
  const engineConfig = {
    sanity,
    languages,
    privateKey,
    publicKey,
    manifest,
    anthropic: (apiKey) => (keys.push(apiKey), fake),
    retry: noWait,
    now: () => new Date("2026-09-30T12:00:00Z"),
    ...config,
  };
  return { sanity, fake, keys, engineConfig };
}

const post = (route, body) => route.POST(new Request("http://site.test/api/i18n/translate", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

test("the route accepts a job id and nothing else", async () => {
  const { engineConfig, fake } = await setup();
  const route = createTranslateRoute(engineConfig);
  for (const body of ["not json", {}, { jobId: 5 }, { jobId: "page-conventional-loans" }, { jobId: "i18n.job.short" }, { jobId: JOB, sourceId: "page-x" }, { jobId: `${JOB}/../x` }, [JOB], { documentId: "page-conventional-loans", language: "es" }]) {
    const response = await post(route, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error.code, "bad_request");
  }
  assert.equal(fake.calls.length, 0);
});

test("no job, no work: an unknown id is refused, and so is a document that is not a job", async () => {
  const { engineConfig, fake } = await setup({ docs: [sourcePage(), settingsDoc(), { _id: "i18n.job.aaaaaaaa-0000-0000-0000-000000000000", _type: "page" }] });
  const route = createTranslateRoute(engineConfig);
  assert.equal((await post(route, { jobId: JOB })).status, 404);
  assert.equal((await post(route, { jobId: "i18n.job.aaaaaaaa-0000-0000-0000-000000000000" })).status, 404);
  assert.equal(fake.calls.length, 0);
});

test("a job that is not pending is refused, so a job runs once", async () => {
  for (const status of ["running", "done", "held", "failed"]) {
    const { engineConfig, fake } = await setup({ docs: [sourcePage(), settingsDoc(), job({ status })] });
    const outcome = await runJob(engineConfig, JOB);
    assert.deepEqual([outcome.httpStatus, outcome.error.code], [409, "job_not_pending"]);
    assert.equal(fake.calls.length, 0);
  }
  // Two requests for the same pending job: the second loses.
  const { engineConfig, sanity } = await setup();
  const route = createTranslateRoute(engineConfig);
  const first = await post(route, { jobId: JOB });
  assert.equal(first.status, 200);
  const second = await post(route, { jobId: JOB });
  assert.equal(second.status, 409);
  assert.equal(sanity.store.get(JOB).status, "done");
});

test("a job translates the page, writes a draft and the metadata, and records the report", async () => {
  const { engineConfig, sanity, fake, keys } = await setup();
  const response = await post(createTranslateRoute(engineConfig), { jobId: JOB });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "done" });
  assert.equal(response.headers.get("cache-control"), "no-store");

  // The key was decrypted on the server and handed to the client factory, once.
  assert.deepEqual(keys, [SECRET]);
  // The models come from Site Settings.
  assert.deepEqual([...new Set(fake.calls.map((c) => c.params.model))], ["claude-sonnet-5-5", "claude-opus-5-5"]);

  const draft = sanity.store.get("drafts.page-conventional-loans-es");
  assert.ok(draft, "the translation is written as a draft");
  assert.equal(sanity.store.has("page-conventional-loans-es"), false, "nothing is published: the disclaimer is legal text waiting for approval");
  assert.equal(draft._type, "page");
  assert.equal(draft.language, "es");
  assert.equal(draft.i18n.status, "awaiting_approval");
  assert.deepEqual([draft.i18n.legal.pending, draft.i18n.legal.approved], [1, 0]);
  assert.equal(draft.i18n.source._ref, "page-conventional-loans");
  assert.equal(draft.slug.current, "prestamos-convencionales");
  assert.equal(draft.i18n.report.saved, true);
  assert.equal(draft.i18n.report.translatorModel, "claude-sonnet-5-5");
  assert.equal(draft.i18n.sourceHashes.length, 17);

  assert.deepEqual(sanity.store.get("i18n-meta-page-conventional-loans").translations, [
    { _key: "en", _type: "translation", language: "en", document: { _type: "reference", _ref: "page-conventional-loans", _weak: true } },
    { _key: "es", _type: "translation", language: "es", document: { _type: "reference", _ref: "page-conventional-loans-es", _weak: true } },
  ]);

  const done = sanity.store.get(JOB);
  assert.equal(done.status, "done");
  assert.equal(done.progress, "Finished");
  assert.ok(done.startedAt && done.finishedAt);
  assert.equal(done.report.check1Passed, true);
  assert.equal(done.report.reviewPassed, true);
  assert.equal(done.report.saved, true);
  assert.ok(done.report.costUsd > 0);

  // The English document is not touched.
  assert.deepEqual({ ...sanity.store.get("page-conventional-loans"), _rev: undefined }, { ...sourcePage(), _rev: undefined });
  // Nothing that was written holds the key.
  assert.equal(JSON.stringify([...sanity.store.values()].filter((d) => d._id !== "i18n.secrets")).includes(SECRET), false);
});

test("a job held by check 1 writes no draft and lists what did not match", async () => {
  const { engineConfig, sanity } = await setup({ fake: createFakeAnthropic({ transform: (s) => `[es] ${s.replace("(866) 866-0653", "(866) 866-0563")}` }) });
  const outcome = await runJob(engineConfig, JOB);
  assert.deepEqual([outcome.ok, outcome.status], [true, "held"]);
  assert.equal(sanity.store.has("drafts.page-conventional-loans-es"), false);
  assert.equal(sanity.store.has("i18n-meta-page-conventional-loans"), false);
  const held = sanity.store.get(JOB);
  assert.equal(held.status, "held");
  assert.deepEqual(held.report.check1Failures.map((f) => [f.path, f.category, f.source, f.translated]), [['blocks[_key=="k01"].subheadline', "phone", "(866) 866-0653", "(866) 866-0563"]]);
  assert.equal(held.report.saved, false);
});

test("a job held by the reviewer keeps the draft, marked held", async () => {
  const { engineConfig, sanity } = await setup({ fake: createFakeAnthropic({ issues: [{ path: "title", severity: "high", category: "meaning", note: "Wrong product." }] }) });
  const outcome = await runJob(engineConfig, JOB);
  assert.equal(outcome.status, "held");
  const draft = sanity.store.get("drafts.page-conventional-loans-es");
  assert.equal(draft.i18n.report.held, true);
  assert.equal(draft.i18n.status, "draft");
});

test("failures reach the job in plain words", async () => {
  const cases = [
    [{ docs: [sourcePage(), settingsDoc(), job()] }, "missing_key", /No Anthropic API key has been saved/],
    [{ config: { privateKey: "" } }, "key_storage_not_configured", /Translation key storage is not configured on this server yet/],
    [{ docs: [sourcePage(), settingsDoc(false), job()] }, "language_not_enabled", /switched off in Site Settings/],
    [{ docs: [settingsDoc(), job()] }, "source_missing", /has not been published yet/],
    [{ docs: [sourcePage(), settingsDoc(), job({ language: "fr" })] }, "language_unknown", /not set up for this site/],
    [{ docs: [sourcePage(), settingsDoc(), job({ language: "en" })] }, "language_unknown", /not set up/],
    [{ docs: [{ ...sourcePage(), language: "es" }, settingsDoc(), job()] }, "source_not_default_language", /default language/],
    [{ docs: [{ ...sourcePage(), _type: "redirect" }, settingsDoc(), job()] }, "type_not_translatable", /not set up for translation/],
    [{ config: { manifest: undefined } }, "manifest_missing", /Open the Studio once/],
  ];
  for (const [options, code, message] of cases) {
    const { engineConfig, sanity } = await setup(options);
    const outcome = await runJob(engineConfig, JOB);
    assert.deepEqual([outcome.httpStatus, outcome.ok, outcome.status, outcome.error.code], [200, false, "failed", code], code);
    const failed = sanity.store.get(JOB);
    assert.equal(failed.status, "failed");
    assert.match(failed.error.message, message);
    assert.equal(sanity.store.has("drafts.page-conventional-loans-es"), false);
  }
});

test("a language that is switched off can be allowed explicitly, for scripts", async () => {
  const { engineConfig, sanity } = await setup({ docs: [sourcePage(), settingsDoc(false), await secretsDoc(), job()], config: { requireEnabledLanguage: false } });
  assert.equal((await runJob(engineConfig, JOB)).status, "done");
  assert.ok(sanity.store.has("drafts.page-conventional-loans-es"));
});

test("the manifest is read from the private document the Studio keeps", async () => {
  const stored = { _id: "i18n.manifest", _type: "i18n.manifest", hash: "x", manifest: JSON.stringify(manifest) };
  const { engineConfig } = await setup({ docs: [sourcePage(), settingsDoc(), await secretsDoc(), stored, job()], config: { manifest: undefined } });
  assert.equal((await runJob(engineConfig, JOB)).status, "done");
});

test("a proposed slug that is already taken in that language gets a number", async () => {
  const taken = { _id: "page-other-es", _type: "page", language: "es", slug: { current: "prestamos-convencionales" } };
  const { engineConfig, sanity } = await setup({ docs: [sourcePage(), settingsDoc(), await secretsDoc(), taken, job()] });
  await runJob(engineConfig, JOB);
  assert.equal(sanity.store.get("drafts.page-conventional-loans-es").slug.current, "prestamos-convencionales-2");
  assert.equal(sanity.store.get(JOB).report.proposedSlug, "prestamos-convencionales-2");
});

test("changes mode through a job: only the change is sent, and the draft is rebuilt", async () => {
  const { engineConfig, sanity } = await setup();
  await runJob(engineConfig, JOB);

  const edited = sourcePage();
  edited.blocks[2].heading = "Estimate Your Monthly Payment";
  sanity.store.set("page-conventional-loans", { ...edited, _rev: "r-new" });
  const second = "i18n.job.99999999-2222-3333-4444-555555555555";
  sanity.store.set(second, { ...job({ _id: second, mode: "changes" }), _rev: "r0" });

  const fake = createFakeAnthropic({ transform: (s) => `[nuevo] ${s}` });
  const outcome = await runJob({ ...engineConfig, anthropic: () => fake }, second);
  assert.equal(outcome.status, "done");
  const report = sanity.store.get(second).report;
  assert.deepEqual(report.translatedPaths, ['blocks[_key=="k03"].heading']);
  assert.deepEqual([report.unitsTranslated, report.unitsReused], [1, 15]);
  const draft = sanity.store.get("drafts.page-conventional-loans-es");
  assert.equal(draft.blocks[2].heading, "[nuevo] Estimate Your Monthly Payment");
  assert.equal(draft.title, "[es] Conventional Loans");
  assert.equal(draft.slug.current, "prestamos-convencionales");
});

test("an estimate job works without a key, from characters, and with one, from counted tokens", async () => {
  const estimateJob = job({ kind: "estimate", sourceId: undefined, sourceIds: ["page-conventional-loans", "drafts.page-conventional-loans", "missing-doc"] });

  const without = await setup({ docs: [sourcePage(), settingsDoc(), estimateJob] });
  assert.equal((await runJob(without.engineConfig, JOB)).status, "done");
  const a = without.sanity.store.get(JOB).estimate;
  assert.deepEqual([a.documents, a.method, a.translatorModel, a.reviewerModel], [1, "characters", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.ok(a.costUsd > 0 && a.inputTokens > 0 && a.outputTokens > 0);
  assert.equal(without.fake.calls.length, 0);

  const withKey = await setup({ docs: [sourcePage(), settingsDoc(), await secretsDoc(), estimateJob] });
  assert.equal((await runJob(withKey.engineConfig, JOB)).status, "done");
  const b = withKey.sanity.store.get(JOB).estimate;
  assert.deepEqual([b.documents, b.method, b.counted], [1, "counted", 1]);
  assert.ok(withKey.fake.calls.every((c) => c.endpoint === "countTokens"), "an estimate only counts, it never generates");
  assert.equal(withKey.sanity.store.has("drafts.page-conventional-loans-es"), false);
});

test("a job that outlives its time limit is closed as failed and writes nothing afterwards", async () => {
  const slow = createFakeAnthropic();
  const original = slow.beta.messages.stream;
  slow.beta.messages.stream = (params, options) => ({
    finalMessage: async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return original(params, options).finalMessage();
    },
  });
  const { engineConfig, sanity } = await setup({ fake: slow, config: { deadlineMs: 20 } });
  const outcome = await runJob(engineConfig, JOB);
  assert.deepEqual([outcome.status, outcome.error.code], ["failed", "timeout"]);
  assert.match(sanity.store.get(JOB).error.message, /took longer than the server allows/);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(sanity.store.has("drafts.page-conventional-loans-es"), false);
  assert.equal(sanity.store.get(JOB).status, "failed");
});

test("EngineError keeps a code, plain words and safe details", () => {
  const error = new EngineError("structure_mismatch", { details: ["title: missing"] });
  assert.equal(error.code, "structure_mismatch");
  assert.match(error.message, /Nothing was saved/);
  assert.deepEqual(error.details, ["title: missing"]);
});
