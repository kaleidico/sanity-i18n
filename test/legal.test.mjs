import { test } from "node:test";
import assert from "node:assert/strict";
import { legalText, legalBlock, isLegal, collectLegalPaths, LEGAL_NOTE } from "../dist/sanity/index.js";

test("legalText marks a field and appends the note to its description", () => {
  const field = { name: "footerDisclaimer", type: "text", description: "Shown in the footer." };
  const marked = legalText(field);
  assert.deepEqual(marked.options, { i18n: { legal: true } });
  assert.equal(marked.description, `Shown in the footer. ${LEGAL_NOTE}`);
  assert.equal(LEGAL_NOTE, "(legal text: needs approval before it goes live in another language)");
  // Input untouched.
  assert.equal(field.options, undefined);
  assert.equal(field.description, "Shown in the footer.");
  assert.equal(isLegal(marked), true);
  assert.equal(isLegal(field), false);
  assert.equal(isLegal(null), false);
});

test("legalText keeps existing options and a missing description gets the note alone", () => {
  const marked = legalText({ name: "label", type: "string", options: { list: ["a"], i18n: { other: 1 } } });
  assert.deepEqual(marked.options, { list: ["a"], i18n: { other: 1, legal: true } });
  assert.equal(marked.description, LEGAL_NOTE);
});

test("legalBlock marks an object type the same way", () => {
  const block = legalBlock({ name: "disclosureBlock", type: "object", title: "Disclosure", fields: [{ name: "body", type: "text" }] });
  assert.equal(isLegal(block), true);
  assert.equal(block.description, LEGAL_NOTE);
});

test("collectLegalPaths walks fields, objects and arrays", () => {
  const consentField = {
    type: "object",
    name: "consentField",
    fields: [
      legalText({ name: "label", type: "string" }),
      { name: "required", type: "boolean" },
      legalText({ name: "consentText", type: "array", of: [{ type: "block" }] }),
    ],
  };
  const doc = {
    name: "settings",
    type: "document",
    fields: [
      { name: "siteName", type: "string" },
      legalText({ name: "footerDisclaimer", type: "text" }),
      {
        name: "contact",
        type: "object",
        fields: [{ name: "phone", type: "string" }, legalText({ name: "consentLine", type: "string" })],
      },
      {
        name: "legalLinks",
        type: "array",
        of: [{ type: "object", fields: [legalText({ name: "label", type: "string" }), { name: "href", type: "string" }] }],
      },
      { name: "fields", type: "array", of: [{ type: "object", name: "textField", fields: [{ name: "label", type: "string" }] }, consentField] },
      { name: "blocks", type: "array", of: [{ type: "heroBlock" }, { type: "disclosureBlock" }, { type: "calcBlock" }] },
    ],
  };
  const types = [
    { name: "heroBlock", type: "object", fields: [{ name: "heading", type: "string" }] },
    legalBlock({ name: "disclosureBlock", type: "object", fields: [{ name: "body", type: "text" }] }),
    { name: "calcBlock", type: "object", fields: [{ name: "heading", type: "string" }, legalText({ name: "disclaimer", type: "text" })] },
  ];

  assert.deepEqual(collectLegalPaths(doc, { types }), [
    "footerDisclaimer",
    "contact.consentLine",
    "legalLinks[].label",
    "fields[consentField].label",
    "fields[consentField].consentText",
    "blocks[disclosureBlock]",
    "blocks[calcBlock].disclaimer",
  ]);

  // Without the registry, named members cannot be inspected but inline ones still are.
  assert.deepEqual(collectLegalPaths(doc), [
    "footerDisclaimer",
    "contact.consentLine",
    "legalLinks[].label",
    "fields[consentField].label",
    "fields[consentField].consentText",
  ]);

  assert.deepEqual(collectLegalPaths({ name: "x", type: "document" }), []);
});

test("collectLegalPaths follows arrays inside array members, and a self-referring type once", () => {
  // A form block inside a page's blocks, with the consent field two arrays deep: what NOVA's page builder does.
  const consentField = { type: "object", name: "consentField", fields: [legalText({ name: "label", type: "string" }), legalText({ name: "consentText", type: "array", of: [{ type: "block" }] })] };
  const formBlock = { name: "formBlock", type: "object", fields: [{ name: "heading", type: "string" }, { name: "fields", type: "array", of: [{ type: "object", name: "textField", fields: [{ name: "label", type: "string" }] }, consentField] }] };
  const navItem = { name: "navItem", type: "object", fields: [legalText({ name: "label", type: "string" }), { name: "children", type: "array", of: [{ type: "navItem" }] }] };
  const doc = {
    name: "page",
    type: "document",
    fields: [
      { name: "blocks", type: "array", of: [{ type: "formBlock" }] },
      { name: "legalLinks", type: "array", of: [{ type: "object", fields: [legalText({ name: "label", type: "string" }), { name: "href", type: "string" }] }] },
      { name: "nav", type: "array", of: [{ type: "navItem" }] },
    ],
  };
  assert.deepEqual(collectLegalPaths(doc, { types: [formBlock, navItem] }), [
    "blocks[formBlock].fields[consentField].label",
    "blocks[formBlock].fields[consentField].consentText",
    "legalLinks[].label",
    "nav[navItem].label",
  ]);
});
