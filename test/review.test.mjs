import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  buildFieldManifest,
  encryptSecret,
  publicKeyFingerprint,
  runJob,
  publishTranslation,
  approveUnit,
  sendBackUnit,
  legalApprovalId,
  legalSourceHash,
  normaliseLegalText,
  planLegalRegistry,
  planStaleTranslations,
  checkTranslationForPublish,
  applyLegalValue,
  legalUnitsOf,
  readLegalApprovers,
  isLegalApprover,
  statusAfterRun,
  LEGAL_APPROVAL_TYPE,
  ENGINE_SETTINGS_FIELDS,
} from "../dist/engine/index.js";
import { createApprovalRoute, createTranslateRoute } from "../dist/engine/route/index.js";
import { buildLog, staleToast, defineLanguages } from "../dist/sanity/index.js";
import { schema, sourcePage, languages, glossary, styleGuide } from "./helpers/fixtures.mjs";
import { createFakeAnthropic, memorySanity } from "./helpers/fake.mjs";

const manifest = buildFieldManifest(schema, ["page", "settings"]);
const keyLines = execFileSync("node", [new URL("../scripts/generate-keys.mjs", import.meta.url).pathname], { encoding: "utf8" }).trim().split("\n");
const publicKey = keyLines[0].slice("NEXT_PUBLIC_I18N_PUBLIC_KEY=".length);
const privateKey = keyLines[1].slice("I18N_PRIVATE_KEY=".length);
const SECRET = "sk-test-0000-not-a-real-key-wxyz";
const NOW = "2026-09-30T12:00:00.000Z";
const noWait = { sleep: async () => {}, random: () => 0 };
const DISCLAIMER = "Results are estimates and are not a commitment to lend. NMLS 3087.";
const LEGAL_PATH = 'blocks[_key=="k03"].disclaimer';
const UNIT_ID = legalApprovalId("es", legalSourceHash(DISCLAIMER));
const APPROVER = { id: "pApprover1", name: "Nina Compliance", email: "Nina@nova.test" };

async function secretsDoc() {
  return { _id: "i18n.secrets", _type: "i18n.secrets", anthropicKey: { ciphertext: await encryptSecret(publicKey, SECRET), last4: "wxyz", savedAt: NOW, keyFingerprint: await publicKeyFingerprint(publicKey) } };
}

const settingsDoc = (extra = {}) => ({
  _id: "settings",
  _type: "settings",
  siteName: "NOVA Home Loans",
  languages: { en: true, es: true },
  i18nGlossary: glossary,
  i18nStyleGuide: styleGuide,
  i18nEngine: { translatorModel: "claude-sonnet-5-5", reviewerModel: "claude-opus-5-5" },
  i18nLegalApprovers: ["nina@nova.test"],
  ...extra,
});

let jobCount = 0;
const jobId = () => `i18n.job.${String(++jobCount).padStart(8, "0")}-2222-3333-4444-555555555555`;
const translateJob = (sourceId = "page-conventional-loans", extra = {}) => ({ _id: jobId(), _type: "i18n.job", kind: "translate", sourceId, sourceType: "page", language: "es", mode: "full", status: "pending", createdAt: NOW, requestedBy: "Editor Ed", ...extra });
const approvalJob = (kind, extra = {}) => ({ _id: jobId(), _type: "i18n.job", kind, language: "es", unitId: UNIT_ID, status: "pending", createdAt: NOW, approver: APPROVER, ...extra });

async function setup({ docs, fake = createFakeAnthropic(), config = {}, authors } = {}) {
  const sanity = memorySanity(docs ?? [sourcePage(), settingsDoc(), await secretsDoc()], { authors });
  const engineConfig = { sanity, languages, privateKey, publicKey, manifest, anthropic: () => fake, retry: noWait, now: () => new Date(NOW), ...config };
  const run = async (job, route = "translate") => {
    sanity.store.set(job._id, { _rev: "r0", ...job });
    if (job.approver && !sanity.authors.has(job._id)) sanity.authors.set(job._id, job.approver.id);
    const handler = route === "approve" ? createApprovalRoute(engineConfig) : createTranslateRoute(engineConfig);
    const response = await handler.POST(new Request("http://site.test/api/i18n/x", { method: "POST", body: JSON.stringify({ jobId: job._id }) }));
    return { response, body: await response.json(), job: sanity.store.get(job._id) };
  };
  return { sanity, fake, engineConfig, run };
}

