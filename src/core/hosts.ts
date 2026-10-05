/**
 * Matching a link against a list of host patterns, and the two small types
 * the client-side notice needs. No imports, so the browser bundle that
 * carries the notice carries nothing else.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The words of the dialog, in the page's language. */
export interface ApplyNoticeText {
  title: string;
  body: string;
  continueLabel: string;
  cancelLabel: string;
}

/**
 * `off`: do nothing. `active`: intercept matching links and show the notice.
 * `blocked`: hide matching links, because the notice is on and has no
 * approved wording in this language.
 */
export type ApplyNoticeState = "off" | "active" | "blocked";

/** Host patterns, tidied: lower case, scheme, path and port dropped, blanks and duplicates removed. */
export function normaliseHostPatterns(patterns: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of patterns ?? []) {
    let host = text(raw).toLowerCase();
    if (host === "") continue;
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\/\//, "");
    host = host.split(/[/?#]/)[0].replace(/:\d+$/, "");
    if (host !== "" && !out.includes(host)) out.push(host);
  }
  return out;
}

/** The host of a link, lower case, or null for a relative link, a fragment, `mailto:`, `tel:` and anything else that is not http(s). */
export function linkHost(href: string | null | undefined, base?: string): string | null {
  const value = text(href);
  if (value === "") return null;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
  if (!absolute && !base) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when a host matches a pattern: the same host, or under it when the pattern starts with `*.`. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

/**
 * True when a link goes to one of the hosts the notice applies to. A relative
 * link is the site's own and never matches (pass `base` to resolve it first
 * when the site's own host is on the list).
 */
export function matchesApplyHost(href: string | null | undefined, patterns: readonly string[], base?: string): boolean {
  const host = linkHost(href, base);
  if (!host) return false;
  return patterns.some((pattern) => hostMatches(host, pattern));
}

