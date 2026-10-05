// Forms and consent: the localized form, the consent record, the dependency
// rule in publishTranslation, and the notice before an English-only application.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSchema, defineField, defineType } from "sanity";
import {
  localizeForm,
  formFieldName,
  portableTextToPlain,
  buildConsentRecords,
  consentText,
  submissionWebhookFields,
  consentWordingApproved,
  optionLabel,
  FORM_TEXT_SETTINGS,
  resolveApplyNotice,
  matchesApplyHost,
  hostMatches,
  linkHost,
  normaliseHostPatterns,
  applyNoticeHideCss,
  APPLY_NOTICE_FIELD,
} from "../dist/next/index.js";
import {
  buildFieldManifest,
  publishTranslation,
  loadDependencies,
  collectReferences,
  planDependencies,
  dependencyReasons,
  legalApprovalId,
  legalSourceHash,
  legalUnitsOf,
  runJob,
  encryptSecret,
  publicKeyFingerprint,
} from "../dist/engine/index.js";
import { applyNoticeField, translatable, legalText, noTranslate, collectLegalPaths, isLegal } from "../dist/sanity/index.js";
import { createFakeAnthropic, memorySanity } from "./helpers/fake.mjs";
import { execFileSync } from "node:child_process";

const languages = [{ id: "es", title: "Spanish", nativeTitle: "Español" }];
const NOW = "2026-10-05T12:00:00.000Z";

// ── A small site: a form type the way the Kaleidico boilerplate has it, and a page that embeds one ──

const optionsField = defineField({
  name: "options",
  type: "array",
  of: [{ type: "object", fields: [defineField({ name: "label", type: "string" }), noTranslate(defineField({ name: "value", type: "string" }))] }],
});
const common = [defineField({ name: "label", type: "string" }), noTranslate(defineField({ name: "name", type: "string" })), defineField({ name: "placeholder", type: "string" }), defineField({ name: "helpText", type: "string" }), defineField({ name: "required", type: "boolean" })];
const formType = translatable(
  defineType({
    name: "form",
    type: "document",
    fields: [
      defineField({ name: "title", type: "string" }),
      defineField({ name: "slug", type: "slug" }),
      defineField({
        name: "fields",
        type: "array",
        of: [
          { type: "object", name: "textField", fields: [...common] },
          { type: "object", name: "selectField", fields: [...common, optionsField] },
          {
            type: "object",
            name: "consentField",
            fields: [
              legalText(defineField({ name: "label", type: "string" })),
              noTranslate(defineField({ name: "name", type: "string" })),
              defineField({ name: "required", type: "boolean" }),
              legalText(defineField({ name: "consentText", type: "array", of: [{ type: "block" }] })),
              noTranslate(defineField({ name: "conditionalField", type: "string" })),
              defineField({ name: "conditionalOperator", type: "string", options: { list: ["equals", "not_equals"] } }),
              noTranslate(defineField({ name: "conditionalValue", type: "string" })),
            ],
          },
        ],
      }),
      defineField({
        name: "settings",
        type: "object",
        fields: [
          defineField({ name: "stepMode", type: "string", options: { list: ["manual", "auto"] } }),
          defineField({ name: "submitButtonText", type: "string" }),
          defineField({ name: "successMessage", type: "text" }),
          defineField({ name: "redirectUrl", type: "string" }),
          noTranslate(defineField({ name: "cookieName", type: "string" })),
        ],
      }),
      defineField({ name: "notifications", type: "object", fields: [defineField({ name: "recipients", type: "array", of: [{ type: "string" }] })] }),
    ],
  }),
  { languages, sharedFields: ["notifications"] },
);
const formEmbed = defineType({ name: "formEmbed", type: "object", fields: [defineField({ name: "heading", type: "string" }), defineField({ name: "form", type: "reference", to: [{ type: "form" }] })] });
const pageType = translatable(
  defineType({
    name: "page",
    type: "document",
    fields: [defineField({ name: "title", type: "string" }), defineField({ name: "slug", type: "slug" }), defineField({ name: "related", type: "reference", to: [{ type: "page" }] }), defineField({ name: "blocks", type: "array", of: [{ type: "formEmbed" }] })],
  }),
  { languages },
);
const settingsType = translatable(
  defineType({ name: "settings", type: "document", groups: [{ name: "languages", title: "Languages" }], fields: [defineField({ name: "siteName", type: "string" }), applyNoticeField({ defaultAppliesTo: ["applynow.example.com"] })] }),
  { languages },
);
const schema = createSchema({ name: "forms", types: [formEmbed, formType, pageType, settingsType] });
const manifest = buildFieldManifest(schema, ["form", "page", "settings"]);