// ── Ids and hashing ──────────────────────────────────────────────────────

test("a legal unit is the normalised English text, hashed, with a dash-only id", () => {
  assert.equal(normaliseLegalText("  Results  are\n estimates.\t"), "Results are estimates.");
  assert.equal(legalSourceHash(" Results are estimates. "), legalSourceHash("Results\n\nare   estimates."));
  assert.notEqual(legalSourceHash("Results are estimates."), legalSourceHash("Results are estimates"));
  const id = legalApprovalId("es", legalSourceHash("Results are estimates."));
  assert.match(id, /^i18n-legal-es-[0-9a-f]{12}$/);
  assert.equal(id.includes("."), false, "no period: the site reads approvals without a token");
  assert.equal(legalApprovalId("pt-BR", "abcdef0123456789"), "i18n-legal-pt-BR-abcdef012345");
});

test("the approver list is read lower case and matched without regard to case", () => {
  assert.deepEqual(readLegalApprovers({ i18nLegalApprovers: [" Nina@Nova.test ", "", "nina@nova.test", 5, "ken@nova.test"] }), ["nina@nova.test", "ken@nova.test"]);
  assert.deepEqual(readLegalApprovers({}), []);
  assert.equal(isLegalApprover("NINA@nova.test", ["nina@nova.test"]), true);
  assert.equal(isLegalApprover("", ["nina@nova.test"]), false);
  assert.equal(isLegalApprover(undefined, []), false);
  assert.ok(ENGINE_SETTINGS_FIELDS.includes("i18nLegalApprovers"), "the approver list is a shared settings field");
});

// ── The planner ──────────────────────────────────────────────────────────

function planFor(entries, translationText = "[es] " + DISCLAIMER) {
  const source = sourcePage();
  const translation = JSON.parse(JSON.stringify(source));
  translation.blocks[2].disclaimer = translationText;
  const units = legalUnitsOf(source, manifest);
  assert.deepEqual(units.map((u) => u.path), [LEGAL_PATH]);
  return { plan: planLegalRegistry({ language: "es", documentId: "page-conventional-loans-es", documentType: "page", units, translation, entries: new Map(entries.map((e) => [e._id, e])), now: NOW, by: { name: "Editor Ed" } }), translation };
}

const entry = (status, extra = {}) => ({
  _id: UNIT_ID, _type: LEGAL_APPROVAL_TYPE, language: "es", sourceHash: legalSourceHash(DISCLAIMER), sourceText: DISCLAIMER, kind: "text",
  translatedText: "Los resultados son estimaciones. NMLS 3087.", translatedValue: JSON.stringify("Los resultados son estimaciones. NMLS 3087."),
  status, occurrences: [], history: [], createdAt: NOW, updatedAt: NOW, ...extra,
});

test("no registry entry: a pending entry is proposed with the translation, and the draft waits", () => {
  const { plan, translation } = planFor([]);
  assert.deepEqual([plan.legal.pending, plan.legal.approved], [1, 0]);
  assert.deepEqual(plan.legal.paths.map((p) => [p.path, p.unitId, p.status]), [[LEGAL_PATH, UNIT_ID, "pending"]]);
  const created = plan.mutations.find((m) => m.createIfNotExists);
  assert.equal(created.createIfNotExists._id, UNIT_ID);
  assert.equal(created.createIfNotExists.status, "pending");
  assert.equal(created.createIfNotExists.sourceText, DISCLAIMER);
  assert.equal(created.createIfNotExists.translatedText, "[es] " + DISCLAIMER);
  assert.equal(created.createIfNotExists.history[0].decidedBy.name, "Editor Ed");
  const inserted = plan.mutations.find((m) => m.patch?.insert)?.patch.insert.items[0];
  assert.deepEqual([inserted.documentId, inserted.documentType, inserted.path], ["page-conventional-loans-es", "page", LEGAL_PATH]);
  assert.equal(translation.blocks[2].disclaimer, "[es] " + DISCLAIMER, "the proposal is what the run produced");
  assert.equal(statusAfterRun(false, plan.legal), "awaiting_approval");
  assert.equal(statusAfterRun(true, plan.legal), "draft");
});

