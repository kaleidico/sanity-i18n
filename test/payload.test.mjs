import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFieldManifest,
  extractUnits,
  buildPayload,
  validateStructure,
  applyUnits,
  readUnit,
  unitPairs,
  unitStrings,
  unitCharacters,
  isTranslatableValue,
  sourceHashes,
  sourceFingerprint,
  diffSource,
  getAtPath,
  parsePath,
  pathToString,
  setAtPath,
  STRUCTURE_HASH_PATH,
} from "../dist/engine/index.js";
import { schema, sourcePage } from "./helpers/fixtures.mjs";
import { mapText } from "./helpers/fake.mjs";

const manifest = buildFieldManifest(schema, ["page", "settings"]);
const clone = (v) => JSON.parse(JSON.stringify(v));

test("paths round-trip and read and write by key", () => {
  const segments = ["blocks", { _key: "k02" }, "content", { _key: "p2" }];
  const path = pathToString(segments);
  assert.equal(path, 'blocks[_key=="k02"].content[_key=="p2"]');
  assert.deepEqual(parsePath(path), segments);
  assert.deepEqual(parsePath("tags[2].label"), ["tags", 2, "label"]);
  const doc = sourcePage();
  assert.equal(getAtPath(doc, parsePath('blocks[_key=="k01"].headline')), "Conventional Loans");
  assert.equal(getAtPath(doc, parsePath('blocks[_key=="nope"].headline')), undefined);
  assert.equal(setAtPath(doc, parsePath('blocks[_key=="k01"].headline'), "Hola"), true);
  assert.equal(doc.blocks[0].headline, "Hola");
  assert.equal(setAtPath(doc, parsePath('blocks[_key=="nope"].headline'), "x"), false);
});

test("isTranslatableValue keeps copy and drops URLs, paths, emails and bare numbers", () => {
  for (const v of ["Get pre-approved", "Up to 97%", "No Minimum", "a"]) assert.equal(isTranslatableValue(v), true, v);
  for (const v of ["", "  ", "620", "6.5%", "$845,000", "/loan-options", "https://example.com/a", "www.example.com", "hello@example.com", "#top", "tel:+18668660653", 5, null]) {
    assert.equal(isTranslatableValue(v), false, String(v));
  }
});

test("extractUnits finds every translatable unit of a realistic nested page, in document order", () => {
  const units = extractUnits(sourcePage(), manifest);
  assert.deepEqual(
    units.map((u) => `${u.kind} ${u.path}`),
    [
      "text title",
      'text blocks[_key=="k01"].headline',
      'text blocks[_key=="k01"].subheadline',
      'text blocks[_key=="k01"].ctaLabel',
      'text blocks[_key=="k01"].image.alt',
      'text blocks[_key=="k01"].breadcrumbs[_key=="b1"].name',
      'text blocks[_key=="k01"].breadcrumbs[_key=="b2"].name',
      'block blocks[_key=="k02"].content[_key=="p1"]',
      'block blocks[_key=="k02"].content[_key=="p2"]',
      'text blocks[_key=="k02"].content[_key=="i1"].alt',
      'text blocks[_key=="k02"].content[_key=="i1"].caption',
      'text blocks[_key=="k03"].heading',
      'list blocks[_key=="k03"].points',
      'text blocks[_key=="k03"].disclaimer',
      "text seo.metaTitle",
      "text seo.metaDescription",
    ],
  );
  assert.deepEqual(units.filter((u) => u.legal).map((u) => u.path), ['blocks[_key=="k03"].disclaimer']);
  assert.equal(units.find((u) => u.path === "title").piece, "title");
  assert.equal(units.find((u) => u.path.endsWith("p2\"]")).piece, 'blocks[_key=="k02"]');
  assert.equal(unitStrings(units), 21);
  assert.ok(unitCharacters(units) > 300);
});