const block = (key, text) => ({ _key: key, _type: "block", style: "normal", markDefs: [], children: [{ _key: `${key}s`, _type: "span", marks: [], text }] });
const CONSENT_EN = "I agree that NOVA Home Loans may contact me by call or text. Consent is not required.";
const CONSENT_ES = "Acepto que NOVA Home Loans se comunique conmigo por llamada o mensaje de texto. El consentimiento no es obligatorio.";
const CONSENT_UNIT = legalApprovalId("es", legalSourceHash(CONSENT_EN));

const englishForm = () => ({
  _id: "form-test",
  _type: "form",
  _rev: "rev-en-1",
  title: "Test form",
  slug: { _type: "slug", current: "test-form" },
  fields: [
    { _key: "f1", _type: "textField", label: "First Name", placeholder: "Your first name", required: true },
    {
      _key: "f2",
      _type: "selectField",
      label: "Loan purpose",
      name: "loan_purpose",
      options: [
        { _key: "o1", label: "Buy a home", value: "purchase" },
        { _key: "o2", label: "Refinance", value: "refinance" },
      ],
    },
    { _key: "f3", _type: "consentField", label: "I agree", name: "consent", required: true, consentText: [block("c1", CONSENT_EN)] },
  ],
  settings: { stepMode: "manual", submitButtonText: "Send", successMessage: "Thank you.", redirectUrl: "/thank-you", cookieName: "form_test" },
  notifications: { recipients: ["staff@example.com"] },
});

const spanishForm = (extra = {}) => ({
  _id: "form-test-es",
  _type: "form",
  _rev: "rev-es-7",
  language: "es",
  title: "Formulario de prueba",
  slug: { _type: "slug", current: "formulario-de-prueba" },
  fields: [
    // A careless edit: the Spanish document changed a machine value and a name. Neither may reach the page.
    { _key: "f1", _type: "textField", label: "Nombre", name: "nombre", placeholder: "Su nombre", required: false },
    {
      _key: "f2",
      _type: "selectField",
      label: "Propósito del préstamo",
      name: "loan_purpose",
      options: [
        { _key: "o1", label: "Comprar una casa", value: "comprar" },
        { _key: "o2", label: "Refinanciar", value: "refinance" },
      ],
    },
    { _key: "f3", _type: "consentField", label: "Acepto", name: "consent", required: true, consentText: [block("c1", CONSENT_ES)] },
  ],
  settings: { stepMode: "auto", submitButtonText: "Enviar", successMessage: "Gracias.", redirectUrl: "/otro", cookieName: "otra" },
  i18n: {
    source: { _type: "reference", _ref: "form-test", _weak: true },
    status: "approved",
    legal: {
      pending: 0,
      approved: 2,
      paths: [
        { _key: "p1", path: 'fields[_key=="f3"].label', unitId: legalApprovalId("es", legalSourceHash("I agree")), sourceHash: legalSourceHash("I agree"), status: "approved" },
        { _key: "p2", path: 'fields[_key=="f3"].consentText[_key=="c1"]', unitId: CONSENT_UNIT, sourceHash: legalSourceHash(CONSENT_EN), status: "approved" },
      ],
    },
  },
  ...extra,
});

// ── The localized form ───────────────────────────────────────────────────

test("the consent wording and the consent label are legal units on a form", () => {
  const units = legalUnitsOf(englishForm(), manifest);
  assert.deepEqual(units.map((u) => u.path), ['fields[_key=="f3"].label', 'fields[_key=="f3"].consentText[_key=="c1"]']);
});

