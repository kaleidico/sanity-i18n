import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildFieldManifest,
  translateDocument,
  translateUnits,
  chunkUnits,
  extractUnits,
  reviewTranslation,
  parseReviewerResponse,
  translatorSystemPrompt,
  reviewerSystemPrompt,
  estimateCost,
  tokensFromCharacters,
  callModel,
  countTokens,
  withRetry,
  backoffDelay,
  createLimiter,
  isRetryable,
  retryAfterMs,
  toEngineError,
  EngineError,
  decryptSecret,
  encryptSecret,
  publicKeyFingerprint,
  loadApiKey,
  costOf,
  modelInfo,
  MODELS,
  RATES_AS_OF,
  CHARS_PER_TOKEN,
  TRANSLATION_OUTPUT_FACTOR,
  REVIEW_INPUT_FACTOR,
  REVIEW_OUTPUT_TOKENS,
  diffSource,
  toSlug,
  translationId,
  parseJsonObject,
} from "../dist/engine/index.js";
import { schema, sourcePage, glossary, styleGuide, spanish, english } from "./helpers/fixtures.mjs";
import { createFakeAnthropic, mapText, memorySanity } from "./helpers/fake.mjs";

const manifest = buildFieldManifest(schema, ["page", "settings"]);
const models = { translatorModel: "claude-opus-5-5", reviewerModel: "claude-opus-5-5" };
const noWait = { sleep: async () => {}, random: () => 0 };
const prompt = { sourceLanguage: english, targetLanguage: spanish, glossary, styleGuide };
const clone = (v) => JSON.parse(JSON.stringify(v));

const base = (fake, extra = {}) => ({
  document: sourcePage(),
  language: spanish,
  sourceLanguage: english,
  manifest,
  glossary,
  styleGuide,
  models,
  client: () => fake,
  policy: { retry: noWait },
  now: () => new Date("2026-09-30T12:00:00Z"),
  ...extra,
});

const apiError = (status, headers = {}) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: `status ${status}` } }, `status ${status}`, new Headers(headers));

// ── Prompts ─────────────────────────────────────────────────────────────

test("the translator prompt carries the style guide, the glossary and the hard rules", () => {
  const text = translatorSystemPrompt(prompt);
  assert.match(text, /Market: es-US/);
  assert.match(text, /address the reader as usted/);
  assert.match(text, /Audience: First-time buyers/);
  assert.match(text, /- NOVA Home Loans\n- NMLS/);
  assert.match(text, /down payment => pago inicial \(provisional\)/);
  for (const rule of ["NMLS number", "phone number", "email address", "URL", "placeholder token", "pipe character", "line break", "Do not add a sentence", "legal, regulatory and disclosure text faithfully", "do-not-translate list"]) {
    assert.ok(text.includes(rule), rule);
  }
  assert.match(translatorSystemPrompt({ ...prompt, styleGuide: { ...styleGuide, register: "tu" } }), /address the reader as tú/);
  assert.match(translatorSystemPrompt({ ...prompt, glossary: { doNotTranslate: [], terms: [] } }), /has not set a glossary/);
  assert.match(reviewerSystemPrompt(prompt), /"issues"/);
});

// ── The whole run ───────────────────────────────────────────────────────

