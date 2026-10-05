/**
 * Forms in another language. Pure functions over plain JSON, with no Sanity
 * and no Next.js import, shared by the page that renders a form and the route
 * that receives it.
 *
 * The model: a form in another language is the linked translation of the
 * default-language form document. The translation carries the words a
 * visitor reads (labels, placeholders, help text, option labels, headings,
 * consent wording, button texts, the success message). Everything a machine
 * reads (field names, option values, conditions, routing, where a submission
 * goes) is the default-language form's, always.
 *
 * `localizeForm()` builds the form a page renders from the two documents, so
 * a visitor reads one language while the submission carries the same keys and
 * values as a submission made in the default language.
 */
import { legalApprovalId, legalSourceHash, normaliseLegalText } from "./legal";
import { I18N_FIELD, LANGUAGE_FIELD } from "./translations";

type Json = Record<string, unknown>;

/** The `settings` keys of a form that are words a visitor reads. Everything else in `settings` is behaviour and comes from the default-language form. */
export const FORM_TEXT_SETTINGS = ["submitButtonText", "nextButtonText", "backButtonText", "successMessage"] as const;

/** The keys of a form field that are words a visitor reads. */
export const FORM_FIELD_TEXT_KEYS = ["label", "placeholder", "helpText", "tooltip", "heading", "description", "stepLabel", "consentText", "content"] as const;

/** Field types that hold consent wording. */
export const CONSENT_FIELD_TYPE = "consentField";

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * The key a field's value is submitted under: its `name`, or one made from
 * its label, or one made from its `_key`. The same rule the form renderer has
 * always used; kept here so the page and the route agree.
 */
export function formFieldName(field: Json): string {
  const name = typeof field.name === "string" ? field.name.trim() : "";
  if (name !== "") return name;
  const label = typeof field.label === "string" ? field.label.toLowerCase().replace(/[^a-z0-9]+/g, "_") : "";
  return label !== "" ? label : `field_${String(field._key ?? "")}`;
}

/** The readable text of a Portable Text value (or a plain string): blocks joined by a blank line, spans joined as they are. */
export function portableTextToPlain(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  const blocks: string[] = [];
  for (const block of value) {
    if (!isObject(block)) continue;
    const children = Array.isArray(block.children) ? block.children : [];
    const text = children.map((child) => (isObject(child) && typeof child.text === "string" ? child.text : "")).join("");
    if (text.trim() !== "") blocks.push(text.trim());
  }
  return blocks.join("\n\n");
}

export interface LocalizeFormOptions {
  /** The `settings` keys read from the translation. Defaults to `FORM_TEXT_SETTINGS`. */
  textSettings?: readonly string[];
  /** The field keys read from the translation. Defaults to `FORM_FIELD_TEXT_KEYS`. */
  textKeys?: readonly string[];
  /** The default language id. Defaults to `en`. */
  defaultId?: string;
}

/** What `localizeForm()` adds to the form it returns, for the renderer and the submit route. */
export interface LocalizedFormMeta {
  /** The language the visitor reads. */
  language: string;
  /** The document the visitor actually saw: the translation, or the default-language form. */
  documentId: string;
  revision: string | null;
  /** The default-language form: where the submission is sent and what it is checked against. */
  sourceId: string;
  sourceSlug: string | null;
}

function slugOf(doc: Json): string | null {
  const slug = doc.slug;
  if (typeof slug === "string") return slug;
  if (isObject(slug) && typeof slug.current === "string") return slug.current;
  return null;
}

function localizeOptions(source: unknown, translated: unknown): unknown {
  if (!Array.isArray(source)) return source;
  const list = Array.isArray(translated) ? translated.filter(isObject) : [];
  return source.map((option, index) => {
    if (!isObject(option)) return option;
    // Match by `_key` first; a translation made by hand may have lost keys, so the position is the fallback.
    const match = list.find((o) => typeof o._key === "string" && o._key === option._key) ?? (list.length === source.length ? list[index] : undefined);
    const label = match && hasValue(match.label) ? match.label : option.label;
    // The value is the default-language value, whatever the translation holds.
    return { ...option, label };
  });
}

/**
 * The form a page in another language renders: the default-language form's
 * structure and machine values with the translation's words laid over it.
 *
 * - fields are the default-language form's, in its order; a field is matched
 *   to its translation by `_key`
 * - `name` is always set, from the default-language field (so a name made
 *   from the English label stays the English one)
 * - option `value`s, conditions, widths, validation and every other key come
 *   from the default-language field; only the text keys come from the translation
 * - `settings` is the default-language `settings` with the text keys
 *   (`FORM_TEXT_SETTINGS`) from the translation; `notifications` and
 *   `stepRouting` are the default-language form's
 * - a text key the translation leaves empty falls back to the default language
 *
 * With no translation the default-language form is returned with `name` set
 * on every field, which changes nothing for the renderer.
 */
