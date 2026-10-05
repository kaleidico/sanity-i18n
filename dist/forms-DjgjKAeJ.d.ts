type Json = Record<string, unknown>;
/** The `settings` keys of a form that are words a visitor reads. Everything else in `settings` is behaviour and comes from the default-language form. */
declare const FORM_TEXT_SETTINGS: readonly ["submitButtonText", "nextButtonText", "backButtonText", "successMessage"];
/** The keys of a form field that are words a visitor reads. */
declare const FORM_FIELD_TEXT_KEYS: readonly ["label", "placeholder", "helpText", "tooltip", "heading", "description", "stepLabel", "consentText", "content"];
/** Field types that hold consent wording. */
declare const CONSENT_FIELD_TYPE = "consentField";
/**
 * The key a field's value is submitted under: its `name`, or one made from
 * its label, or one made from its `_key`. The same rule the form renderer has
 * always used; kept here so the page and the route agree.
 */
declare function formFieldName(field: Json): string;
/** The readable text of a Portable Text value (or a plain string): blocks joined by a blank line, spans joined as they are. */
declare function portableTextToPlain(value: unknown): string;
interface LocalizeFormOptions {
    /** The `settings` keys read from the translation. Defaults to `FORM_TEXT_SETTINGS`. */
    textSettings?: readonly string[];
    /** The field keys read from the translation. Defaults to `FORM_FIELD_TEXT_KEYS`. */
    textKeys?: readonly string[];
    /** The default language id. Defaults to `en`. */
    defaultId?: string;
}
/** What `localizeForm()` adds to the form it returns, for the renderer and the submit route. */
interface LocalizedFormMeta {
    /** The language the visitor reads. */
    language: string;
    /** The document the visitor actually saw: the translation, or the default-language form. */
    documentId: string;
    revision: string | null;
    /** The default-language form: where the submission is sent and what it is checked against. */
    sourceId: string;
    sourceSlug: string | null;
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
declare function localizeForm(source: Json, translation?: Json | null, options?: LocalizeFormOptions): Json & {
    i18nForm: LocalizedFormMeta;
};
/** One consent field as the visitor saw it, stored with the submission. */
interface ConsentRecord {
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
interface ConsentRecordInput {
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
declare function buildConsentRecords(input: ConsentRecordInput): ConsentRecord[];
/** The consent wording of a submission as one string, for a webhook payload: each consent's text, a blank line between them. */
declare function consentText(records: readonly ConsentRecord[]): string;
/**
 * The keys a submission's language adds to a webhook payload. Nothing is
 * renamed or removed: spread these next to the keys the payload already has.
 */
declare function submissionWebhookFields(language: string, records: readonly ConsentRecord[]): {
    language: string;
    consent_text: string;
};
/** True when every consent field's wording on a translation is recorded as approved. A form with no consent field is true. */
declare function consentWordingApproved(shown: Json): boolean;
/**
 * The label a stored value was shown under: `optionLabel(field, "purchase")`
 * is "Comprar una casa" on the translated form and "Buy a home" on the
 * default one. The value itself is the same in both. Unknown values come back
 * as they are.
 */
declare function optionLabel(field: Json, value: unknown): string;

export { type ConsentRecord as C, FORM_TEXT_SETTINGS as F, type LocalizeFormOptions as L, consentWordingApproved as a, buildConsentRecords as b, consentText as c, CONSENT_FIELD_TYPE as d, type ConsentRecordInput as e, formFieldName as f, FORM_FIELD_TEXT_KEYS as g, type LocalizedFormMeta as h, localizeForm as l, optionLabel as o, portableTextToPlain as p, submissionWebhookFields as s };