test("a full run translates the whole document in one request, passes both checks and builds the draft", async () => {
  const fake = createFakeAnthropic();
  const progress = [];
  const { translation, report, upToDate } = await translateDocument(base(fake, { onProgress: (s) => progress.push(s) }));

  assert.equal(upToDate, false);
  const translateCalls = fake.calls.filter((c) => JSON.parse(c.params.messages[0].content).task === "translate");
  const reviewCalls = fake.calls.filter((c) => JSON.parse(c.params.messages[0].content).task === "review");
  assert.equal(translateCalls.length, 1, "one translator request for the whole document");
  assert.equal(reviewCalls.length, 1, "one separate reviewer request");
  assert.deepEqual(progress, ["Translating", "Checking numbers, links and other exact values", "Reviewing the translation"]);

  // The request: streamed through the fallback-capable endpoint, system prompt cached, effort set, no sampling parameters.
  const { endpoint, params } = translateCalls[0];
  assert.equal(endpoint, "beta");
  assert.equal(params.model, "claude-opus-5-5");
  assert.equal(params.fallbacks, "default");
  assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
  assert.deepEqual(params.output_config, { effort: "medium" });
  assert.equal(params.system[0].cache_control.type, "ephemeral");
  assert.equal("temperature" in params, false);
  assert.equal("thinking" in params, false);
  const request = JSON.parse(params.messages[0].content);
  assert.equal(request.slug, "conventional-loans");
  assert.equal(request.targetLanguage, "es");
  assert.equal("context" in request, false);
  assert.equal(reviewCalls[0].params.output_config.effort, "high");
  assert.equal(reviewCalls[0].params.output_config.format.type, "json_schema");

  // The draft: same structure, text translated, everything else copied, shared fields left to the source.
  assert.equal(translation._id, undefined);
  assert.equal(translation.language, "es");
  assert.equal(translation.title, "[es] Conventional Loans");
  assert.deepEqual(translation.slug, { _type: "slug", current: "prestamos-convencionales" });
  assert.equal("nmls" in translation, false);
  assert.equal("photo" in translation, false);
  assert.equal(translation.blocks[0].ctaHref, "https://apply.example.com/start");
  assert.equal(translation.blocks[0].variant, "dark");
  assert.equal(translation.blocks[2].defaultRate, 6.5);
  assert.equal(translation.blocks[2].fieldName, "loan_amount");
  assert.deepEqual(translation.blocks[1].content[1].markDefs, sourcePage().blocks[1].content[1].markDefs);
  assert.deepEqual(translation.blocks[1].content[1].children.map((c) => [c._key, c.marks]), sourcePage().blocks[1].content[1].children.map((c) => [c._key, c.marks]));
  assert.equal(translation.seo.canonicalUrl, "https://www.example.com/conventional-loans");

  const i18n = translation.i18n;
  assert.deepEqual(i18n.source, { _type: "reference", _ref: "page-conventional-loans", _weak: true });
  assert.equal(i18n.status, "draft");
  assert.equal(i18n.translatedAt, "2026-09-30T12:00:00.000Z");
  assert.match(i18n.sourceHash, /^[0-9a-f]{64}$/);
  assert.equal(i18n.sourceHashes.length, 17);
  assert.equal(diffSource(sourcePage(), translation, manifest).upToDate, true);

  assert.equal(report.mode, "full");
  assert.equal(report.translationId, "page-conventional-loans-es");
  assert.deepEqual([report.unitsTotal, report.unitsTranslated, report.unitsReused], [16, 16, 0]);
  assert.equal(report.check1Passed, true);
  assert.equal(report.check1Checked, 17);
  assert.equal(report.reviewPassed, true);
  assert.equal(report.held, false);
  assert.deepEqual(report.legalPaths, ['blocks[_key=="k03"].disclaimer']);
  assert.deepEqual([report.sourceSlug, report.proposedSlug], ["conventional-loans", "prestamos-convencionales"]);
  assert.deepEqual(report.servedBy, ["claude-opus-5-5"]);
  assert.equal(report.usage.length, 2);
  assert.ok(report.inputTokens > 0 && report.outputTokens > 0 && report.costUsd > 0);
  assert.equal(report.ratesAsOf, RATES_AS_OF);
  assert.equal(report.costUsd, Math.round(report.usage.reduce((n, u) => n + costOf(u, u.model), 0) * 1e6) / 1e6);
  // Stored lists carry keys, as Sanity needs.
  assert.ok(i18n.report.usage.every((u) => typeof u._key === "string"));
});

test("a structure mismatch is retried once with the validation errors, then accepted", async () => {
  const fake = createFakeAnthropic({
    onTranslate: ({ request, isRetry }) => {
      const translated = mapText(request.translate, (s) => `[es] ${s}`);
      if (!isRetry) translated.blocks[1].content[1].children.pop();
      return { translated, slug: "prestamos" };
    },
  });
  const { translation, report } = await translateDocument(base(fake));
  assert.equal(report.structureRetries, 1);
  assert.ok(translation);
  const retry = fake.calls[1].params.messages;
  assert.equal(retry.length, 3);
  assert.equal(retry[1].role, "assistant");
  assert.deepEqual(retry[1].content, [{ type: "text", text: retry[1].content[0].text }]);
  assert.match(retry[2].content, /does not have the same structure/);
  assert.match(retry[2].content, /expected 5 span\(s\), got 4/);
});

test("a structure mismatch that survives the retry holds the document with the differences listed", async () => {
  const fake = createFakeAnthropic({
    onTranslate: ({ request }) => {
      const translated = mapText(request.translate, (s) => `[es] ${s}`);
      translated.blocks[0]._key = "changed";
      return { translated };
    },
  });
  await assert.rejects(translateDocument(base(fake)), (error) => {
    assert.ok(error instanceof EngineError);
    assert.equal(error.code, "structure_mismatch");
    assert.match(error.details[0], /_key must stay "k01", got "changed"/);
    return true;
  });
  assert.equal(fake.calls.length, 2, "one attempt and one retry, no reviewer");
});