test("an approved entry is reused: the approved wording replaces the translation and nothing waits", () => {
  const { plan, translation } = planFor([entry("approved")]);
  assert.deepEqual([plan.legal.pending, plan.legal.approved], [1 - 1, 1]);
  assert.equal(translation.blocks[2].disclaimer, "Los resultados son estimaciones. NMLS 3087.");
  assert.equal(plan.mutations.some((m) => m.createIfNotExists), false);
  assert.equal(plan.mutations.some((m) => m.patch?.set?.status), false, "the entry's status is not touched");
  assert.equal(statusAfterRun(false, plan.legal), "approved");
});

test("a pending entry keeps its proposal on every occurrence; a sent back one takes the new proposal and is pending again", () => {
  const pending = planFor([entry("pending")]);
  assert.equal(pending.translation.blocks[2].disclaimer, "Los resultados son estimaciones. NMLS 3087.", "every occurrence shows the approver the same words");
  assert.equal(pending.plan.legal.pending, 1);

  const sentBack = planFor([entry("sent_back", { comment: "Too informal" })], "[nuevo] " + DISCLAIMER);
  const patch = sentBack.plan.mutations.find((m) => m.patch?.set?.status === "pending").patch;
  assert.equal(patch.set.translatedText, "[nuevo] " + DISCLAIMER);
  assert.deepEqual(patch.unset, ["decidedBy", "decidedAt", "comment", "supersededBy"]);
  assert.ok(sentBack.plan.mutations.some((m) => m.patch?.insert?.after === "history[-1]"), "the new proposal is on the history");
  assert.equal(sentBack.plan.legal.pending, 1);

  const superseded = planFor([entry("superseded", { supersededBy: "abc" })]);
  assert.equal(superseded.plan.legal.pending, 1, "an English wording that came back is approved again, not assumed");
});

test("applyLegalValue writes strings, lists and blocks, keeping marks when the spans line up", () => {
  const doc = { a: "x", list: ["1", "2"], body: [{ _key: "b1", _type: "block", children: [{ _key: "s1", _type: "span", marks: ["strong"], text: "Old" }, { _key: "s2", _type: "span", marks: [], text: " words" }] }] };
  assert.equal(applyLegalValue(doc, ["a"], "y"), true);
  assert.equal(applyLegalValue(doc, ["list"], ["3"]), true);
  assert.deepEqual([doc.a, doc.list], ["y", ["3"]]);
  assert.equal(applyLegalValue(doc, ["body", { _key: "b1" }], { _type: "block", children: [{ _type: "span", text: "Nuevas" }, { _type: "span", text: " palabras" }] }), true);
  assert.deepEqual(doc.body[0].children.map((c) => [c.text, c.marks]), [["Nuevas", ["strong"]], [" palabras", []]]);
  assert.equal(applyLegalValue(doc, ["body", { _key: "b1" }], { _type: "block", children: [{ _type: "span", text: "Todo junto" }] }), true);
  assert.deepEqual(doc.body[0].children.map((c) => c.text), ["Todo junto", ""]);
  assert.equal(applyLegalValue(doc, ["missing", "path"], "z"), false);
});

// ── The engine hook, end to end ──────────────────────────────────────────

