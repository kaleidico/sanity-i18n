import { test } from "node:test";
import assert from "node:assert/strict";
import { checkExactMatch, comparePair, extractTokens, readNumber } from "../dist/engine/index.js";

const pair = (source, translated, extra = {}) => ({ path: "field", source, translated, ...extra });
const run = (source, translated, extra) => comparePair(pair(source, translated, extra));
const passes = (source, translated) => {
  const r = run(source, translated);
  assert.deepEqual(r.failures, [], `${source} => ${translated}`);
  return r;
};
const fails = (source, translated, category) => {
  const r = run(source, translated);
  assert.ok(r.failures.length > 0, `expected a failure: ${source} => ${translated}`);
  if (category) assert.ok(r.failures.some((f) => f.category === category), `expected ${category}, got ${r.failures.map((f) => f.category)}`);
  return r;
};

test("01 numbers that stay the same pass", () => {
  assert.deepEqual(run("A 30-year loan with 3 options", "Un préstamo a 30 años con 3 opciones"), { failures: [], warnings: [] });
});

test("02 a changed number fails and names both values", () => {
  const r = fails("Terms up to 30 years", "Plazos de hasta 35 años", "number");
  assert.deepEqual(r.failures[0], { path: "field", category: "number", source: "30", translated: "35", note: "The number changed." });
});

test("03 a missing number fails", () => {
  const r = fails("Call within 10 days", "Llame pronto", "number");
  assert.equal(r.failures[0].translated, "");
});

test("04 an added number fails", () => {
  const r = fails("Call us today", "Llámenos en 24 horas", "number");
  assert.equal(r.failures[0].source, "");
});

test("05 a number spelled out in the translation fails", () => {
  fails("Choose from 3 programs", "Elija entre tres programas", "number");
});

test("06 thousands and decimal separators swapped is the same value: warning, not failure", () => {
  const r = passes("A balance of 1,234.50 remains", "Queda un saldo de 1.234,50");
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].category, "number");
  assert.match(r.warnings[0].note, /different format/);
});

test("07 a large number with both separators swapped is a warning", () => {
  assert.equal(passes("1,234,567.89 total", "1.234.567,89 en total").warnings.length, 1);
});

test("08 a thousands separator dropped is a warning", () => {
  assert.equal(passes("Over 12,000 families", "Más de 12000 familias").warnings[0].category, "number");
});

test("09 percentages: same value passes, with or without a space", () => {
  assert.deepEqual(run("Rates from 6.5%", "Tasas desde 6.5%"), { failures: [], warnings: [] });
  assert.deepEqual(run("Rates from 6.5%", "Tasas desde 6.5 %"), { failures: [], warnings: [] });
});

test("10 a changed percentage fails", () => {
  const r = fails("Rates from 6.5%", "Tasas desde 6.8%", "percentage");
  assert.equal(r.failures[0].source, "6.5%");
  assert.equal(r.failures[0].translated, "6.8%");
});

test("11 a three-decimal rate with a comma is the same rate, flagged for format", () => {
  const r = passes("An APR of 6.125%", "Una APR de 6,125%");
  assert.equal(r.warnings[0].category, "percentage");
});

test("12 percent written as a word matches the sign", () => {
  assert.deepEqual(run("Put 20 percent down", "Dé un 20 por ciento de pago inicial").failures, []);
  assert.deepEqual(run("Put 20 percent down", "Dé un 20% de pago inicial").failures, []);
});

test("13 a percentage that loses its sign fails", () => {
  fails("Up to 97% loan-to-value", "Hasta 97 de préstamo a valor", "percentage");
});

test("14 dollar amounts: same passes, format change warns, value change fails", () => {
  assert.deepEqual(run("The limit is $845,000", "El límite es $845,000"), { failures: [], warnings: [] });
  assert.equal(passes("The limit is $845,000", "El límite es $845.000").warnings[0].category, "currency");
  assert.equal(fails("The limit is $845,000", "El límite es $854,000", "currency").failures[0].translated, "$854,000");
});