test("an answer that is not JSON is treated as a structure mismatch", async () => {
  const fake = createFakeAnthropic({ onTranslate: () => "I cannot do that" });
  await assert.rejects(translateDocument(base(fake)), (error) => error.code === "structure_mismatch" && /not a JSON object/.test(error.details[0]));
});

test("check 1 holds a translation with a changed number, lists the path, and skips the reviewer", async () => {
  const fake = createFakeAnthropic({ transform: (s) => `[es] ${s.replace("6.5%", "6.8%")}` });
  const { translation, report } = await translateDocument(base(fake));
  assert.equal(translation, null);
  assert.equal(report.held, true);
  assert.equal(report.saved, false);
  assert.equal(report.check1Passed, false);
  assert.equal(report.reviewPassed, false);
  assert.deepEqual(report.check1Failures, [
    { path: 'blocks[_key=="k02"].content[_key=="p2"]', category: "percentage", source: "6.5%", translated: "6.8%", note: "The percentage changed." },
  ]);
  assert.match(report.holdReasons[0], /1 exact value\(s\)/);
  assert.equal(fake.calls.length, 1, "the reviewer is not run on a translation that failed check 1");
});

test("a high severity reviewer issue holds the document but keeps the draft for a person", async () => {
  const issues = [
    { path: 'blocks[_key=="k03"].disclaimer', severity: "high", category: "legal", note: "The translation drops 'not a commitment to lend'." },
    { path: "title", severity: "low", category: "tone", note: "Could be shorter." },
  ];
  const fake = createFakeAnthropic({ issues });
  const { translation, report } = await translateDocument(base(fake));
  assert.ok(translation);
  assert.equal(report.held, true);
  assert.equal(report.check1Passed, true);
  assert.equal(report.reviewPassed, false);
  assert.deepEqual(report.reviewIssues, issues);
  assert.match(report.holdReasons[0], /1 high severity issue/);
  // The reviewer saw source and translation side by side, and which paths are legal.
  const review = JSON.parse(fake.calls[1].params.messages[0].content);
  assert.deepEqual(review.legalPaths, ['blocks[_key=="k03"].disclaimer']);
  assert.deepEqual(review.items[0], { path: "title", source: "Conventional Loans", translation: "[es] Conventional Loans" });
});

test("medium and low reviewer issues are recorded without holding", async () => {
  const fake = createFakeAnthropic({ issues: [{ path: "title", severity: "medium", category: "terminology", note: "Prefer the glossary term." }] });
  const { report } = await translateDocument(base(fake));
  assert.equal(report.held, false);
  assert.equal(report.reviewPassed, true);
  assert.equal(report.reviewIssues.length, 1);
});

test("a reviewer answer that cannot be read holds the document", async () => {
  const fake = createFakeAnthropic({ onReview: () => "no json here" });
  const { report } = await translateDocument(base(fake));
  assert.equal(report.held, true);
  assert.equal(report.reviewPassed, false);
  assert.match(report.holdReasons[0], /could not be read/);
});

test("parseReviewerResponse keeps well-formed issues and normalises the rest", () => {
  const known = new Set(["title", "seo.metaTitle"]);
  const text = "```json\n" + JSON.stringify({
    issues: [
      { path: "title", severity: "HIGH", category: "Meaning", note: " Says the opposite. " },
      { path: "seo.metaTitle", severity: "severe", category: "style", note: "Unknown labels fall back." },
      { path: "nowhere", severity: "low", category: "tone", note: "Unknown path." },
      { path: "title", severity: "low", category: "tone", note: "" },
      "not an object",
      null,
    ],
  }) + "\n```";
  assert.deepEqual(parseReviewerResponse(text, known), {
    ok: true,
    issues: [
      { path: "title", severity: "high", category: "meaning", note: "Says the opposite." },
      { path: "seo.metaTitle", severity: "medium", category: "meaning", note: "Unknown labels fall back." },
      { path: "nowhere (path not recognised)", severity: "low", category: "tone", note: "Unknown path." },
    ],
  });
  assert.deepEqual(parseReviewerResponse('{"issues": []}'), { ok: true, issues: [] });
  assert.deepEqual(parseReviewerResponse("nothing"), { ok: false, issues: [] });
  assert.deepEqual(parseReviewerResponse('{"issues": "none"}'), { ok: false, issues: [] });
  assert.deepEqual(parseJsonObject('text {"a": 1} more'), { a: 1 });
  assert.equal(parseJsonObject("[1,2]"), null);
});