test("a run with legal text lands awaiting approval, registers the unit, and publishTranslation refuses", async () => {
  const { sanity, run } = await setup();
  const first = await run(translateJob());
  assert.deepEqual(first.body, { ok: true, status: "done" });
  const draft = sanity.store.get("drafts.page-conventional-loans-es");
  assert.equal(draft.i18n.status, "awaiting_approval");
  assert.deepEqual([draft.i18n.legal.pending, draft.i18n.legal.approved], [1, 0]);
  assert.equal(draft.i18n.legal.paths[0].unitId, UNIT_ID);
  assert.equal(draft.i18n.report.status, "awaiting_approval");
  assert.equal(draft.i18n.report.published, false);
  assert.equal(sanity.store.has("page-conventional-loans-es"), false, "held, never published");

  const unit = sanity.store.get(UNIT_ID);
  assert.equal(unit._type, LEGAL_APPROVAL_TYPE);
  assert.equal(unit.status, "pending");
  assert.equal(unit.sourceText, DISCLAIMER);
  assert.equal(unit.translatedText, "[es] " + DISCLAIMER);
  assert.deepEqual(unit.occurrences.map((o) => [o.documentId, o.path]), [["page-conventional-loans-es", LEGAL_PATH]]);
  assert.equal(unit.history.length, 1);

  const refused = await publishTranslation(sanity, "drafts.page-conventional-loans-es", { manifest });
  assert.equal(refused.published, false);
  assert.match(refused.reason, /Awaiting approval, not Approved/);
  assert.match(refused.reason, /1 piece\(s\) of legal text are waiting/);
  assert.equal(sanity.store.has("page-conventional-loans-es"), false);
});

test("a page with no legal text is approved and published on its own (model b), unless automatic publishing is off", async () => {
  const plain = sourcePage();
  plain.blocks = plain.blocks.slice(0, 2);
  const on = await setup({ docs: [plain, settingsDoc(), await secretsDoc()] });
  const result = await on.run(translateJob());
  assert.equal(result.job.report.status, "approved");
  assert.equal(result.job.report.published, true);
  const published = on.sanity.store.get("page-conventional-loans-es");
  assert.ok(published, "published");
  assert.equal(published.i18n.status, "approved");
  assert.equal(published.i18n.report.published, true);
  assert.ok(published.i18n.publishedAt);
  assert.equal(on.sanity.store.has("drafts.page-conventional-loans-es"), false, "the draft became the published document");

  const off = await setup({ docs: [plain, settingsDoc({ i18nEngine: { translatorModel: "claude-sonnet-5-5", reviewerModel: "claude-opus-5-5", autoPublishMarketing: false } }), await secretsDoc()] });
  const kept = await off.run(translateJob());
  assert.deepEqual([kept.job.report.status, kept.job.report.published], ["approved", false]);
  assert.ok(off.sanity.store.has("drafts.page-conventional-loans-es"));
  assert.equal(off.sanity.store.has("page-conventional-loans-es"), false);
});

test("a run held by the reviewer stays a draft even though its legal unit is queued", async () => {
  const { sanity, run } = await setup({ fake: createFakeAnthropic({ issues: [{ path: "title", severity: "high", category: "meaning", note: "Wrong product." }] }) });
  const result = await run(translateJob());
  assert.equal(result.job.status, "held");
  const draft = sanity.store.get("drafts.page-conventional-loans-es");
  assert.equal(draft.i18n.status, "draft");
  assert.equal(draft.i18n.legal.pending, 1);
  assert.equal(sanity.store.get(UNIT_ID).status, "pending");
});