test("15 dollars as a word match the sign, a bare number does not", () => {
  assert.deepEqual(run("A $500 credit", "Un crédito de 500 dólares").failures, []);
  assert.deepEqual(run("A credit of 500 dollars", "Un crédito de $500").failures, []);
  fails("A $500 credit", "Un crédito de 500", "currency");
});

test("16 NMLS numbers: same digits pass in any label form, changed digits fail", () => {
  assert.deepEqual(run("NOVA Home Loans NMLS 3087", "NOVA Home Loans NMLS 3087"), { failures: [], warnings: [] });
  assert.deepEqual(run("NMLS #3087", "NMLS n.º 3087").failures, []);
  assert.deepEqual(run("NMLS ID 3087", "N.º NMLS: 3087").failures, []);
  const reworded = passes("NMLS 3087", "Licencia 3087 del NMLS");
  assert.equal(reworded.warnings[0].category, "nmls");
  fails("NMLS 3087", "NMLS 3078", "nmls");
});

test("17 phone numbers: same passes, punctuation change warns, digit change fails", () => {
  assert.deepEqual(run("Call (866) 866-0653 today", "Llame hoy al (866) 866-0653"), { failures: [], warnings: [] });
  assert.equal(passes("Call (866) 866-0653", "Llame al 866-866-0653").warnings[0].category, "phone");
  fails("Call (866) 866-0653", "Llame al (866) 866-0563", "phone");
  assert.deepEqual(extractTokens("800.955.9125").map((t) => [t.category, t.value]), [["phone", "8009559125"]]);
  assert.deepEqual(extractTokens("+1 866-866-0653").map((t) => [t.category, t.value]), [["phone", "8668660653"]]);
});

test("18 email addresses must stay the same", () => {
  assert.deepEqual(run("Write to help@novahomeloans.com", "Escriba a help@novahomeloans.com"), { failures: [], warnings: [] });
  fails("Write to help@novahomeloans.com", "Escriba a ayuda@novahomeloans.com", "email");
  assert.equal(passes("Write to Help@Example.com", "Escriba a help@example.com").warnings[0].category, "email");
});

test("19 URLs must stay the same, and a sentence's full stop is not part of one", () => {
  assert.deepEqual(run("See https://www.novahomeloans.com/rates.", "Vea https://www.novahomeloans.com/rates."), { failures: [], warnings: [] });
  fails("See https://www.novahomeloans.com/rates", "Vea https://www.novahomeloans.com/tasas", "url");
  assert.deepEqual(extractTokens("Go to www.example.com/a-1, then call.").map((t) => [t.category, t.raw]), [["url", "www.example.com/a-1"]]);
});

test("20 digits inside a URL or an email are not counted twice", () => {
  assert.deepEqual(extractTokens("https://example.com/2026/page-3 and a1@b2.com").map((t) => t.category), ["url", "email"]);
});

test("21 pipes must be kept", () => {
  assert.deepEqual(run("Conventional Loans | NOVA Home Loans", "Préstamos convencionales | NOVA Home Loans"), { failures: [], warnings: [] });
  const r = fails("Tucson, AZ | Jan. 2026", "Tucson, AZ, ene. 2026", "pipe");
  assert.deepEqual([r.failures[0].source, r.failures[0].translated], ["1", "0"]);
});

test("22 placeholder tokens must be kept exactly", () => {
  assert.deepEqual(run("Hello {{name}}, {minutes} min read, %s left", "Hola {{name}}, {minutes} min de lectura, quedan %s"), { failures: [], warnings: [] });
  fails("Hello {{name}}", "Hola {{nombre}}", "placeholder");
  fails("{minutes} min read", "min de lectura", "placeholder");
});

test("23 a changed number of line breaks is a warning", () => {
  const r = passes("Line one\nLine two", "Línea uno Línea dos");
  assert.deepEqual(r.warnings.map((w) => w.category), ["linebreak"]);
});

test("24 the same values in a different order pass with a warning", () => {
  const r = passes("From 3% down on a 30-year loan", "En un préstamo a 30 años, desde 3% de pago inicial");
  assert.deepEqual(r.warnings.map((w) => w.category), ["order"]);
});