test("a visitor reads the translation's labels while every machine value stays the default language's", () => {
  const form = localizeForm(englishForm(), spanishForm());
  const [first, purpose, consent] = form.fields;
  assert.equal(form.title, "Formulario de prueba");

  // Words come from the translation.
  assert.deepEqual([first.label, first.placeholder], ["Nombre", "Su nombre"]);
  assert.equal(purpose.label, "Propósito del préstamo");
  assert.deepEqual(purpose.options.map((o) => o.label), ["Comprar una casa", "Refinanciar"]);
  assert.equal(portableTextToPlain(consent.consentText), CONSENT_ES);

  // Machine values come from the default-language form, whatever the translation holds.
  assert.equal(first.name, "first_name", "a name made from the English label stays the English one");
  assert.equal(first.required, true);
  assert.deepEqual(purpose.options.map((o) => o.value), ["purchase", "refinance"], "option values are never the translation's");
  assert.equal(purpose.name, "loan_purpose");

  // What is submitted for the Spanish label is the English value, and it reads back in either language.
  assert.equal(optionLabel(purpose, "purchase"), "Comprar una casa");
  assert.equal(optionLabel(englishForm().fields[1], "purchase"), "Buy a home");
  assert.equal(optionLabel(purpose, "unknown"), "unknown");
});

test("settings: the text keys come from the translation, behaviour from the default language", () => {
  assert.deepEqual([...FORM_TEXT_SETTINGS], ["submitButtonText", "nextButtonText", "backButtonText", "successMessage"]);
  const form = localizeForm(englishForm(), spanishForm());
  assert.deepEqual(form.settings, { stepMode: "manual", submitButtonText: "Enviar", successMessage: "Gracias.", redirectUrl: "/thank-you", cookieName: "form_test" });
  assert.deepEqual(form.notifications, { recipients: ["staff@example.com"] });

  // A text key the translation leaves empty falls back to the default language.
  const partial = spanishForm();
  partial.settings.successMessage = "  ";
  delete partial.fields[0].placeholder;
  const fallback = localizeForm(englishForm(), partial);
  assert.equal(fallback.settings.successMessage, "Thank you.");
  assert.equal(fallback.fields[0].placeholder, "Your first name");
});

test("the form records which document and revision the visitor saw, and where to submit", () => {
  assert.deepEqual(localizeForm(englishForm(), spanishForm()).i18nForm, { language: "es", documentId: "form-test-es", revision: "rev-es-7", sourceId: "form-test", sourceSlug: "test-form" });
  const english = localizeForm(englishForm());
  assert.deepEqual(english.i18nForm, { language: "en", documentId: "form-test", revision: "rev-en-1", sourceId: "form-test", sourceSlug: "test-form" });
  assert.deepEqual(english.fields.map((f) => f.label), ["First Name", "Loan purpose", "I agree"], "with no translation the form is the default-language form");
  assert.equal(formFieldName({ label: "ZIP Code!" }), "zip_code_");
  assert.equal(formFieldName({ _key: "k9" }), "field_k9");
});

test("options match by position when a hand-made translation lost its keys", () => {
  const spanish = spanishForm();
  spanish.fields[1].options = [{ label: "Comprar", value: "x" }, { label: "Refi", value: "y" }];
  const form = localizeForm(englishForm(), spanish);
  assert.deepEqual(form.fields[1].options.map((o) => [o.label, o.value]), [["Comprar", "purchase"], ["Refi", "refinance"]]);
});

// ── The consent record ───────────────────────────────────────────────────

