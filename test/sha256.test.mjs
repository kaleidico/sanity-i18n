import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex, stableStringify } from "../dist/engine/index.js";

const reference = (s) => createHash("sha256").update(s, "utf8").digest("hex");

test("sha256Hex matches node:crypto for ASCII, Unicode and every padding boundary", () => {
  const inputs = ["", "abc", "Préstamos convencionales ñ", "日本語", "😀 emoji", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "x".repeat(1000), JSON.stringify({ a: [1, 2, { b: "c" }] })];
  for (const input of inputs) assert.equal(sha256Hex(input), reference(input), `length ${input.length}`);
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("stableStringify sorts keys so equal values hash the same", () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  assert.equal(stableStringify({ a: undefined, b: null }), '{"b":null}');
  assert.equal(sha256Hex(stableStringify({ x: 1, y: 2 })), sha256Hex(stableStringify({ y: 2, x: 1 })));
});