// ── Changes only ────────────────────────────────────────────────────────

test("changes mode re-translates only what changed, with the rest supplied as fixed reference, and merges", async () => {
  const first = await translateDocument(base(createFakeAnthropic()));
  const existing = { ...first.translation, _id: "drafts.page-conventional-loans-es", _type: "page" };
  // A person edited one untouched string of the Spanish by hand.
  existing.blocks[2].heading = "Calcule su pago (edited by hand)";

  const edited = sourcePage();
  edited.blocks[0].headline = "Conventional Home Loans";
  edited.blocks[1].content[1].children[0].text = "A 15-year fixed loan at ";
  edited.blocks[0].variant = "light";

  const fake = createFakeAnthropic({ transform: (s) => `[nuevo] ${s}` });
  const { translation, report, diff } = await translateDocument(base(fake, { document: edited, mode: "changes", existingTranslation: existing }));

  assert.deepEqual(diff.changed, ['blocks[_key=="k01"].headline', 'blocks[_key=="k02"].content[_key=="p2"]']);
  assert.equal(report.mode, "changes");
  assert.deepEqual(report.translatedPaths, diff.changed);
  assert.deepEqual([report.unitsTotal, report.unitsTranslated, report.unitsReused], [16, 2, 14]);

  const request = JSON.parse(fake.calls[0].params.messages[0].content);
  // Only the two changed units are asked for...
  assert.deepEqual(request.translate, {
    blocks: [
      { _key: "k01", _type: "heroBlock", headline: "Conventional Home Loans" },
      { _key: "k02", _type: "richTextBlock", content: [request.translate.blocks[1].content[0]] },
    ],
  });
  assert.equal(request.translate.blocks[1].content[0]._key, "p2");
  // ...the whole source goes along for context, and the unchanged Spanish as reference.
  assert.equal(request.context.source.title, "Conventional Loans");
  assert.equal(request.context.source.blocks.length, 3);
  assert.equal(request.context.existingTranslation.title, "[es] Conventional Loans");
  assert.equal(request.context.existingTranslation.blocks[0].headline, undefined);
  assert.equal("slug" in request, false, "an existing translation keeps its slug");
  // The reviewer and check 1 look at the changed units only.
  assert.equal(report.check1Checked, 2);

  // Merge: changed units are new, untouched units keep the existing Spanish, hand edits included.
  assert.equal(translation.blocks[0].headline, "[nuevo] Conventional Home Loans");
  assert.equal(translation.blocks[1].content[1].children[0].text, "[nuevo] A 15-year fixed loan at ");
  assert.equal(translation.title, "[es] Conventional Loans");
  assert.equal(translation.blocks[0].subheadline, "[es] Down payments may be as low as 3%. Call (866) 866-0653.");
  assert.equal(translation.blocks[2].heading, "Calcule su pago (edited by hand)");
  assert.deepEqual(translation.slug, { _type: "slug", current: "prestamos-convencionales" });
  // What is not text follows the English.
  assert.equal(translation.blocks[0].variant, "light");
  // The hashes now match the new English.
  assert.equal(diffSource(edited, translation, manifest).upToDate, true);
  assert.equal(translation.i18n.status, "draft");
});

test("changes mode with nothing changed sends nothing and writes nothing", async () => {
  const first = await translateDocument(base(createFakeAnthropic()));
  const fake = createFakeAnthropic();
  let built = 0;
  const result = await translateDocument(base(fake, { mode: "changes", existingTranslation: first.translation, client: () => (built++, fake) }));
  assert.equal(result.upToDate, true);
  assert.equal(result.translation, null);
  assert.equal(fake.calls.length, 0);
  assert.equal(built, 0, "no client, so no key, is needed");
  assert.equal(result.report.unitsTranslated, 0);
});

test("changes mode with only a non-text change rebuilds the draft without calling the model", async () => {
  const first = await translateDocument(base(createFakeAnthropic()));
  const edited = sourcePage();
  edited.blocks[0].ctaHref = "https://apply.example.com/new";
  const fake = createFakeAnthropic();
  const { translation, report } = await translateDocument(base(fake, { document: edited, mode: "changes", existingTranslation: first.translation }));
  assert.equal(fake.calls.length, 0);
  assert.equal(translation.blocks[0].ctaHref, "https://apply.example.com/new");
  assert.equal(translation.blocks[0].headline, "[es] Conventional Loans");
  assert.deepEqual([report.unitsTranslated, report.unitsReused, report.costUsd], [0, 16, 0]);
});