test("the consent record carries the wording as shown, from the revision shown, with the approval that covers it", () => {
  const data = { first_name: "Ana", loan_purpose: "purchase", consent: true };
  const records = buildConsentRecords({ shown: spanishForm(), source: englishForm(), data, language: "es" });
  assert.deepEqual(records, [{ field: "consent", checked: true, textAsShown: CONSENT_ES, language: "es", legalApprovalId: CONSENT_UNIT, legalApprovalIds: [CONSENT_UNIT] }]);
  assert.match(CONSENT_UNIT, /^i18n-legal-es-[0-9a-f]{12}$/);

  // An older revision of the Spanish form had other wording: the record follows the revision that was loaded.
  const older = spanishForm({ _rev: "rev-es-3" });
  older.fields[2].consentText = [block("c1", "Redacción anterior aprobada.")];
  assert.equal(buildConsentRecords({ shown: older, source: englishForm(), data, language: "es" })[0].textAsShown, "Redacción anterior aprobada.");

  // English: the English wording, and no approval id.
  const english = buildConsentRecords({ shown: englishForm(), source: englishForm(), data: { consent: false }, language: "en" });
  assert.deepEqual(english, [{ field: "consent", checked: false, textAsShown: CONSENT_EN, language: "en", legalApprovalId: null, legalApprovalIds: [] }]);
});

test("consent text of several paragraphs lists every approval; a label-only consent uses the label's approval", () => {
  const source = englishForm();
  source.fields[2].consentText.push(block("c2", "Message and data rates may apply."));
  const shown = spanishForm();
  shown.fields[2].consentText.push(block("c2", "Pueden aplicarse tarifas de mensajes y datos."));
  const second = legalApprovalId("es", legalSourceHash("Message and data rates may apply."));
  shown.i18n.legal.paths.push({ _key: "p3", path: 'fields[_key=="f3"].consentText[_key=="c2"]', unitId: second, sourceHash: "x", status: "approved" });
  const [record] = buildConsentRecords({ shown, source, data: { consent: "true" }, language: "es" });
  assert.equal(record.textAsShown, `${CONSENT_ES}\n\nPueden aplicarse tarifas de mensajes y datos.`);
  assert.deepEqual(record.legalApprovalIds, [CONSENT_UNIT, second]);
  assert.equal(record.checked, true);

  const labelOnlySource = englishForm();
  delete labelOnlySource.fields[2].consentText;
  const labelOnlyShown = spanishForm();
  delete labelOnlyShown.fields[2].consentText;
  const [label] = buildConsentRecords({ shown: labelOnlyShown, source: labelOnlySource, data: {}, language: "es" });
  assert.deepEqual([label.textAsShown, label.legalApprovalId], ["Acepto", legalApprovalId("es", legalSourceHash("I agree"))]);
});

test("a translation with no legal record falls back to the id the registry gives the English wording; hidden consents are left out", () => {
  const shown = spanishForm();
  delete shown.i18n.legal;
  assert.equal(buildConsentRecords({ shown, source: englishForm(), data: {}, language: "es" })[0].legalApprovalId, CONSENT_UNIT);
  assert.equal(consentWordingApproved(shown), false);
  assert.equal(consentWordingApproved(spanishForm()), true);
  const pending = spanishForm();
  pending.i18n.legal.paths[1].status = "pending";
  assert.equal(consentWordingApproved(pending), false);

  const conditional = englishForm();
  Object.assign(conditional.fields[2], { conditionalField: "loan_purpose", conditionalOperator: "equals", conditionalValue: "refinance" });
  assert.deepEqual(buildConsentRecords({ shown: spanishForm(), source: conditional, data: { loan_purpose: "purchase" }, language: "es" }), []);
  assert.equal(buildConsentRecords({ shown: spanishForm(), source: conditional, data: { loan_purpose: "refinance" }, language: "es" }).length, 1);
});

test("the webhook additions are two new keys and nothing else", () => {
  const records = buildConsentRecords({ shown: spanishForm(), source: englishForm(), data: { consent: true }, language: "es" });
  assert.deepEqual(submissionWebhookFields("es", records), { language: "es", consent_text: CONSENT_ES });
  assert.deepEqual(submissionWebhookFields("en", []), { language: "en", consent_text: "" });
  assert.equal(consentText([...records, { ...records[0], textAsShown: "Otra." }]), `${CONSENT_ES}\n\nOtra.`);
});

// ── Dependencies and the publish rule ────────────────────────────────────