test("approving through the route: only a listed approver who created the job, then every occurrence is updated and published", async () => {
  const { sanity, run } = await setup();
  await run(translateJob());

  // A second English page carrying the same disclaimer: its draft is filled from the pending proposal and waits on the same unit.
  const second = { ...sourcePage(), _id: "page-refinance", title: "Refinance" };
  sanity.store.set("page-refinance", { _rev: "r0", ...second });
  await run(translateJob("page-refinance"));
  const unitBefore = sanity.store.get(UNIT_ID);
  assert.deepEqual(unitBefore.occurrences.map((o) => o.documentId), ["page-conventional-loans-es", "page-refinance-es"]);
  assert.equal(sanity.store.get("drafts.page-refinance-es").i18n.status, "awaiting_approval");

  // Not on the list.
  const stranger = await run(approvalJob("approve", { approver: { id: "pOther", name: "Someone", email: "someone@nova.test" } }), "approve");
  assert.deepEqual([stranger.job.status, stranger.job.error.code], ["failed", "not_an_approver"]);
  // On the list, but the job was created by another user.
  const forged = approvalJob("approve");
  sanity.authors.set(forged._id, "pOther");
  const forgedRun = await run({ ...forged }, "approve");
  assert.deepEqual([forgedRun.job.status, forgedRun.job.error.code], ["failed", "approver_unverified"]);
  assert.equal(sanity.store.get(UNIT_ID).status, "pending", "nothing changed");
  // An approval job sent to the translate route is refused before it is claimed.
  const misrouted = await run(approvalJob("approve"), "translate");
  assert.equal(misrouted.response.status, 400);
  assert.equal(misrouted.body.error.code, "wrong_route");
  assert.equal(sanity.store.get(misrouted.job._id).status, "pending");

  // The real thing.
  const approved = await run(approvalJob("approve", { comment: "Reads well." }), "approve");
  assert.deepEqual(approved.body, { ok: true, status: "done" });
  assert.equal(approved.job.approval.status, "approved");
  assert.deepEqual(approved.job.approval.translations.map((t) => [t.documentId, t.status, t.published]), [
    ["page-conventional-loans-es", "approved", true],
    ["page-refinance-es", "approved", true],
  ]);

  const unit = sanity.store.get(UNIT_ID);
  assert.equal(unit.status, "approved");
  assert.deepEqual(unit.decidedBy, APPROVER);
  assert.equal(unit.decidedAt, NOW);
  assert.equal(unit.comment, "Reads well.");
  assert.deepEqual(unit.history.map((h) => [h.status, h.decidedBy?.name ?? null, h.comment]), [
    ["pending", "Editor Ed", "Proposed by a translation run"],
    ["approved", "Nina Compliance", "Reads well."],
  ]);

  for (const id of ["page-conventional-loans-es", "page-refinance-es"]) {
    const published = sanity.store.get(id);
    assert.ok(published, `${id} is live`);
    assert.equal(published.i18n.status, "approved");
    assert.equal(published.i18n.approvedBy, "Nina Compliance");
    assert.equal(published.i18n.approvedAt, NOW);
    assert.deepEqual([published.i18n.legal.pending, published.i18n.legal.approved], [0, 1]);
    assert.equal(published.i18n.legal.paths[0].status, "approved");
    assert.equal(published.blocks[2].disclaimer, "[es] " + DISCLAIMER);
    assert.equal(sanity.store.has(`drafts.${id}`), false);
  }

  // A third page with the same disclaimer needs no second approval: approved wording, approved, published on the spot.
  const third = { ...sourcePage(), _id: "page-fha", title: "FHA" };
  sanity.store.set("page-fha", { _rev: "r0", ...third });
  const thirdRun = await run(translateJob("page-fha"));
  assert.deepEqual([thirdRun.job.report.status, thirdRun.job.report.legalApproved, thirdRun.job.report.legalPending, thirdRun.job.report.published], ["approved", 1, 0, true]);
  assert.equal(sanity.store.get("page-fha-es").blocks[2].disclaimer, "[es] " + DISCLAIMER);
  assert.equal(sanity.store.get(UNIT_ID).occurrences.length, 3);
  assert.equal(sanity.store.get(UNIT_ID).history.length, 2, "no new decision was needed");

  // Approving again is refused: nothing is waiting.
  const again = await run(approvalJob("approve"), "approve");
  assert.deepEqual([again.job.status, again.job.error.code], ["failed", "unit_not_pending"]);
});

