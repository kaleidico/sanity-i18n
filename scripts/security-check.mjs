#!/usr/bin/env node
/**
 * Scans the built package for anything that looks like a leaked key or a
 * log line that would print one. Runs on every release (`npm run check`,
 * also wired into `prepack`) and fails the build when it finds something.
 *
 * Patterns:
 * - Anthropic style keys (`sk-ant-`), and generic long `sk-` secrets
 * - a literal `apiKey` assignment with a string value
 * - `console.log(` on a line that also mentions a key, token or secret
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const distDir = join(root, "dist");

const RULES = [
  { name: "Anthropic key", pattern: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: "secret key literal", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "apiKey literal", pattern: /apiKey\s*[:=]\s*["'`][^"'`]{8,}["'`]/ },
  {
    name: "console.log of a key",
    pattern: /console\.log\([^\n]*\b(key|token|secret|password)\b/i,
  },
];

function walk(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(walk(full));
    else if (/\.(m?js|d\.ts|json)$/.test(entry)) files.push(full);
  }
  return files;
}

let files;
try {
  files = walk(distDir);
} catch {
  console.error("security-check: dist/ not found. Run `npm run build` first.");
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ file: relative(root, file), line: i + 1, rule: rule.name });
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`security-check: ${findings.length} finding(s) in dist/`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}`);
  process.exit(1);
}

console.log(`security-check: ${files.length} file(s) in dist/ scanned, nothing found.`);