const ref = (id) => ({ _type: "reference", _ref: id });
const pageDraft = (extra = {}) => ({
  _id: "drafts.page-contact-es",
  _type: "page",
  language: "es",
  title: "Contacto",
  slug: { _type: "slug", current: "contacto" },
  related: ref("page-about"),
  blocks: [{ _key: "b1", _type: "formEmbed", heading: "Escríbanos", form: ref("form-test") }],
  i18n: { source: { _type: "reference", _ref: "page-contact", _weak: true }, status: "approved", legal: { pending: 0, approved: 0, paths: [] }, report: { held: false } },
  ...extra,
});
const aboutPage = { _id: "page-about", _type: "page", title: "About" };

test("references are collected without the link to the source", () => {
  assert.deepEqual(collectReferences(pageDraft()), ["page-about", "form-test"]);
  assert.deepEqual(collectReferences({ a: [{ _ref: "drafts.x" }, { _ref: "x" }], image: { asset: { _ref: "image-abc" } } }), ["x", "image-abc"]);
});

test("a page that embeds a form lists it as a blocking dependency until the form is approved and live in that language", async () => {
  const sanity = memorySanity([pageDraft(), englishForm(), aboutPage]);
  const missing = await loadDependencies(sanity, pageDraft(), "es", manifest);
  assert.deepEqual(missing.map((d) => [d.id, d.type, d.translationId, d.status, d.blocking]), [
    ["page-about", "page", "page-about-es", "missing", false],
    ["form-test", "form", "form-test-es", "missing", true],
  ]);
  assert.match(dependencyReasons(missing)[0], /embeds the form form-test, which has no translation yet/);

  // A draft of the Spanish form does not count: only the published translation does.
  sanity.store.set("drafts.form-test-es", { ...spanishForm(), _id: "drafts.form-test-es" });
  const draftOnly = await loadDependencies(sanity, pageDraft(), "es", manifest);
  assert.deepEqual([draftOnly[1].status, draftOnly[1].blocking], ["unpublished", true]);
  assert.match(dependencyReasons(draftOnly)[0], /translation is still a draft/);

  // Published but not approved: still blocking, with its status in the reason.
  const waiting = spanishForm();
  waiting.i18n.status = "awaiting_approval";
  sanity.store.set("form-test-es", waiting);
  const held = await loadDependencies(sanity, pageDraft(), "es", manifest);
  assert.deepEqual([held[1].status, held[1].blocking], ["awaiting_approval", true]);
  assert.match(dependencyReasons(held)[0], /not approved and live yet \(awaiting approval\)/);

  sanity.store.set("form-test-es", spanishForm());
  const ok = await loadDependencies(sanity, pageDraft(), "es", manifest);
  assert.deepEqual([ok[1].status, ok[1].blocking], ["approved", false]);
  assert.deepEqual(dependencyReasons(ok), []);
});

test("publishTranslation refuses a page whose embedded form has no approved translation, with a plain reason, then publishes once it has", async () => {
  const sanity = memorySanity([pageDraft(), englishForm(), aboutPage]);
  const refused = await publishTranslation(sanity, "drafts.page-contact-es", { manifest });
  assert.equal(refused.published, false);
  assert.equal(refused.reason, "It embeds the form form-test, which has no translation yet. Translate and approve that form first.");
  assert.equal(sanity.store.has("page-contact-es"), false, "nothing was published");
  assert.equal(refused.dependencies.find((d) => d.type === "form").blocking, true);

  sanity.store.set("form-test-es", spanishForm());
  const published = await publishTranslation(sanity, "drafts.page-contact-es", { manifest });
  assert.equal(published.published, true);
  assert.ok(sanity.store.has("page-contact-es"));
  assert.equal(sanity.store.has("drafts.page-contact-es"), false);

  // The rule can be switched off, and another type can be added to it.
  const open = memorySanity([pageDraft(), englishForm(), aboutPage]);
  assert.equal((await publishTranslation(open, "drafts.page-contact-es", { manifest, requiredDependencyTypes: [] })).published, true);
  const strict = memorySanity([pageDraft(), englishForm(), aboutPage, spanishForm()]);
  assert.match((await publishTranslation(strict, "drafts.page-contact-es", { manifest, requiredDependencyTypes: ["form", "page"] })).reason, /embeds the page page-about/);
});