test("send back needs a comment, records it, and leaves the translations held", async () => {
  const { sanity, run } = await setup();
  await run(translateJob());
  const noComment = await run(approvalJob("send_back"), "approve");
  assert.deepEqual([noComment.job.status, noComment.job.error.code], ["failed", "comment_required"]);
  const sent = await run(approvalJob("send_back", { comment: "Use usted, and keep NMLS 3087 at the end." }), "approve");
  assert.equal(sent.job.approval.status, "sent_back");
  const unit = sanity.store.get(UNIT_ID);
  assert.equal(unit.status, "sent_back");
  assert.equal(unit.comment, "Use usted, and keep NMLS 3087 at the end.");
  assert.equal(unit.history.at(-1).status, "sent_back");
  assert.equal(sanity.store.get("drafts.page-conventional-loans-es").i18n.status, "awaiting_approval");
  assert.equal(sanity.store.has("page-conventional-loans-es"), false);

  // A new run proposes again and the unit is pending once more.
  const rerun = await run(translateJob("page-conventional-loans", { mode: "full" }));
  assert.equal(rerun.job.report.status, "awaiting_approval");
  assert.equal(sanity.store.get(UNIT_ID).status, "pending");
  assert.equal(sanity.store.get(UNIT_ID).comment, undefined);
});

test("approveUnit and sendBackUnit refuse an unknown unit", async () => {
  const { sanity } = await setup();
  await assert.rejects(approveUnit({ sanity, unitId: "i18n-legal-es-000000000000", decidedBy: APPROVER, autoPublish: false }), /not in the approval queue/);
  await assert.rejects(sendBackUnit({ sanity, unitId: "i18n-legal-es-000000000000", decidedBy: APPROVER, comment: "x" }), /not in the approval queue/);
});

// ── publishTranslation ───────────────────────────────────────────────────

test("publishTranslation refuses a hand edit to approved legal text, a held draft, and a missing manifest", async () => {
  const { sanity, run } = await setup();
  await run(translateJob());
  await run(approvalJob("approve"), "approve");
  assert.ok(sanity.store.has("page-conventional-loans-es"));

  // Someone edits the Spanish disclaimer by hand on a new draft and sets the status to Approved.
  const draft = { ...JSON.parse(JSON.stringify(sanity.store.get("page-conventional-loans-es"))), _id: "drafts.page-conventional-loans-es" };
  draft.blocks[2].disclaimer = "Otra redacción sin aprobar.";
  sanity.store.set(draft._id, draft);
  const edited = await publishTranslation(sanity, draft._id, { manifest });
  assert.equal(edited.published, false);
  assert.match(edited.reason, /differs from the approved wording/);

  draft.blocks[2].disclaimer = "[es] " + DISCLAIMER;
  draft.i18n.report.held = true;
  sanity.store.set(draft._id, draft);
  const held = await publishTranslation(sanity, draft._id, { manifest });
  assert.match(held.reason, /held for a person/);

  draft.i18n.report.held = false;
  sanity.store.set(draft._id, draft);
  assert.match((await publishTranslation(sanity, draft._id, { manifest: null })).reason, /does not have the list of translatable fields/);
  assert.match((await publishTranslation(sanity, "page-conventional-loans-es", { manifest })).reason, /Only a draft/);
  assert.match((await publishTranslation(sanity, "drafts.missing", { manifest })).reason, /no draft/);

  const ok = await publishTranslation(sanity, draft._id, { manifest });
  assert.deepEqual([ok.published, ok.id], [true, "page-conventional-loans-es"]);
  assert.equal(sanity.store.has(draft._id), false);
});

test("checkTranslationForPublish lists every reason in plain words", () => {
  const doc = { i18n: { status: "draft", report: { held: true }, legal: { pending: 2, approved: 0, paths: [{ path: "a", unitId: "u1", status: "pending" }] } } };
  const check = checkTranslationForPublish(doc, null, new Map([["u1", { status: "sent_back", translatedText: "" }]]), { labels: { awaiting_approval: "Awaiting NOVA approval" } });
  assert.equal(check.ok, false);
  assert.deepEqual(check.reasons, [
    "The translation is Draft, not Approved.",
    "The translation is held for a person to look at; see the translation report.",
    "2 piece(s) of legal text are waiting for approval.",
    "Legal text at a is sent back.",
  ]);
  assert.equal(checkTranslationForPublish({ i18n: { status: "approved" } }, null, new Map()).ok, true);
});