export function localizeForm(source: Json, translation?: Json | null, options: LocalizeFormOptions = {}): Json & { i18nForm: LocalizedFormMeta } {
  const textSettings = options.textSettings ?? FORM_TEXT_SETTINGS;
  const textKeys = options.textKeys ?? FORM_FIELD_TEXT_KEYS;
  const defaultId = options.defaultId ?? "en";
  const translatedFields = Array.isArray(translation?.fields) ? (translation.fields as unknown[]).filter(isObject) : [];
  const byKey = new Map(translatedFields.filter((f) => typeof f._key === "string").map((f) => [f._key as string, f]));

  const fields = (Array.isArray(source.fields) ? source.fields : []).map((field: unknown) => {
    if (!isObject(field)) return field;
    const out: Json = { ...field };
    const hasName = typeof field.name === "string" || typeof field.label === "string";
    // Display-only members (HTML, headings, page breaks) have no value to submit and keep no name.
    if (hasName) out.name = formFieldName(field);
    const translated = typeof field._key === "string" ? byKey.get(field._key) : undefined;
    if (!translated) return out;
    for (const key of textKeys) {
      if (hasValue(translated[key])) out[key] = translated[key];
    }
    if (Array.isArray(field.options)) out.options = localizeOptions(field.options, translated.options);
    return out;
  });

  const sourceSettings = isObject(source.settings) ? source.settings : {};
  const translatedSettings = isObject(translation?.settings) ? (translation.settings as Json) : {};
  const settings: Json = { ...sourceSettings };
  for (const key of textSettings) {
    if (hasValue(translatedSettings[key])) settings[key] = translatedSettings[key];
  }

  const shown = translation ?? source;
  const language = translation && typeof translation[LANGUAGE_FIELD] === "string" ? (translation[LANGUAGE_FIELD] as string) : defaultId;
  return {
    ...source,
    title: translation && hasValue(translation.title) ? translation.title : source.title,
    fields,
    settings,
    i18nForm: {
      language,
      documentId: String(shown._id ?? ""),
      revision: typeof shown._rev === "string" ? shown._rev : null,
      sourceId: String(source._id ?? ""),
      sourceSlug: slugOf(source),
    },
  };
}

// ── Consent records ──────────────────────────────────────────────────────

/** One consent field as the visitor saw it, stored with the submission. */
export interface ConsentRecord {
  /** The key the consent is submitted under. */
  field: string;
  checked: boolean;
  /** The plain text of the wording next to the checkbox, from the exact document revision the visitor saw. */
  textAsShown: string;
  language: string;
  /** The registry entry that approved the wording. Null in the default language, where no approval is needed. */
  legalApprovalId: string | null;
  /** Every registry entry behind the wording: one per paragraph of consent text. The first is `legalApprovalId`. */
  legalApprovalIds: string[];
}

function isVisible(field: Json, data: Json): boolean {
  const target = typeof field.conditionalField === "string" ? field.conditionalField : "";
  if (target === "") return true;
  const value = data[target];
  const compare = field.conditionalValue;
  switch (field.conditionalOperator) {
    case "equals":
      return String(value) === String(compare);
    case "not_equals":
      return String(value) !== String(compare);
    case "contains":
      return String(value ?? "").includes(String(compare ?? ""));
    case "is_empty":
      return !value;
    case "is_not_empty":
      return !!value;
    default:
      return true;
  }
}

/** The legal part of a consent field the renderer shows: the consent text when there is one, otherwise the label. */
function shownConsent(field: Json): { key: "consentText" | "label"; value: unknown } {
  return hasValue(field.consentText) ? { key: "consentText", value: field.consentText } : { key: "label", value: field.label };
}

/** The registry ids recorded on a translation for one field's legal path, in document order. */
function recordedApprovalIds(shown: Json, fieldKey: string, part: string): { ids: string[]; approved: boolean } {
  const legal = (shown[I18N_FIELD] as { legal?: { paths?: unknown } } | undefined)?.legal;
  const paths = Array.isArray(legal?.paths) ? (legal.paths as Json[]) : [];
  const prefix = `fields[_key==${JSON.stringify(fieldKey)}].${part}`;
  const mine = paths.filter((p) => typeof p.path === "string" && (p.path === prefix || p.path.startsWith(`${prefix}[`)));
  return {
    ids: mine.map((p) => String(p.unitId ?? "")).filter((id) => id !== ""),
    approved: mine.length > 0 && mine.every((p) => p.status === "approved"),
  };
}