test("publishing the form publishes the approved page that was only waiting for it", async () => {
  const formDraft = { ...spanishForm(), _id: "drafts.form-test-es" };
  const entries = formDraft.i18n.legal.paths.map((p, i) => ({ _id: p.unitId, _type: "i18n.legalApproval", language: "es", status: "approved", translatedText: i === 0 ? "Acepto" : CONSENT_ES }));
  const sanity = memorySanity([pageDraft(), englishForm(), aboutPage, formDraft, ...entries]);
  assert.equal((await publishTranslation(sanity, "drafts.page-contact-es", { manifest })).published, false);

  const result = await publishTranslation(sanity, "drafts.form-test-es", { manifest, publishDependents: true });
  assert.equal(result.published, true, result.reason);
  assert.deepEqual(result.dependentsPublished, ["page-contact-es"]);
  assert.ok(sanity.store.has("page-contact-es"));

  // Without the option the page stays an approved draft for a person to publish.
  const manual = memorySanity([pageDraft(), englishForm(), aboutPage, formDraft, ...entries]);
  assert.deepEqual((await publishTranslation(manual, "drafts.form-test-es", { manifest })).dependentsPublished, []);
  assert.equal(manual.store.has("page-contact-es"), false);
});

test("a translation run reports its dependencies and does not auto-publish a page ahead of its form", async () => {
  const keyLines = execFileSync("node", [new URL("../scripts/generate-keys.mjs", import.meta.url).pathname], { encoding: "utf8" }).trim().split("\n");
  const publicKey = keyLines[0].slice("NEXT_PUBLIC_I18N_PUBLIC_KEY=".length);
  const privateKey = keyLines[1].slice("I18N_PRIVATE_KEY=".length);
  const secrets = { _id: "i18n.secrets", _type: "i18n.secrets", anthropicKey: { ciphertext: await encryptSecret(publicKey, "sk-test-0000-not-a-real-key-wxyz"), last4: "wxyz", savedAt: NOW, keyFingerprint: await publicKeyFingerprint(publicKey) } };
  const page = { _id: "page-contact", _type: "page", title: "Contact", slug: { _type: "slug", current: "contact" }, blocks: [{ _key: "b1", _type: "formEmbed", heading: "Write to us", form: ref("form-test") }] };
  const settings = { _id: "settings", _type: "settings", siteName: "NOVA", languages: { en: true, es: true } };
  const job = { _id: "i18n.job.00000001-2222-3333-4444-555555555555", _type: "i18n.job", kind: "translate", sourceId: "page-contact", sourceType: "page", language: "es", mode: "full", status: "pending", createdAt: NOW };
  const sanity = memorySanity([page, englishForm(), settings, secrets, job]);
  const config = { sanity, languages, privateKey, publicKey, manifest, anthropic: () => createFakeAnthropic(), retry: { sleep: async () => {}, random: () => 0 }, now: () => new Date(NOW) };
  const outcome = await runJob(config, job._id);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const report = sanity.store.get(job._id).report;
  assert.equal(report.status, "approved", "no legal text on the page itself");
  assert.equal(report.published, false, "but it waits for its form");
  assert.match(report.publishNote, /embeds the form form-test/);
  assert.deepEqual(report.dependencies.map((d) => [d.id, d.status, d.blocking]), [["form-test", "missing", true]]);
  assert.ok(sanity.store.has("drafts.page-contact-es"));
  assert.equal(sanity.store.has("page-contact-es"), false);
  assert.deepEqual(sanity.store.get("drafts.page-contact-es").i18n.report.dependencies.map((d) => d._key), ["d0"]);
});

// ── The notice before an English-only application ────────────────────────

