/**
 * Every way a run can fail, with the words a person sees. The message is
 * written for an editor in the Studio, not for a log: what happened and what
 * to do next. Messages never contain the API key or document content.
 */

export type EngineErrorCode =
  | "bad_request"
  | "job_not_found"
  | "job_not_pending"
  | "source_missing"
  | "source_not_default_language"
  | "language_unknown"
  | "language_not_enabled"
  | "type_not_translatable"
  | "manifest_missing"
  | "key_storage_not_configured"
  | "missing_key"
  | "key_unreadable"
  | "key_rejected"
  | "billing"
  | "rate_limited"
  | "service_unavailable"
  | "network"
  | "timeout"
  | "model_unavailable"
  | "request_rejected"
  | "document_too_large"
  | "structure_mismatch"
  | "check_failed"
  | "declined"
  | "dataset"
  | "wrong_route"
  | "unit_not_found"
  | "unit_not_pending"
  | "comment_required"
  | "not_an_approver"
  | "approver_unverified"
  | "unexpected";

export const KEY_STORAGE_NOT_CONFIGURED = "Translation key storage is not configured on this server yet.";

const MESSAGES: Record<EngineErrorCode, string> = {
  bad_request: "The request did not name a translation job.",
  job_not_found: "That translation job does not exist.",
  job_not_pending: "That translation job has already been started.",
  source_missing: "The English document has not been published yet. Publish it, then translate it.",
  source_not_default_language: "Only a document in the default language can be translated.",
  language_unknown: "That language is not set up for this site.",
  language_not_enabled: "That language is switched off in Site Settings. Switch it on under Languages first.",
  type_not_translatable: "This kind of document is not set up for translation.",
  manifest_missing: "The server does not have the list of translatable fields yet. Open the Studio once and try again.",
  key_storage_not_configured: `${KEY_STORAGE_NOT_CONFIGURED} Ask your developer to add the two I18N keys to the hosting environment.`,
  missing_key: "No Anthropic API key has been saved. Add it in Site Settings under Languages.",
  key_unreadable: "The saved API key cannot be read by this server. Enter the key again in Site Settings under Languages.",
  key_rejected: "Anthropic did not accept the API key. Check that the key is correct and still active, then save it again in Site Settings.",
  billing: "Anthropic reported a billing problem on the account that owns this API key. Check the account's billing, then try again.",
  rate_limited: "Anthropic is limiting how fast this API key can be used right now. Wait a few minutes and try again.",
  service_unavailable: "Anthropic's service is busy or unavailable right now. Try again in a few minutes.",
  network: "The server could not reach Anthropic. Try again in a moment.",
  timeout: "The translation took longer than the server allows. Try again; if it keeps happening the document may be too large for one run.",
  model_unavailable: "The chosen model is not available to this API key. Choose another model in Site Settings under Languages.",
  request_rejected: "Anthropic did not accept the request.",
  document_too_large: "This document is too large to translate in one run.",
  structure_mismatch: "The translation came back with a different structure from the English, even after a second attempt. Nothing was saved.",
  check_failed: "A number, link or other exact value in the translation does not match the English. Nothing was saved.",
  declined: "The model declined to translate this document. Nothing was saved.",
  dataset: "The server could not read or write the content. Check the site's Sanity token.",
  wrong_route: "That job belongs to another route.",
  unit_not_found: "That piece of legal text is not in the approval queue.",
  unit_not_pending: "That piece of legal text is not waiting for a decision.",
  comment_required: "A comment is needed to send legal text back, so the editor knows what to change.",
  not_an_approver: "Only a listed legal approver can approve or send back legal text. The list is in Site Settings under Languages.",
  approver_unverified: "The approver could not be verified, so nothing was changed. Try again in a moment.",
  unexpected: "Something unexpected went wrong. Nothing was saved.",
};

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  /** Extra detail that is safe to show: a list of paths, a model id. Never a key or document content. */
  readonly details: string[];

  constructor(code: EngineErrorCode, options: { message?: string; details?: string[] } = {}) {
    super(options.message ?? MESSAGES[code]);
    this.name = "EngineError";
    this.code = code;
    this.details = options.details ?? [];
  }
}

export function plainMessage(code: EngineErrorCode): string {
  return MESSAGES[code];
}

/** Any thrown value as an EngineError, so every failure reaches the job in plain words. */
export function asEngineError(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  return new EngineError("unexpected");
}