test("changes mode falls back to a full run when the existing translation has no stored hashes", async () => {
  const fake = createFakeAnthropic();
  const { report } = await translateDocument(base(fake, { mode: "changes", existingTranslation: { _id: "page-conventional-loans-es", language: "es", title: "A mano", slug: { current: "a-mano" } } }));
  assert.equal(report.mode, "full");
  assert.equal(report.unitsTranslated, 16);
  assert.equal(report.proposedSlug, "a-mano", "a translation that already has an address keeps it");
});

// ── Large documents ─────────────────────────────────────────────────────

test("a large document is split by top-level blocks, each request carrying the outline and its neighbours", async () => {
  const doc = sourcePage();
  const units = extractUnits(doc, manifest);
  const chunks = chunkUnits(doc, units, 700);
  assert.ok(chunks.length >= 3);
  assert.deepEqual(chunks.flat().map((u) => u.path), units.map((u) => u.path));
  // A block is never split across requests.
  for (const chunk of chunks) for (const other of chunks) if (chunk !== other) assert.equal(chunk.some((u) => other.some((o) => o.piece === u.piece)), false);

  const fake = createFakeAnthropic();
  const result = await translateUnits({ client: fake, model: "claude-opus-5-5", prompt, document: doc, units, allUnits: units, slug: "conventional-loans", maxCharsPerRequest: 700, concurrency: 2, policy: { retry: noWait } });
  assert.equal(result.requests, chunks.length);
  assert.equal(result.values.size, units.length);
  assert.equal(result.slug, "prestamos-convencionales");
  const requests = fake.calls.map((c) => JSON.parse(c.params.messages[0].content));
  assert.ok(requests.every((r) => Array.isArray(r.context.outline) && r.context.outline.length === 5));
  assert.equal(requests.filter((r) => "slug" in r).length, 1);
  assert.ok(requests.some((r) => typeof r.context.before === "string") && requests.some((r) => typeof r.context.after === "string"));
  assert.match(requests[0].context.outline.join("\n"), /blocks\[_key=="k02"\]: How a conventional loan works/);
});

test("a single block that is too large for one request is refused in plain words", () => {
  const doc = sourcePage();
  doc.blocks[0].subheadline = "word ".repeat(40_000);
  assert.throws(() => chunkUnits(doc, extractUnits(doc, manifest), 24_000), (e) => e.code === "document_too_large");
});

// ── Retries, limits and errors ──────────────────────────────────────────

test("withRetry backs off exponentially and stops after maxRetries", async () => {
  const waits = [];
  let attempts = 0;
  await assert.rejects(
    withRetry(async () => { attempts++; throw new Error("again"); }, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30_000, isRetryable: () => true, sleep: async (ms) => waits.push(ms), random: () => 1 }),
    /again/,
  );
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(backoffDelay(10, 1000, 30_000, 1), 30_000);
  assert.equal(backoffDelay(0, 1000, 30_000, 0), 500);

  let once = 0;
  await assert.rejects(withRetry(async () => { once++; throw new Error("no"); }, { isRetryable: () => false, sleep: async () => {} }));
  assert.equal(once, 1);
});

test("429, 529 and network errors are retried and then succeed; retry-after is honoured", async () => {
  const waits = [];
  const fake = createFakeAnthropic({
    errors: [apiError(429, { "retry-after": "2" }), apiError(529), new Anthropic.APIConnectionError({ message: "socket hang up" })],
  });
  const answer = await callModel(
    fake,
    { model: "claude-opus-5-5", system: "s", messages: [{ role: "user", content: JSON.stringify({ task: "review", items: [] }) }] },
    { retry: { sleep: async (ms) => waits.push(ms), random: () => 1, baseDelayMs: 1000 } },
  );
  assert.equal(answer.text, '{"issues":[]}');
  assert.equal(fake.calls.length, 4);
  assert.deepEqual(waits, [2000, 2000, 4000], "the first wait is the server's retry-after, then backoff");

  assert.equal(isRetryable(apiError(429)), true);
  assert.equal(isRetryable(apiError(500)), true);
  assert.equal(isRetryable(apiError(529)), true);
  assert.equal(isRetryable(new Anthropic.APIConnectionError({ message: "x" })), true);
  assert.equal(isRetryable(apiError(400)), false);
  assert.equal(isRetryable(apiError(401)), false);
  assert.equal(isRetryable(new Anthropic.APIUserAbortError()), false);
  assert.equal(retryAfterMs(apiError(429, { "retry-after": "1.5" })), 1500);
  assert.equal(retryAfterMs(apiError(429)), undefined);
});