test("the settings field: switch and hosts are never translated, the body is legal text", () => {
  const field = applyNoticeField({ defaultAppliesTo: ["applynow.example.com"] });
  assert.equal(field.name, APPLY_NOTICE_FIELD);
  assert.equal(field.group, "languages");
  const byName = Object.fromEntries(field.fields.map((f) => [f.name, f]));
  assert.deepEqual(Object.keys(byName), ["enabled", "appliesTo", "title", "body", "continueLabel", "cancelLabel"]);
  assert.equal(byName.enabled.options.i18n.translate, false);
  assert.equal(byName.appliesTo.options.i18n.translate, false);
  assert.deepEqual(byName.appliesTo.initialValue, ["applynow.example.com"]);
  assert.equal(isLegal(byName.body), true);
  assert.equal(isLegal(byName.title), false);
  assert.deepEqual(collectLegalPaths(settingsType), ["i18nApplyNotice.body"]);
  const units = legalUnitsOf({ _type: "settings", i18nApplyNotice: { enabled: true, appliesTo: ["a.example.com"], title: "Before you continue", body: "The application is in English." } }, manifest);
  assert.deepEqual(units.map((u) => u.path), ["i18nApplyNotice.body"]);
});

test("matching a link's host", () => {
  const hosts = ["applynow.novahomeloans.com"];
  assert.equal(matchesApplyHost("https://applynow.novahomeloans.com/homehub/signup/x?from_mobile_share=true", hosts), true);
  assert.equal(matchesApplyHost("http://APPLYNOW.novahomeloans.com", hosts), true);
  assert.equal(matchesApplyHost("//applynow.novahomeloans.com/x", hosts), true);
  assert.equal(matchesApplyHost("https://applynow.novahomeloans.com:8443/x", hosts), true);
  assert.equal(matchesApplyHost("https://www.novahomeloans.com/apply", hosts), false);
  assert.equal(matchesApplyHost("https://evil.example/applynow.novahomeloans.com", hosts), false, "the host is compared, not the text");
  assert.equal(matchesApplyHost("https://applynow.novahomeloans.com.evil.example/", hosts), false);
  assert.equal(matchesApplyHost("/apply", hosts), false, "a relative link is the site's own");
  assert.equal(matchesApplyHost("/apply", ["www.site.test"], "https://www.site.test/es"), true, "unless a base is given and the site itself is listed");
  assert.equal(matchesApplyHost("mailto:info@applynow.novahomeloans.com", hosts), false);
  assert.equal(matchesApplyHost("tel:+15205551234", hosts), false);
  assert.equal(matchesApplyHost("", hosts), false);
  assert.equal(matchesApplyHost(null, hosts), false);

  assert.equal(hostMatches("a.b.example.com", "*.example.com"), true);
  assert.equal(hostMatches("example.com", "*.example.com"), false);
  assert.equal(hostMatches("notexample.com", "*.example.com"), false);
  assert.equal(linkHost("https://Apply.Example.com/x"), "apply.example.com");
  assert.deepEqual(normaliseHostPatterns([" https://ApplyNow.novahomeloans.com/homehub ", "applynow.novahomeloans.com", "", "*.ncino.example:443", 7]), ["applynow.novahomeloans.com", "*.ncino.example"]);
});

const BODY_EN = "Our online application is available in English only.";
const BODY_ES = "Nuestra solicitud en línea está disponible solo en inglés.";
const BODY_UNIT = legalApprovalId("es", legalSourceHash(BODY_EN));
const baseNotice = { enabled: true, appliesTo: ["applynow.novahomeloans.com"], title: "Before you continue", body: BODY_EN, continueLabel: "Continue", cancelLabel: "Cancel" };
const localSettings = (extra = {}) => ({
  _id: "settings-es",
  _type: "settings",
  language: "es",
  i18nApplyNotice: { title: "Antes de continuar", body: BODY_ES, continueLabel: "Continuar", cancelLabel: "Cancelar" },
  i18n: { status: "approved", legal: { pending: 0, approved: 1, paths: [{ _key: "p", path: "i18nApplyNotice.body", unitId: BODY_UNIT, sourceHash: legalSourceHash(BODY_EN), status: "approved" }] } },
  ...extra,
});
const approved = { [BODY_UNIT]: { status: "approved", translatedText: BODY_ES } };