export interface ConsentRecordInput {
  /**
   * The document the visitor saw, at the revision they saw: the translation
   * (with its `i18n.legal` record) or the default-language form.
   */
  shown: Json;
  /** The default-language form. Field names and visibility conditions are read from it. */
  source: Json;
  /** The submitted values, keyed by field name. */
  data: Json;
  /** The language of the page the form was on. */
  language: string;
  defaultId?: string;
}

/**
 * The consent record of a submission: for every consent field the visitor
 * was shown, whether it was ticked, the wording exactly as shown in that
 * language, and the registry entry that approved that wording.
 *
 * The wording is read from `shown`, which the caller loads at the revision
 * the visitor saw. In the default language the approval id is null. In any
 * other language the ids come from the translation's own legal record
 * (`i18n.legal.paths`), which the engine and the approval route maintain; a
 * translation without one (made by hand) falls back to the id the registry
 * would give the default-language wording.
 */
export function buildConsentRecords(input: ConsentRecordInput): ConsentRecord[] {
  const defaultId = input.defaultId ?? "en";
  const isDefault = input.language === defaultId;
  const shownFields = Array.isArray(input.shown.fields) ? (input.shown.fields as unknown[]).filter(isObject) : [];
  const shownByKey = new Map(shownFields.filter((f) => typeof f._key === "string").map((f) => [f._key as string, f]));
  const records: ConsentRecord[] = [];

  for (const field of Array.isArray(input.source.fields) ? (input.source.fields as unknown[]) : []) {
    if (!isObject(field) || field._type !== CONSENT_FIELD_TYPE) continue;
    if (!isVisible(field, input.data)) continue;
    const name = formFieldName(field);
    const key = typeof field._key === "string" ? field._key : "";
    const shownField = shownByKey.get(key) ?? field;
    const part = shownConsent(shownField);
    // A translation that left the wording empty shows the default-language wording; record what was on the page.
    const wording = hasValue(part.value) ? part : shownConsent(field);
    const textAsShown = portableTextToPlain(wording.value);

    let ids: string[] = [];
    if (!isDefault) {
      ids = recordedApprovalIds(input.shown, key, wording.key).ids;
      if (ids.length === 0) {
        // No record on the document: name the entries the registry would hold for the default-language wording.
        const english = shownConsent(field);
        const blocks = Array.isArray(english.value) ? english.value.map((b) => portableTextToPlain([b])) : [portableTextToPlain(english.value)];
        ids = blocks.filter((text) => normaliseLegalText(text) !== "").map((text) => legalApprovalId(input.language, legalSourceHash(text)));
      }
    }

    records.push({
      field: name,
      checked: input.data[name] === true || input.data[name] === "true" || input.data[name] === "on" || input.data[name] === 1,
      textAsShown,
      language: input.language,
      legalApprovalId: ids[0] ?? null,
      legalApprovalIds: ids,
    });
  }
  return records;
}

/** The consent wording of a submission as one string, for a webhook payload: each consent's text, a blank line between them. */
export function consentText(records: readonly ConsentRecord[]): string {
  return records.map((r) => r.textAsShown).filter((text) => text !== "").join("\n\n");
}

/**
 * The keys a submission's language adds to a webhook payload. Nothing is
 * renamed or removed: spread these next to the keys the payload already has.
 */
export function submissionWebhookFields(language: string, records: readonly ConsentRecord[]): { language: string; consent_text: string } {
  return { language, consent_text: consentText(records) };
}

/** True when every consent field's wording on a translation is recorded as approved. A form with no consent field is true. */
export function consentWordingApproved(shown: Json): boolean {
  const fields = Array.isArray(shown.fields) ? (shown.fields as unknown[]).filter(isObject) : [];
  return fields
    .filter((f) => f._type === CONSENT_FIELD_TYPE && typeof f._key === "string")
    .every((f) => recordedApprovalIds(shown, f._key as string, shownConsent(f).key).approved);
}

// ── Labels for a submission ──────────────────────────────────────────────

/**
 * The label a stored value was shown under: `optionLabel(field, "purchase")`
 * is "Comprar una casa" on the translated form and "Buy a home" on the
 * default one. The value itself is the same in both. Unknown values come back
 * as they are.
 */
export function optionLabel(field: Json, value: unknown): string {
  const options = Array.isArray(field.options) ? (field.options as unknown[]).filter(isObject) : [];
  const match = options.find((o) => o.value === value);
  return match && typeof match.label === "string" && match.label !== "" ? match.label : String(value ?? "");
}