test("the payload keeps structure and leaves out shared fields, references, images, slugs and non-text values", () => {
  const doc = sourcePage();
  const units = extractUnits(doc, manifest);
  const payload = buildPayload(doc, units);
  const flat = JSON.stringify(payload);

  assert.deepEqual(Object.keys(payload), ["title", "blocks", "seo"]);
  for (const absent of ["nmls", "photo", "slug", "_ref", "asset", "ctaHref", "apply.example.com", "variant", "dark", "defaultRate", "fieldName", "loan_amount", "canonicalUrl", "noIndex", "/loan-options", "_id", "_rev"]) {
    assert.equal(flat.includes(absent), false, `${absent} must not be in the payload`);
  }
  assert.deepEqual(payload.blocks.map((b) => [b._key, b._type]), [["k01", "heroBlock"], ["k02", "richTextBlock"], ["k03", "calculatorBlock"]]);
  assert.deepEqual(payload.blocks[0].image, { _type: "image", alt: "A family at home" });
  assert.deepEqual(payload.blocks[0].breadcrumbs, [
    { _key: "b1", _type: "breadcrumb", name: "Loan Options" },
    { _key: "b2", _type: "breadcrumb", name: "Conventional Loans" },
  ]);
  // Portable Text keeps keys, marks and mark definitions exactly.
  const p2 = payload.blocks[1].content[1];
  assert.deepEqual(p2.markDefs, [{ _key: "m1", _type: "link", href: "https://www.example.com/rates" }]);
  assert.deepEqual(p2.children.map((c) => [c._key, c.marks]), [["s1", []], ["s2", ["strong"]], ["s3", []], ["s4", ["m1"]], ["s5", []]]);
  assert.deepEqual(payload.blocks[1].content[2], { _key: "i1", _type: "image", alt: "A rate chart", caption: "Rates over 2026" });
  assert.deepEqual(payload.blocks[2].points, ["Principal and interest", "Taxes and insurance"]);
  // The source document is not changed by building a payload.
  assert.deepEqual(doc, sourcePage());
});

test("a payload for some units only still carries the keys above them", () => {
  const doc = sourcePage();
  const units = extractUnits(doc, manifest).filter((u) => u.path.includes("p2") || u.path === "seo.metaTitle");
  assert.deepEqual(buildPayload(doc, units), {
    blocks: [{ _key: "k02", _type: "richTextBlock", content: [units[0].value] }],
    seo: { metaTitle: "Conventional Loans | NOVA Home Loans" },
  });
});

test("validateStructure accepts a translation that changes only text", () => {
  const doc = sourcePage();
  const payload = buildPayload(doc, extractUnits(doc, manifest));
  assert.deepEqual(validateStructure(payload, mapText(payload, (s) => `[es] ${s}`)), []);
});

test("validateStructure reports every kind of structural change", () => {
  const doc = sourcePage();
  const payload = buildPayload(doc, extractUnits(doc, manifest));
  const broken = (mutate) => {
    const copy = mapText(clone(payload), (s) => `[es] ${s}`);
    mutate(copy);
    return validateStructure(payload, copy);
  };

  assert.match(broken((p) => delete p.title)[0], /"title" is missing/);
  assert.match(broken((p) => (p.extra = "x"))[0], /"extra" was added/);
  assert.match(broken((p) => (p.blocks[0]._key = "zzz"))[0], /_key must stay "k01"/);
  assert.match(broken((p) => (p.blocks[0]._type = "other"))[0], /_type must stay "heroBlock"/);
  assert.match(broken((p) => p.blocks.pop())[0], /expected 3 item\(s\), got 2/);
  assert.match(broken((p) => (p.blocks[0].headline = ""))[0], /the translation is empty/);
  assert.match(broken((p) => (p.blocks[0].headline = 5))[0], /expected text/);
  assert.match(broken((p) => p.blocks[2].points.push("extra"))[0], /expected 2 item\(s\), got 3/);
  assert.match(broken((p) => p.blocks[1].content[1].children.pop())[0], /expected 5 span\(s\), got 4/);
  assert.match(broken((p) => (p.blocks[1].content[1].children[1].marks = []))[0], /marks must not change/);
  assert.match(broken((p) => (p.blocks[1].content[1].markDefs[0].href = "https://evil.example"))[0], /markDefs must not change/);
  assert.match(broken((p) => (p.blocks[1].content[0].style = "h3"))[0], /style must not change/);
  assert.match(broken((p) => (p.blocks[1].content[1].children[0]._key = "s9"))[0], /_key must not change/);
  assert.match(validateStructure(payload, null)[0], /expected an object/);
  assert.match(validateStructure(payload, "text")[0], /expected an object/);
});