test("25 a date written the other way round has the same figures", () => {
  const r = passes("Offer ends 12/31/2026", "La oferta termina el 31/12/2026");
  assert.deepEqual(r.warnings.map((w) => w.category), ["order"]);
});

test("26 link targets of a Portable Text block must not change", () => {
  const same = run("See rates", "Vea las tasas", { sourceHrefs: ["https://a.example/rates"], translatedHrefs: ["https://a.example/rates"] });
  assert.deepEqual(same.failures, []);
  const changed = run("See rates", "Vea las tasas", { sourceHrefs: ["https://a.example/rates"], translatedHrefs: ["https://a.example/tasas"] });
  assert.deepEqual(changed.failures.map((f) => [f.category, f.source, f.translated]), [["href", "https://a.example/rates", "https://a.example/tasas"]]);
  const dropped = run("See rates", "Vea las tasas", { sourceHrefs: ["https://a.example/rates"], translatedHrefs: [] });
  assert.equal(dropped.failures[0].category, "href");
});

test("27 ranges, ordinals, 401(k), 24/7 and leading zeros", () => {
  assert.deepEqual(run("Rates of 3.5%-4.5% for ZIP 08540", "Tasas de 3.5%-4.5% para el código postal 08540"), { failures: [], warnings: [] });
  assert.deepEqual(run("Your 401(k), available 24/7", "Su 401(k), disponible 24/7"), { failures: [], warnings: [] });
  assert.deepEqual(run("Your 1st home", "Su 1.ª casa").failures, []);
  assert.deepEqual(run("$500-$1,000 in fees", "$500-$1,000 en cargos"), { failures: [], warnings: [] });
});

test("28 text with no exact values at all passes clean", () => {
  assert.deepEqual(run("Home starts here.", "El hogar empieza aquí."), { failures: [], warnings: [] });
  assert.deepEqual(run("", ""), { failures: [], warnings: [] });
});

test("29 readNumber gives both readings of a written number", () => {
  assert.deepEqual(readNumber("1,234.50"), { us: "1234.5", eu: null });
  assert.deepEqual(readNumber("1.234,50"), { us: null, eu: "1234.5" });
  assert.deepEqual(readNumber("6.125"), { us: "6.125", eu: "6125" });
  assert.deepEqual(readNumber("6,125"), { us: "6125", eu: "6.125" });
  assert.deepEqual(readNumber("30"), { us: "30", eu: "30" });
  assert.deepEqual(readNumber("007"), { us: "7", eu: "7" });
  assert.deepEqual(readNumber("1.2.3"), { us: null, eu: null });
});

test("30 a real disclosure line is read into the right categories", () => {
  const text = "NOVA Financial & Investment Corporation, DBA NOVA Home Loans NMLS 3087 • 800.955.9125 • rates from 6.5% on loans up to $845,000 • www.nmlsconsumeraccess.org • since 1980";
  assert.deepEqual(extractTokens(text).map((t) => [t.category, t.value]), [
    ["nmls", "3087"],
    ["phone", "8009559125"],
    ["percentage", "6.5"],
    ["currency", "845000"],
    ["url", "www.nmlsconsumeraccess.org"],
    ["number", "1980"],
  ]);
});

test("31 checkExactMatch passes only when no pair has a failure, and keeps the path", () => {
  const ok = checkExactMatch([pair("Up to 97%", "Hasta 97%"), pair("Call now", "Llame ahora")]);
  assert.deepEqual(ok, { passed: true, checked: 2, failures: [], warnings: [] });
  const held = checkExactMatch([pair("Up to 97%", "Hasta 97%"), { path: 'blocks[_key=="k21"].items[_key=="f4"].answer', source: "$845,000, however", translated: "$854,000, sin embargo" }]);
  assert.equal(held.passed, false);
  assert.equal(held.failures[0].path, 'blocks[_key=="k21"].items[_key=="f4"].answer');
  assert.equal(held.checked, 2);
});