test("gating: an approved notice is active on a translated page, with the translated words", () => {
  const result = resolveApplyNotice({ lang: "es", base: baseNotice, local: localSettings(), approvals: approved });
  assert.equal(result.state, "active");
  assert.deepEqual(result.hosts, ["applynow.novahomeloans.com"]);
  assert.deepEqual(result.notice, { title: "Antes de continuar", body: BODY_ES, continueLabel: "Continuar", cancelLabel: "Cancelar" });
  assert.equal(resolveApplyNotice({ lang: "es", base: baseNotice, local: localSettings(), approvals: new Map(Object.entries(approved)) }).state, "active", "a Map of approvals works too");
});

test("gating: default-language pages never show it, and a notice switched off leaves links alone everywhere", () => {
  assert.deepEqual(resolveApplyNotice({ lang: "en", base: baseNotice, local: localSettings(), approvals: approved }).state, "off");
  assert.equal(resolveApplyNotice({ lang: "es", base: { ...baseNotice, enabled: false }, local: null }).state, "off");
  assert.equal(resolveApplyNotice({ lang: "es", base: { enabled: true }, local: null }).state, "off", "no host, nothing to guard");
});

test("gating: switched on without approved wording in that language, the links are hidden", () => {
  const blocked = (input, pattern) => {
    const result = resolveApplyNotice({ lang: "es", base: baseNotice, approvals: approved, ...input });
    assert.equal(result.state, "blocked");
    assert.equal(result.notice, undefined, "no wording leaves the server unapproved");
    assert.deepEqual(result.hosts, ["applynow.novahomeloans.com"]);
    assert.match(result.reason, pattern);
  };
  blocked({ local: null }, /no approved Site Settings translation/);
  blocked({ local: localSettings({ i18n: { ...localSettings().i18n, status: "awaiting_approval" } }) }, /not approved/);
  blocked({ local: localSettings({ i18nApplyNotice: { title: "x", body: " ", continueLabel: "x", cancelLabel: "x" } }) }, /no wording/);
  const pending = localSettings();
  pending.i18n.legal.paths[0].status = "pending";
  blocked({ local: pending }, /has not been approved/);
  blocked({ local: localSettings({ i18n: { status: "approved" } }) }, /has not been approved/);
  blocked({ local: localSettings(), approvals: {} }, /missing or no longer stands/);
  blocked({ local: localSettings(), approvals: { [BODY_UNIT]: { status: "superseded", translatedText: BODY_ES } } }, /missing or no longer stands/);
  blocked({ local: localSettings(), approvals: { [BODY_UNIT]: { status: "approved", translatedText: "Otra redacción." } } }, /differs from the approved wording/);
  blocked({ local: localSettings({ i18nApplyNotice: { body: BODY_ES } }) }, /missing its title or a button label/);

  // Undefined `enabled` counts as on: an unset switch must not open the door.
  const unset = resolveApplyNotice({ lang: "es", base: {}, local: null, defaultAppliesTo: ["applynow.novahomeloans.com"] });
  assert.deepEqual([unset.state, unset.hosts], ["blocked", ["applynow.novahomeloans.com"]]);
});

test("the hide rule for the blocked state", () => {
  const css = applyNoticeHideCss(["applynow.novahomeloans.com"]);
  assert.match(css, /a\[href\^="https:\/\/applynow\.novahomeloans\.com\/" i\]/);
  assert.match(css, /a\[href="https:\/\/applynow\.novahomeloans\.com" i\]/);
  assert.match(css, /\{display:none!important\}$/);
  assert.equal(applyNoticeHideCss([]), "");
  assert.equal(applyNoticeHideCss(['x"]{}body{display:none}']), "", "a pattern that is not a host name never reaches the stylesheet");
  assert.match(applyNoticeHideCss(["*.example.com"]), /a\[href\*="\.example\.com" i\]/);
});

test("the client bundle carries the notice and the matcher, and nothing of the engine", () => {
  const client = readFileSync(new URL("../dist/next/client/index.js", import.meta.url), "utf8");
  assert.ok(client.startsWith('"use client"'), "the directive survives the build");
  assert.match(client, /role: "dialog"|role:"dialog"/);
  assert.match(client, /aria-modal/);
  assert.match(client, /Escape/);
  assert.equal(/sha256|legalApproval|anthropic/i.test(client), false, "no registry, hashing or engine code in the browser bundle");
});