test("a rate limit that does not clear fails in plain words after the retries", async () => {
  const fake = createFakeAnthropic({ errors: Array.from({ length: 10 }, () => apiError(429)) });
  await assert.rejects(
    callModel(fake, { model: "claude-opus-5-5", system: "s", messages: [{ role: "user", content: "{}" }] }, { retry: { ...noWait, maxRetries: 2 } }),
    (e) => e instanceof EngineError && e.code === "rate_limited" && /limiting how fast/.test(e.message),
  );
  assert.equal(fake.calls.length, 3);
});

test("errors are not retried when they cannot succeed, and each reads as plain words", async () => {
  const cases = [
    [apiError(401), "key_rejected", /did not accept the API key/],
    [apiError(403), "key_rejected", /did not allow this API key/],
    [apiError(402), "billing", /billing problem/],
    [apiError(404), "model_unavailable", /not available to this API key/],
    [apiError(413), "document_too_large", /too large/],
    [apiError(429), "rate_limited", /limiting/],
    [apiError(500), "service_unavailable", /busy or unavailable/],
    [apiError(529), "service_unavailable", /busy or unavailable/],
    [new Anthropic.APIConnectionError({ message: "x" }), "network", /could not reach Anthropic/],
    [new Anthropic.APIConnectionTimeoutError(), "timeout", /took longer/],
    [new Anthropic.APIUserAbortError(), "timeout", /took longer/],
    [new Error("boom"), "unexpected", /unexpected/],
  ];
  for (const [error, code, message] of cases) {
    const engineError = toEngineError(error, "claude-opus-5-5");
    assert.equal(engineError.code, code);
    assert.match(engineError.message, message);
  }
  const rejected = toEngineError(apiError(400), "claude-opus-5-5");
  assert.equal(rejected.code, "request_rejected");
  assert.equal(rejected.details[0], "claude-opus-5-5");

  const fake = createFakeAnthropic({ errors: [apiError(401)] });
  await assert.rejects(callModel(fake, { model: "claude-haiku-4-5", system: "s", messages: [{ role: "user", content: "{}" }] }, { retry: noWait }), (e) => e.code === "key_rejected");
  assert.equal(fake.calls.length, 1);
});

test("a declined request and a cut-off answer are reported, not read as a translation", async () => {
  const call = { model: "claude-opus-5-5", system: "s", messages: [{ role: "user", content: JSON.stringify({ task: "review" }) }] };
  await assert.rejects(callModel(createFakeAnthropic({ stopReason: "refusal" }), call), (e) => e.code === "declined");
  await assert.rejects(callModel(createFakeAnthropic({ stopReason: "max_tokens" }), call), (e) => e.code === "document_too_large");
});

test("the request shape follows the model: fallback where offered, plain otherwise, and a rejected fallback is sent again without it", async () => {
  const message = [{ role: "user", content: JSON.stringify({ task: "review" }) }];
  const haiku = createFakeAnthropic();
  await callModel(haiku, { model: "claude-haiku-4-5", system: "s", messages: message, effort: "high" });
  assert.equal(haiku.calls[0].endpoint, "messages");
  assert.equal("output_config" in haiku.calls[0].params, false, "Haiku 4.5 takes no effort setting");
  assert.equal("fallbacks" in haiku.calls[0].params, false);
  assert.equal(haiku.calls[0].params.max_tokens, 64_000);

  const opus = createFakeAnthropic({ errors: [apiError(400)], servedBy: "claude-opus-5" });
  const answer = await callModel(opus, { model: "claude-opus-5-5", system: "s", messages: message, effort: "high" }, { retry: noWait });
  assert.deepEqual(opus.calls.map((c) => c.endpoint), ["beta", "messages"]);
  assert.equal("fallbacks" in opus.calls[1].params, false);
  assert.equal(answer.servedBy, "claude-opus-5", "the report names the model that actually answered");
});

test("createLimiter never runs more than the limit at once", async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 8 }, () => limit(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; })));
  assert.equal(peak, 2);
});

// ── Cost ────────────────────────────────────────────────────────────────