// ── Re-lock when the English changes ────────────────────────────────────

async function livePair() {
  const { sanity, run } = await setup();
  await run(translateJob());
  await run(approvalJob("approve"), "approve");
  const published = sanity.store.get("page-conventional-loans-es");
  assert.equal(published.i18n.status, "approved");
  return { sanity, published: JSON.parse(JSON.stringify(published)) };
}

test("a legal change in the English re-locks the draft, supersedes the registry entry and leaves the live page alone", async () => {
  const { sanity, published } = await livePair();
  const edited = sourcePage();
  edited.blocks[2].disclaimer = "Results are estimates only and are not a commitment to lend. NMLS 3087.";
  const plan = planStaleTranslations({ source: edited, translations: [{ published, draft: null }], manifest, now: NOW, metaIds: new Set(["i18n-meta-page-conventional-loans"]) });
  assert.deepEqual(plan.marks, [{ id: "page-conventional-loans-es", language: "es", status: "awaiting_approval", legalChanged: [LEGAL_PATH], superseded: [UNIT_ID], draftCreated: true }]);
  await sanity.mutate(plan.mutations);

  const draft = sanity.store.get("drafts.page-conventional-loans-es");
  assert.ok(draft, "a draft was made from the published translation");
  assert.equal(draft.i18n.status, "awaiting_approval");
  assert.equal(draft.i18n.staleSince, NOW);
  assert.equal(draft.blocks[2].disclaimer, "[es] " + DISCLAIMER, "the draft still carries the old wording until it is re-translated");
  const live = sanity.store.get("page-conventional-loans-es");
  assert.deepEqual({ ...live, _rev: null }, { ...published, _rev: null }, "the published translation is untouched");
  assert.equal(live.i18n.status, "approved");
  const unit = sanity.store.get(UNIT_ID);
  assert.equal(unit.status, "superseded");
  assert.equal(unit.supersededBy, legalSourceHash(edited.blocks[2].disclaimer));
  assert.equal(unit.history.at(-1).status, "superseded");
  const meta = sanity.store.get("i18n-meta-page-conventional-loans");
  assert.equal(meta.staleSince, NOW);
  assert.equal(meta.translations.find((t) => t._key === "es").staleSince, NOW);

  // Publishing the English again while still stale does not supersede twice.
  const again = planStaleTranslations({ source: edited, translations: [{ published: live, draft }], manifest, now: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual(again.marks[0].superseded, []);
  assert.equal(again.mutations.some((m) => m.createIfNotExists), false, "the draft exists, so none is created");
  assert.equal(again.mutations.some((m) => m.patch?.id === "i18n-meta-page-conventional-loans"), false, "no meta id was given, so no meta patch");

  // A changes run proposes the new wording: pending on a new unit, the old one stays superseded, the draft waits.
  sanity.store.set("page-conventional-loans", { ...edited, _rev: "r-new" });
  const fake = createFakeAnthropic({ transform: (s) => `[nuevo] ${s}` });
  const engineConfig = { sanity, languages, privateKey, publicKey, manifest, anthropic: () => fake, retry: noWait, now: () => new Date(NOW) };
  const job = translateJob("page-conventional-loans", { mode: "changes" });
  sanity.store.set(job._id, { _rev: "r0", ...job });
  const outcome = await runJob(engineConfig, job._id);
  assert.equal(outcome.status, "done");
  const after = sanity.store.get("drafts.page-conventional-loans-es");
  assert.equal(after.i18n.status, "awaiting_approval");
  assert.equal(after.i18n.staleSince, undefined, "a fresh run clears the stale mark");
  const newUnit = legalApprovalId("es", legalSourceHash(edited.blocks[2].disclaimer));
  assert.equal(sanity.store.get(newUnit).status, "pending");
  assert.equal(sanity.store.get(UNIT_ID).status, "superseded");
  assert.equal(sanity.store.get("page-conventional-loans-es").i18n.status, "approved", "still live, still approved");
});

test("a change to marketing text marks the draft Needs update only; hand-made translations are left alone", async () => {
  const { sanity, published } = await livePair();
  const edited = sourcePage();
  edited.title = "Conventional Home Loans";
  const plan = planStaleTranslations({ source: edited, translations: [{ published, draft: null }], manifest, now: NOW });
  assert.deepEqual(plan.marks.map((m) => [m.status, m.legalChanged, m.superseded]), [["needs_update", [], []]]);
  await sanity.mutate(plan.mutations);
  assert.equal(sanity.store.get("drafts.page-conventional-loans-es").i18n.status, "needs_update");
  assert.equal(sanity.store.get("page-conventional-loans-es").i18n.status, "approved");

  const byHand = { _id: "page-conventional-loans-es", _type: "page", language: "es", title: "Hecho a mano", i18n: { status: "approved" } };
  assert.deepEqual(planStaleTranslations({ source: edited, translations: [{ published: byHand }], manifest, now: NOW }).marks, []);
  assert.deepEqual(planStaleTranslations({ source: sourcePage(), translations: [{ published }], manifest, now: NOW }).marks, [], "nothing changed, nothing marked");
});

test("the toast after a stale check says what happened", () => {
  const config = defineLanguages(languages);
  const legal = staleToast([{ id: "x", language: "es", status: "awaiting_approval", legalChanged: ["a"], superseded: ["u"], draftCreated: true }], config);
  assert.equal(legal.status, "warning");
  assert.match(legal.description, /Spanish version is Awaiting approval again/);
  assert.match(legal.description, /keeps its last approved wording/);
  const marketing = staleToast([{ id: "x", language: "es", status: "needs_update", legalChanged: [], superseded: [], draftCreated: false }], config);
  assert.equal(marketing.title, "Translation marked Needs update");
  assert.match(marketing.description, /live Spanish page is unchanged/);
});

test("the log lists every decision, newest first", () => {
  const rows = buildLog([
    { _id: "u1", language: "es", sourceText: "One", history: [{ _key: "a", status: "pending", decidedAt: "2026-09-01T00:00:00Z", sourceHash: "h" }, { _key: "b", status: "approved", decidedAt: "2026-09-03T00:00:00Z", sourceHash: "h", decidedBy: { name: "Nina" } }] },
    { _id: "u2", language: "es", sourceText: "Two", history: [{ _key: "c", status: "sent_back", decidedAt: "2026-09-02T00:00:00Z", sourceHash: "h", comment: "No" }] },
  ]);
  assert.deepEqual(rows.map((r) => [r.unitId, r.decision.status]), [["u1", "approved"], ["u2", "sent_back"], ["u1", "pending"]]);
});

test("the fetch client reads a job's author from the history endpoint", async () => {
  const { createSanityHttp } = await import("../dist/engine/index.js");
  const seen = [];
  const client = createSanityHttp({
    projectId: "p", dataset: "d", token: "t",
    fetch: async (url, init) => {
      seen.push([url, init?.headers?.Authorization]);
      return new Response('{"id":"tx1","timestamp":"2026-09-30T12:00:00Z","author":"pApprover1","documentIDs":["i18n.job.x"]}\n{"id":"tx2","author":"pOther"}\n', { status: 200 });
    },
  });
  assert.equal(await client.documentAuthor("i18n.job.x"), "pApprover1");
  assert.match(seen[0][0], /\/data\/history\/d\/transactions\/i18n\.job\.x\?excludeContent=true&limit=1$/);
  assert.equal(seen[0][1], "Bearer t");
  const empty = createSanityHttp({ projectId: "p", dataset: "d", token: "t", fetch: async () => new Response("", { status: 200 }) });
  assert.equal(await empty.documentAuthor("i18n.job.x"), null);
  const down = createSanityHttp({ projectId: "p", dataset: "d", token: "t", fetch: async () => new Response("", { status: 500 }) });
  await assert.rejects(down.documentAuthor("i18n.job.x"), /could not read or write/);
});
