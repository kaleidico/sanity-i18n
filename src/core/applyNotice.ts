/**
 * The notice shown before a visitor on a translated page follows a link to
 * something that only exists in the default language, such as an online loan
 * application. Pure functions, no Sanity and no Next.js import.
 *
 * The rule, in one place:
 *
 * - On a default-language page nothing happens: no dialog, links untouched.
 * - On any other language's page, a link whose host is on the `appliesTo`
 *   list opens the notice first, but only when the notice is switched on and
 *   its body in that language is approved legal text.
 * - When the notice is switched on and there is no approved body in that
 *   language, those links are hidden on that language's pages. Sending a
 *   visitor to a default-language application with no notice is the one thing
 *   this exists to prevent, so the safe state is no link at all.
 * - When the notice is switched off, links are left alone in every language.
 */
import { normaliseHostPatterns, type ApplyNoticeState, type ApplyNoticeText } from "./hosts";
import { normaliseLegalText } from "./legal";

export { normaliseHostPatterns, linkHost, hostMatches, matchesApplyHost, type ApplyNoticeState, type ApplyNoticeText } from "./hosts";
import { I18N_FIELD } from "./translations";

type Json = Record<string, unknown>;

export const APPLY_NOTICE_FIELD = "i18nApplyNotice";

/** The notice as stored in Site Settings. */
export interface ApplyNoticeValue {
  enabled?: boolean | null;
  appliesTo?: string[] | null;
  title?: string | null;
  body?: string | null;
  continueLabel?: string | null;
  cancelLabel?: string | null;
}

export interface ResolvedApplyNotice {
  state: ApplyNoticeState;
  /** The host patterns the rule applies to, lower case. Empty when `off`. */
  hosts: string[];
  /** The words to show. Only when `active`. */
  notice?: ApplyNoticeText;
  /** Why, in plain words, for logs and the Studio. */
  reason: string;
}

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export interface ResolveApplyNoticeInput {
  /** The language of the page. */
  lang: string;
  defaultId?: string;
  /** The notice on the default-language settings document: the switch and the host list are read from here. */
  base: ApplyNoticeValue | null | undefined;
  /**
   * The published, approved settings document in the page's language (with
   * its `i18n` record), or null when there is none. The wording is read from
   * here and nowhere else.
   */
  local: Json | null | undefined;
  /** The registry entries for the ids on `local.i18n.legal.paths`, by id. */
  approvals?: ReadonlyMap<string, { status?: string; translatedText?: string }> | Record<string, { status?: string; translatedText?: string }>;
  /** Hosts used when the settings list none. */
  defaultAppliesTo?: readonly string[];
  fieldName?: string;
}

function approvalOf(approvals: ResolveApplyNoticeInput["approvals"], id: string): { status?: string; translatedText?: string } | undefined {
  if (!approvals) return undefined;
  return approvals instanceof Map ? approvals.get(id) : (approvals as Record<string, { status?: string; translatedText?: string }>)[id];
}

/**
 * Decide what a page in `lang` does about links to the default-language
 * application. See the rule at the top of this file. The body counts as
 * approved only when the settings document in that language is itself
 * approved, its legal record lists the body as approved, and the registry
 * entry it points at is approved with the same words.
 */
export function resolveApplyNotice(input: ResolveApplyNoticeInput): ResolvedApplyNotice {
  const defaultId = input.defaultId ?? "en";
  const fieldName = input.fieldName ?? APPLY_NOTICE_FIELD;
  if (input.lang === defaultId) return { state: "off", hosts: [], reason: "Default-language pages never show the notice." };

  const base = input.base ?? {};
  if (base.enabled === false) return { state: "off", hosts: [], reason: "The notice is switched off in Site Settings." };
  const listed = normaliseHostPatterns(base.appliesTo);
  const hosts = listed.length > 0 ? listed : normaliseHostPatterns(input.defaultAppliesTo);
  if (hosts.length === 0) return { state: "off", hosts: [], reason: "The notice applies to no host." };

  const blocked = (reason: string): ResolvedApplyNotice => ({ state: "blocked", hosts, reason });
  const local = input.local;
  if (!isObject(local)) return blocked("There is no approved Site Settings translation in this language.");
  const i18n = isObject(local[I18N_FIELD]) ? (local[I18N_FIELD] as Json) : {};
  if (i18n.status !== "approved") return blocked("The Site Settings translation in this language is not approved.");

  const value = isObject(local[fieldName]) ? (local[fieldName] as ApplyNoticeValue) : {};
  const body = text(value.body);
  if (body === "") return blocked("The notice has no wording in this language.");

  const legal = isObject(i18n.legal) ? (i18n.legal as Json) : {};
  const paths = Array.isArray(legal.paths) ? (legal.paths as Json[]) : [];
  const record = paths.find((p) => p.path === `${fieldName}.body`);
  if (!record || record.status !== "approved") return blocked("The notice wording in this language has not been approved.");
  const entry = approvalOf(input.approvals, String(record.unitId ?? ""));
  if (!entry || entry.status !== "approved") return blocked("The approval for the notice wording in this language is missing or no longer stands.");
  if (normaliseLegalText(text(entry.translatedText)) !== normaliseLegalText(body)) return blocked("The notice wording in this language differs from the approved wording.");

  const title = text(value.title);
  const continueLabel = text(value.continueLabel);
  const cancelLabel = text(value.cancelLabel);
  if (title === "" || continueLabel === "" || cancelLabel === "") return blocked("The notice is missing its title or a button label in this language.");
  return { state: "active", hosts, notice: { title, body, continueLabel, cancelLabel }, reason: "The notice wording in this language is approved." };
}

/**
 * CSS that hides every link to the listed hosts, for the `blocked` state. It
 * works before any script runs and for links rendered later. A `*.` pattern
 * is matched on the part after the star, which is as close as an attribute
 * selector gets.
 */
export function applyNoticeHideCss(hosts: readonly string[]): string {
  const selectors: string[] = [];
  for (const pattern of normaliseHostPatterns(hosts)) {
    if (!/^[a-z0-9.*-]+$/.test(pattern)) continue;
    if (pattern.startsWith("*.")) {
      const tail = pattern.slice(1);
      selectors.push(`a[href*="${tail}" i]`);
    } else {
      for (const scheme of ["https://", "http://", "//"]) {
        selectors.push(`a[href^="${scheme}${pattern}/" i]`, `a[href="${scheme}${pattern}" i]`, `a[href^="${scheme}${pattern}?" i]`, `a[href^="${scheme}${pattern}#" i]`, `a[href^="${scheme}${pattern}:" i]`);
      }
    }
  }
  return selectors.length > 0 ? `${selectors.join(",")}{display:none!important}` : "";
}