test("applyUnits writes translations back without touching anything else, and keeps span edge spaces", () => {
  const doc = sourcePage();
  const units = extractUnits(doc, manifest);
  const translated = mapText(buildPayload(doc, units), (s) => `ES:${s.trim()}`);
  const target = clone(doc);
  const missing = applyUnits(target, units.map((unit) => ({ unit, value: readUnit(translated, unit) })));
  assert.deepEqual(missing, []);

  assert.equal(target.title, "ES:Conventional Loans");
  assert.equal(target.blocks[0].ctaHref, "https://apply.example.com/start");
  assert.equal(target.blocks[0].variant, "dark");
  assert.deepEqual(target.blocks[0].image.asset, doc.blocks[0].image.asset);
  assert.deepEqual(target.blocks[2].points, ["ES:Principal and interest", "ES:Taxes and insurance"]);
  assert.equal(target.blocks[2].defaultRate, 6.5);
  assert.deepEqual(target.blocks[2].form, { _type: "reference", _ref: "form-lead" });
  assert.equal(target.nmls, "3087");
  // "A 30-year fixed loan at " ends with a space in the source, " is common. See " starts and ends with one.
  const spans = target.blocks[1].content[1].children.map((c) => c.text);
  assert.deepEqual(spans, ["ES:A 30-year fixed loan at ", "ES:6.5%", " ES:is common. See ", "ES:today's rates", "ES:."]);
  assert.deepEqual(target.blocks[1].content[1].markDefs, doc.blocks[1].content[1].markDefs);

  // Same structure as the source everywhere.
  const shape = (v) => (Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
  assert.deepEqual(shape(target), shape(doc));
});

test("unitPairs gives plain text pairs, with link targets for a block", () => {
  const doc = sourcePage();
  const units = extractUnits(doc, manifest);
  const block = units.find((u) => u.path.endsWith('p2"]'));
  assert.deepEqual(unitPairs(block, block.value), [
    {
      path: block.path,
      source: "A 30-year fixed loan at 6.5% is common. See today's rates.",
      translated: "A 30-year fixed loan at 6.5% is common. See today's rates.",
      sourceHrefs: ["https://www.example.com/rates"],
      translatedHrefs: ["https://www.example.com/rates"],
    },
  ]);
  const list = units.find((u) => u.kind === "list");
  assert.deepEqual(unitPairs(list, ["a", "b"]).map((p) => p.path), [`${list.path}[0]`, `${list.path}[1]`]);
});

test("sourceHashes stores one hash per unit plus one for the structure", () => {
  const doc = sourcePage();
  const units = extractUnits(doc, manifest);
  const hashes = sourceHashes(doc, manifest);
  assert.equal(hashes.length, units.length + 1);
  assert.equal(hashes.at(-1).path, STRUCTURE_HASH_PATH);
  assert.ok(hashes.every((h) => /^[0-9a-f]{64}$/.test(h.hash) && typeof h._key === "string" && h._key.length > 0));
  assert.equal(new Set(hashes.map((h) => h._key)).size, hashes.length);
  assert.match(sourceFingerprint(hashes), /^[0-9a-f]{64}$/);
  assert.deepEqual(sourceHashes(sourcePage(), manifest), hashes);
});

test("diffSource reports changed, added and removed units and structure changes", () => {
  const source = sourcePage();
  const translation = { _id: "page-conventional-loans-es", _type: "page", language: "es", i18n: { sourceHashes: sourceHashes(source, manifest) } };

  assert.deepEqual(diffSource(source, translation, manifest), { changed: [], added: [], removed: [], structureChanged: false, upToDate: true });

  const edited = sourcePage();
  edited.blocks[0].headline = "Conventional Home Loans";
  edited.blocks[1].content[1].children[1].text = "6.75%";
  edited.blocks[0].breadcrumbs.push({ _key: "b3", _type: "breadcrumb", name: "Rates" });
  edited.blocks[2].points = ["Principal and interest"];
  delete edited.blocks[1].content[2].caption;
  const diff = diffSource(edited, translation, manifest);
  assert.deepEqual(diff.changed, ['blocks[_key=="k01"].headline', 'blocks[_key=="k02"].content[_key=="p2"]', 'blocks[_key=="k03"].points']);
  assert.deepEqual(diff.added, ['blocks[_key=="k01"].breadcrumbs[_key=="b3"].name']);
  assert.deepEqual(diff.removed, ['blocks[_key=="k02"].content[_key=="i1"].caption']);
  assert.equal(diff.structureChanged, true);
  assert.equal(diff.upToDate, false);

  // A change to something that is not text: no unit changes, the structure does.
  const restyled = sourcePage();
  restyled.blocks[0].variant = "light";
  restyled.blocks[0].ctaHref = "https://apply.example.com/other";
  assert.deepEqual(diffSource(restyled, translation, manifest), { changed: [], added: [], removed: [], structureChanged: true, upToDate: false });

  // Reordering blocks changes no unit, because paths follow keys.
  const reordered = sourcePage();
  reordered.blocks.reverse();
  const moved = diffSource(reordered, translation, manifest);
  assert.deepEqual([moved.changed, moved.added, moved.removed], [[], [], []]);
  assert.equal(moved.structureChanged, true);

  // Shared fields, the slug and system fields are not part of any hash.
  const untouched = sourcePage();
  untouched.nmls = "9999";
  untouched.slug.current = "other";
  untouched._rev = "rev2";
  assert.equal(diffSource(untouched, translation, manifest).upToDate, true);

  // A translation made by hand has no hashes: everything counts as new.
  const manual = diffSource(source, { i18n: {} }, manifest);
  assert.equal(manual.added.length, extractUnits(source, manifest).length);
  assert.equal(manual.upToDate, false);
});
