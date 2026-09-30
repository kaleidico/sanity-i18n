/**
 * Check 1, the exact-match check. A pure function over pairs of source and
 * translated text: every number, rate, percentage, dollar amount, NMLS
 * number, phone number, email address, URL, link target, pipe and
 * placeholder in the translation must equal the source.
 *
 * A value that differs is a failure and holds the document. A value that is
 * the same but written in another format (1,234.50 against 1.234,50, or a
 * phone number with different punctuation) is a warning: the site keeps the
 * US format, so a person should look, but nothing is wrong with the number.
 */
import type { UnitPair } from "./payload";

export type CheckCategory =
  | "number"
  | "percentage"
  | "currency"
  | "nmls"
  | "phone"
  | "email"
  | "url"
  | "href"
  | "pipe"
  | "placeholder"
  | "linebreak"
  | "order";

export interface CheckToken {
  category: Exclude<CheckCategory, "href" | "pipe" | "linebreak" | "order">;
  /** The token as written. */
  raw: string;
  /** The value read the US way (1,234.50). For exact categories, the raw text. */
  value: string;
  /** The value read the European way (1.234,50), when that reading is possible. */
  alt?: string;
  /** Position in the text, to compare order. */
  index: number;
}

export interface CheckFinding {
  path: string;
  category: CheckCategory;
  /** The value in the English, or "" when the translation has one the English does not. */
  source: string;
  /** The value in the translation, or "" when it is missing there. */
  translated: string;
  note: string;
}

export interface ExactMatchResult {
  passed: boolean;
  /** How many pairs of strings were compared. */
  checked: number;
  failures: CheckFinding[];
  warnings: CheckFinding[];
}

const URL = /(?:https?:\/\/|www\.)[^\s<>"'“”‘’]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PLACEHOLDER = /\{\{\s*[^{}]+?\s*\}\}|\{[A-Za-z_][\w.]*\}|%\d+\$[sd]|%[sd](?![A-Za-z])|\[\[[^[\]]+\]\]/g;
const NMLS = /NMLS(?:\s*(?:ID|No\.?|Number|N[úu]m\.?|N[úu]mero|n\.\s?º|#))?\s*[:#]?\s*#?\s*(\d(?:[\d-]*\d)?)/gi;
const PHONE = /(?<![\d.,])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d])/g;
const NUMBER_BODY = String.raw`\d(?:[\d.,]*\d)?`;
const CURRENCY = new RegExp(
  String.raw`(?:US\s?)?\$\s?${NUMBER_BODY}|${NUMBER_BODY}\s?(?:USD\b|US\$(?!\s?\d)|\$(?!\s?\d)|dollars?\b|d[óo]lares?\b)`,
  "gi",
);
const PERCENT = new RegExp(String.raw`${NUMBER_BODY}\s?(?:%|percent\b|por\s+ciento\b|pct\b)`, "gi");
const NUMBER = new RegExp(NUMBER_BODY, "g");
const NUMBER_IN = new RegExp(NUMBER_BODY);

const US_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const EU_NUMBER = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;

function canonical(plain: string): string {
  let [whole, fraction = ""] = plain.split(".");
  whole = whole.replace(/^0+(?=\d)/, "");
  fraction = fraction.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * The two ways a written number can be read. `us` treats the comma as the
 * thousands separator and the period as the decimal point; `eu` the other
 * way round. Either is null when the text cannot be read that way.
 */
export function readNumber(raw: string): { us: string | null; eu: string | null } {
  const us = US_NUMBER.test(raw) ? canonical(raw.replace(/,/g, "")) : null;
  const eu = EU_NUMBER.test(raw) ? canonical(raw.replace(/\./g, "").replace(",", ".")) : null;
  return { us, eu };
}

function numericToken(category: "number" | "percentage" | "currency", raw: string, index: number): CheckToken {
  const body = NUMBER_IN.exec(raw)?.[0] ?? raw;
  const { us, eu } = readNumber(body);
  const token: CheckToken = { category, raw: raw.trim(), value: us ?? eu ?? body, index };
  if (eu !== null && eu !== token.value) token.alt = eu;
  return token;
}

/** Every exact-match token in a string, in order of appearance. */
export function extractTokens(text: string): CheckToken[] {
  const tokens: CheckToken[] = [];
  let working = text;

  const take = (pattern: RegExp, make: (match: RegExpExecArray) => CheckToken | null) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    const found: { start: number; length: number }[] = [];
    while ((match = pattern.exec(working)) !== null) {
      if (match[0] === "") {
        pattern.lastIndex++;
        continue;
      }
      const token = make(match);
      if (token) {
        tokens.push(token);
        found.push({ start: match.index, length: token.raw.length });
        // A trimmed token (a URL without its closing full stop) leaves the rest for later patterns.
        pattern.lastIndex = match.index + Math.max(token.raw.length, 1);
      }
    }
    // Blank out what was taken so a later pattern cannot read it again.
    for (const { start, length } of found) {
      working = working.slice(0, start) + " ".repeat(length) + working.slice(start + length);
    }
  };

  take(URL, (m) => {
    const raw = m[0].replace(/[.,;:!?)\]}»]+$/, "");
    return { category: "url", raw, value: raw, index: m.index };
  });
  take(EMAIL, (m) => ({ category: "email", raw: m[0], value: m[0].toLowerCase(), index: m.index }));
  take(PLACEHOLDER, (m) => ({ category: "placeholder", raw: m[0], value: m[0].replace(/\s+/g, ""), index: m.index }));
  take(NMLS, (m) => ({ category: "nmls", raw: m[0], value: m[1].replace(/\D/g, ""), index: m.index }));
  take(PHONE, (m) => {
    const digits = m[0].replace(/\D/g, "");
    return { category: "phone", raw: m[0], value: digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits, index: m.index };
  });
  take(CURRENCY, (m) => numericToken("currency", m[0], m.index));
  take(PERCENT, (m) => numericToken("percentage", m[0], m.index));
  take(NUMBER, (m) => numericToken("number", m[0], m.index));

  return tokens.sort((a, b) => a.index - b.index);
}