test("the rate table is dated and costOf multiplies tokens by the published rates", () => {
  assert.match(RATES_AS_OF, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(MODELS.map((m) => m.id), ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-haiku-4-5"]);
  assert.deepEqual([modelInfo("claude-opus-5-5").inputPerMTok, modelInfo("claude-opus-5-5").outputPerMTok], [4, 20]);
  assert.deepEqual([modelInfo("claude-sonnet-5-5").inputPerMTok, modelInfo("claude-sonnet-5-5").outputPerMTok], [2, 10]);
  assert.equal(costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-opus-5-5"), 24);
  assert.equal(costOf({ inputTokens: 10_000, outputTokens: 2_000 }, "claude-sonnet-5-5"), 0.04);
  assert.equal(costOf({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }, "claude-opus-5-5"), 5.2);
  assert.equal(costOf({ inputTokens: 5, outputTokens: 5 }, "unknown-model"), 0);
});

test("estimateCost without a key uses characters divided by a fixed ratio, times the rates", async () => {
  const docs = [sourcePage()];
  const estimate = await estimateCost({ documents: docs, language: spanish, sourceLanguage: english, manifest, models, glossary, styleGuide });
  assert.equal(estimate.method, "characters");
  assert.equal(estimate.documents, 1);
  assert.equal(estimate.strings, 21);
  assert.equal(estimate.counted, 0);
  assert.match(estimate.note, /3 characters per token/);

  // The same figures by hand.
  const units = extractUnits(docs[0], manifest);
  const { translatorRequestPreview, reviewerRequest, unitPairs } = await import("../dist/engine/index.js");
  const preview = translatorRequestPreview(prompt, docs[0], units, "conventional-loans");
  const reviewUser = reviewerRequest(prompt, units.flatMap((u) => unitPairs(u, u.value)).map((p) => ({ ...p, translated: "" })), []);
  const t = (s) => Math.ceil(s.length / CHARS_PER_TOKEN);
  const tIn = t(preview.system) + t(preview.user);
  const tOut = Math.ceil(t(preview.user) * TRANSLATION_OUTPUT_FACTOR);
  const rIn = t(reviewerSystemPrompt(prompt)) + Math.ceil(t(reviewUser) * REVIEW_INPUT_FACTOR);
  assert.equal(estimate.inputTokens, tIn + rIn);
  assert.equal(estimate.outputTokens, tOut + REVIEW_OUTPUT_TOKENS);
  const dollars = (tIn * 4 + tOut * 20 + rIn * 4 + REVIEW_OUTPUT_TOKENS * 20) / 1e6;
  assert.equal(estimate.costUsd, Math.round(dollars * 1e4) / 1e4);
  assert.equal(tokensFromCharacters(10), 4);

  // A cheaper pair of models costs less for the same tokens.
  const cheaper = await estimateCost({ documents: docs, language: spanish, manifest, models: { translatorModel: "claude-sonnet-5-5", reviewerModel: "claude-haiku-4-5" } });
  assert.ok(cheaper.costUsd < estimate.costUsd);
  assert.equal((await estimateCost({ documents: [], language: spanish, manifest })).costUsd, 0);
});

test("estimateCost with a counter counts every document, or a sample when there are many", async () => {
  const counted = [];
  const counter = async ({ model, system, user }) => { counted.push(model); return Math.ceil((system.length + user.length) / 4); };

  const few = await estimateCost({ documents: [sourcePage(), sourcePage()], language: spanish, manifest, models, countTokens: counter });
  assert.equal(few.method, "counted");
  assert.equal(few.counted, 2);
  assert.equal(counted.length, 2 + 2 * 2, "each prompt once, then two requests per document");
  assert.match(few.note, /counted by Anthropic for every document/);

  counted.length = 0;
  const many = await estimateCost({ documents: Array.from({ length: 30 }, sourcePage), language: spanish, manifest, models, countTokens: counter, sampleSize: 5 });
  assert.equal(many.method, "sampled");
  assert.equal(many.counted, 5);
  assert.equal(many.documents, 30);
  assert.equal(counted.length, 2 + 5 * 2);
  // Identical documents: the scaled figure is the counted figure times fifteen.
  assert.ok(Math.abs(many.inputTokens - few.inputTokens * 15) <= 30);
});

test("countTokens goes through the SDK's token counting call", async () => {
  const fake = createFakeAnthropic();
  const n = await countTokens(fake, { model: "claude-opus-5-5", system: "system", messages: [{ role: "user", content: "hello" }] });
  assert.ok(n > 0);
  assert.equal(fake.calls[0].endpoint, "countTokens");
  assert.equal(fake.calls[0].params.model, "claude-opus-5-5");
});

// ── Key storage ─────────────────────────────────────────────────────────

const keyLines = execFileSync("node", [new URL("../scripts/generate-keys.mjs", import.meta.url).pathname], { encoding: "utf8" }).trim().split("\n");
const publicKey = keyLines[0].slice("NEXT_PUBLIC_I18N_PUBLIC_KEY=".length);
const privateKey = keyLines[1].slice("I18N_PRIVATE_KEY=".length);

test("generate-keys prints the two environment lines", () => {
  assert.equal(keyLines.length, 2);
  assert.ok(keyLines[0].startsWith("NEXT_PUBLIC_I18N_PUBLIC_KEY="));
  assert.ok(keyLines[1].startsWith("I18N_PRIVATE_KEY="));
  assert.ok(publicKey.length > 700 && privateKey.length > 3000, "a 4096 bit pair");
});

test("a key encrypted with the public key is read back only with the private key", async () => {
  const secret = "sk-test-0123456789-not-a-real-key-abcdefghijklmnopqrstuvwxyz";
  const ciphertext = await encryptSecret(publicKey, secret);
  assert.notEqual(ciphertext, secret);
  assert.equal(ciphertext.includes(secret.slice(3, 20)), false);
  assert.notEqual(await encryptSecret(publicKey, secret), ciphertext, "every encryption is different");
  assert.equal(await decryptSecret(privateKey, ciphertext), secret);
  // The public key cannot decrypt, and another pair's private key cannot either.
  await assert.rejects(decryptSecret(publicKey, ciphertext));
  assert.match(await publicKeyFingerprint(publicKey), /^[0-9a-f]{16}$/);
});

test("loadApiKey explains every way the stored key can be unusable", async () => {
  const secret = "sk-test-abcdefghijklmnop-wxyz";
  const stored = { ciphertext: await encryptSecret(publicKey, secret), last4: "wxyz", savedAt: "2026-09-30T00:00:00Z", keyFingerprint: await publicKeyFingerprint(publicKey) };
  const withKey = memorySanity([{ _id: "i18n.secrets", _type: "i18n.secrets", anthropicKey: stored }]);

  assert.equal(await loadApiKey(withKey, { privateKey, publicKey }), secret);
  await assert.rejects(loadApiKey(withKey, { privateKey: "" }), (e) => e.code === "key_storage_not_configured" && /Translation key storage is not configured on this server yet/.test(e.message));
  await assert.rejects(loadApiKey(memorySanity([]), { privateKey }), (e) => e.code === "missing_key");
  await assert.rejects(loadApiKey(memorySanity([{ _id: "i18n.secrets", anthropicKey: { ...stored, ciphertext: "AAAA" } }]), { privateKey }), (e) => e.code === "key_unreadable");
  await assert.rejects(loadApiKey(memorySanity([{ _id: "i18n.secrets", anthropicKey: { ...stored, keyFingerprint: "0000000000000000" } }]), { privateKey, publicKey }), (e) => e.code === "key_unreadable");
});

test("small helpers: slugs and translation ids", () => {
  assert.equal(toSlug("Préstamos Convencionales: ¿qué son?"), "prestamos-convencionales-que-son");
  assert.equal(toSlug("  Año nuevo / 2026 "), "ano-nuevo-2026");
  assert.equal(translationId("drafts.page-conventional-loans", "es"), "page-conventional-loans-es");
  assert.equal(translationId("settings", "es"), "settings-es");
  assert.equal(translationId("homepage", "es"), "homepage-es");
});

// ── Hygiene ─────────────────────────────────────────────────────────────

test("the Anthropic SDK is imported by the engine entries only", () => {
  const read = (path) => readFileSync(new URL(`../dist/${path}`, import.meta.url), "utf8");
  for (const entry of ["sanity/index.js", "next/index.js", "next/middleware/index.js", "next/client/index.js"]) {
    assert.equal(read(entry).includes("@anthropic-ai/sdk"), false, entry);
  }
  assert.match(read("engine/index.js"), /from ["']@anthropic-ai\/sdk["']/);
  assert.match(read("engine/route/index.js"), /from ["']@anthropic-ai\/sdk["']/);
  // The SDK stays a dependency, not a copy inside the bundle.
  assert.equal(read("engine/index.js").includes("anthropic-version"), false);
});

test("the engine never writes to a log", () => {
  const read = (path) => readFileSync(new URL(`../dist/${path}`, import.meta.url), "utf8");
  for (const entry of ["engine/index.js", "engine/route/index.js"]) assert.equal(/console\.(log|info|warn|error|debug)\(/.test(read(entry)), false, entry);
});