function numericBody(raw: string): string {
  return NUMBER_IN.exec(raw)?.[0] ?? raw;
}

const LABEL: Record<CheckCategory, string> = {
  number: "number",
  percentage: "percentage",
  currency: "dollar amount",
  nmls: "NMLS number",
  phone: "phone number",
  email: "email address",
  url: "URL",
  href: "link target",
  pipe: "pipe character",
  placeholder: "placeholder",
  linebreak: "line break",
  order: "order of values",
};

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Compare one pair of strings. */
export function comparePair(pair: UnitPair): { failures: CheckFinding[]; warnings: CheckFinding[] } {
  const failures: CheckFinding[] = [];
  const warnings: CheckFinding[] = [];
  const finding = (category: CheckCategory, source: string, translated: string, note: string): CheckFinding => ({
    path: pair.path,
    category,
    source,
    translated,
    note,
  });

  const sourceTokens = extractTokens(pair.source);
  const targetTokens = extractTokens(pair.translated);
  const open = sourceTokens.map((token) => ({ token, used: false }));
  const leftover: CheckToken[] = [];
  const matchedOrder: { source: number; target: number }[] = [];

  targetTokens.forEach((target, targetIndex) => {
    const findSource = (value: string | undefined) =>
      value === undefined ? -1 : open.findIndex((s) => !s.used && s.token.category === target.category && s.token.value === value);

    let at = findSource(target.value);
    let reformatted = false;
    if (at === -1 && target.alt !== undefined) {
      at = findSource(target.alt);
      reformatted = at !== -1;
    }
    if (at === -1) {
      leftover.push(target);
      return;
    }

    const source = open[at].token;
    open[at].used = true;
    matchedOrder.push({ source: at, target: targetIndex });

    const numeric = target.category === "number" || target.category === "percentage" || target.category === "currency";
    if (numeric && (reformatted || numericBody(source.raw) !== numericBody(target.raw))) {
      warnings.push(
        finding(target.category, source.raw, target.raw, `Same ${LABEL[target.category]}, written in a different format. The site keeps the US format.`),
      );
    } else if (target.category === "phone" && source.raw.replace(/\s+/g, "") !== target.raw.replace(/\s+/g, "")) {
      warnings.push(finding("phone", source.raw, target.raw, "Same phone number, written with different punctuation."));
    } else if ((target.category === "url" || target.category === "email" || target.category === "placeholder") && source.raw !== target.raw) {
      warnings.push(finding(target.category, source.raw, target.raw, `Same ${LABEL[target.category]}, written with different capitals or spacing.`));
    }
  });

  // An NMLS number whose label was reworded ("N.º NMLS 3087") reads as a plain
  // number in the translation. The digits are what matter.
  for (const s of open) {
    if (s.used || s.token.category !== "nmls") continue;
    const at = leftover.findIndex((t) => t.category === "number" && t.raw.replace(/\D/g, "") === s.token.value);
    if (at !== -1) {
      s.used = true;
      warnings.push(finding("nmls", s.token.raw, leftover[at].raw, "Same NMLS number, with the label written differently."));
      leftover.splice(at, 1);
    }
  }

  const missing = open.filter((s) => !s.used).map((s) => s.token);
  for (const source of missing) {
    const at = leftover.findIndex((t) => t.category === source.category);
    if (at !== -1) {
      const target = leftover.splice(at, 1)[0];
      failures.push(finding(source.category, source.raw, target.raw, `The ${LABEL[source.category]} changed.`));
    } else {
      failures.push(finding(source.category, source.raw, "", `The ${LABEL[source.category]} is missing from the translation.`));
    }
  }
  for (const target of leftover) {
    failures.push(finding(target.category, "", target.raw, `The translation has a ${LABEL[target.category]} that is not in the English.`));
  }

  if (failures.length === 0) {
    const bySource = [...matchedOrder].sort((a, b) => a.target - b.target).map((m) => m.source);
    if (bySource.some((value, i) => i > 0 && value < bySource[i - 1])) {
      warnings.push(finding("order", "", "", "The values are all there but appear in a different order."));
    }
  }

  const sourcePipes = count(pair.source, "|");
  const targetPipes = count(pair.translated, "|");
  if (sourcePipes !== targetPipes) {
    failures.push(finding("pipe", String(sourcePipes), String(targetPipes), "The number of pipe characters changed."));
  }

  const sourceBreaks = count(pair.source, "\n");
  const targetBreaks = count(pair.translated, "\n");
  if (sourceBreaks !== targetBreaks) {
    warnings.push(finding("linebreak", String(sourceBreaks), String(targetBreaks), "The number of line breaks changed."));
  }

  if (pair.sourceHrefs || pair.translatedHrefs) {
    const a = pair.sourceHrefs ?? [];
    const b = pair.translatedHrefs ?? [];
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] !== b[i]) failures.push(finding("href", a[i] ?? "", b[i] ?? "", "A link target changed."));
    }
  }

  return { failures, warnings };
}

/** Check 1 over every pair. `passed` is false as soon as one value differs. */
export function checkExactMatch(pairs: readonly UnitPair[]): ExactMatchResult {
  const failures: CheckFinding[] = [];
  const warnings: CheckFinding[] = [];
  for (const pair of pairs) {
    const result = comparePair(pair);
    failures.push(...result.failures);
    warnings.push(...result.warnings);
  }
  return { passed: failures.length === 0, checked: pairs.length, failures, warnings };
}
