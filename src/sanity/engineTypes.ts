import { defineField, defineType } from "sanity";
import type { DocumentDefinition, FieldDefinition } from "sanity";
import { JOB_TYPE, MANIFEST_TYPE, SECRETS_TYPE } from "../core/engineModel";

/**
 * Schema for what the translation engine writes: the per-unit source hashes
 * and the report on a translation, and the three private documents (the job,
 * the encrypted key and the field manifest). Everything here is written by
 * the engine and read by the Studio tooling; none of it is edited by hand.
 */

const text = (name: string, title: string) => defineField({ name, title, type: "string", readOnly: true });
const number = (name: string, title: string) => defineField({ name, title, type: "number", readOnly: true });
const flag = (name: string, title: string) => defineField({ name, title, type: "boolean", readOnly: true });
const when = (name: string, title: string) => defineField({ name, title, type: "datetime", readOnly: true });
const texts = (name: string, title: string) => defineField({ name, title, type: "array", of: [{ type: "string" }], readOnly: true });

const findingFields = () => [
  text("path", "Path"),
  text("category", "Category"),
  text("source", "English"),
  text("translated", "Translation"),
  text("note", "Note"),
];

/** `i18n.sourceHashes`: one SHA-256 per translated unit of the source, plus one for everything that is not text. */
export function sourceHashesField(): FieldDefinition {
  return defineField({
    name: "sourceHashes",
    title: "Source fingerprints",
    type: "array",
    hidden: true,
    readOnly: true,
    description: "Fingerprint of each piece of the source when this translation was last made. Used to find what changed.",
    of: [{ type: "object", name: "sourceHash", fields: [text("path", "Path"), text("hash", "SHA-256")] }],
  });
}

/** The fields of a run's report. Stored on the job and, as `i18n.report`, on the translation. */
export function reportFields(): FieldDefinition[] {
  return [
    text("mode", "Mode"),
    text("language", "Language"),
    text("sourceId", "Source document"),
    text("translationId", "Translation document"),
    when("startedAt", "Started"),
    when("finishedAt", "Finished"),
    text("translatorModel", "Translator model"),
    text("reviewerModel", "Reviewer model"),
    texts("servedBy", "Models that answered"),
    number("inputTokens", "Input tokens"),
    number("outputTokens", "Output tokens"),
    number("costUsd", "Cost in US dollars"),
    text("ratesAsOf", "Rates as of"),
    defineField({
      name: "usage",
      title: "Usage per model",
      type: "array",
      readOnly: true,
      of: [
        {
          type: "object",
          name: "callUsage",
          fields: [
            text("model", "Model"),
            number("requests", "Requests"),
            number("inputTokens", "Input tokens"),
            number("outputTokens", "Output tokens"),
            number("cacheReadTokens", "Cache read tokens"),
            number("cacheWriteTokens", "Cache write tokens"),
          ],
        },
      ],
    }),
    number("unitsTotal", "Pieces of text in the document"),
    number("unitsTranslated", "Pieces translated on this run"),
    number("unitsReused", "Pieces kept from the existing translation"),
    texts("translatedPaths", "Paths translated on this run"),
    number("structureRetries", "Structure retries"),
    flag("check1Passed", "Exact-match check passed"),
    number("check1Checked", "Strings compared"),
    defineField({ name: "check1Failures", title: "Exact-match failures", type: "array", readOnly: true, of: [{ type: "object", name: "finding", fields: findingFields() }] }),
    defineField({ name: "check1Warnings", title: "Exact-match warnings", type: "array", readOnly: true, of: [{ type: "object", name: "finding", fields: findingFields() }] }),
    flag("reviewPassed", "Reviewer check passed"),
    defineField({
      name: "reviewIssues",
      title: "Reviewer issues",
      type: "array",
      readOnly: true,
      of: [{ type: "object", name: "reviewIssue", fields: [text("path", "Path"), text("severity", "Severity"), text("category", "Category"), text("note", "Note")] }],
    }),
    texts("legalPaths", "Legal text paths"),
    text("sourceSlug", "Source slug"),
    text("proposedSlug", "Proposed slug"),
    flag("held", "Held for a person"),
    texts("holdReasons", "Why it is held"),
    flag("saved", "Saved as a draft"),
  ];
}

/** `i18n.report`: the report of the run that produced this translation. */
export function reportField(): FieldDefinition {
  return defineField({
    name: "report",
    title: "Translation report",
    type: "object",
    hidden: true,
    readOnly: true,
    description: "What the translation engine did on its last run: models, tokens, cost and the result of both checks.",
    fields: reportFields(),
  });
}

const hiddenDocument = { __experimental_omnisearch_visibility: false } as const;

/** `i18n.job`: a request for the server to translate or estimate. Private: its id has a period in it. */
export function translationJobType(): DocumentDefinition {
  return defineType({
    name: JOB_TYPE,
    title: "Translation job",
    type: "document",
    ...hiddenDocument,
    readOnly: true,
    fields: [
      text("kind", "Kind"),
      text("sourceId", "Source document"),
      text("sourceType", "Source type"),
      texts("sourceIds", "Source documents"),
      text("language", "Language"),
      text("mode", "Mode"),
      text("requestedBy", "Requested by"),
      text("status", "Status"),
      text("progress", "Progress"),
      when("createdAt", "Created"),
      when("startedAt", "Started"),
      when("finishedAt", "Finished"),
      defineField({ name: "report", title: "Report", type: "object", readOnly: true, fields: reportFields() }),
      defineField({
        name: "estimate",
        title: "Estimate",
        type: "object",
        readOnly: true,
        fields: [
          number("documents", "Documents"),
          number("strings", "Strings"),
          number("characters", "Characters"),
          number("inputTokens", "Input tokens"),
          number("outputTokens", "Output tokens"),
          number("costUsd", "Cost in US dollars"),
          text("translatorModel", "Translator model"),
          text("reviewerModel", "Reviewer model"),
          text("ratesAsOf", "Rates as of"),
          text("method", "Method"),
          number("counted", "Documents counted"),
          text("note", "Note"),
        ],
      }),
      defineField({
        name: "error",
        title: "Error",
        type: "object",
        readOnly: true,
        fields: [text("code", "Code"), text("message", "Message"), texts("details", "Details")],
      }),
    ],
    preview: {
      select: { kind: "kind", status: "status", sourceId: "sourceId", language: "language" },
      prepare: ({ kind, status, sourceId, language }) => ({
        title: `${kind === "estimate" ? "Estimate" : "Translate"}${sourceId ? ` ${sourceId}` : ""} (${language ?? "?"})`,
        subtitle: status,
      }),
    },
  });
}

/** `i18n.secrets`: the encrypted API key. Private: its id has a period in it, and the key cannot be read back from it. */
export function translationSecretsType(): DocumentDefinition {
  return defineType({
    name: SECRETS_TYPE,
    title: "Translation key storage",
    type: "document",
    ...hiddenDocument,
    readOnly: true,
    fields: [
      defineField({
        name: "anthropicKey",
        title: "Anthropic API key",
        type: "object",
        readOnly: true,
        fields: [
          text("ciphertext", "Encrypted key"),
          text("last4", "Last four characters"),
          when("savedAt", "Saved"),
          text("savedBy", "Saved by"),
          text("keyFingerprint", "Key pair fingerprint"),
        ],
      }),
    ],
    preview: { prepare: () => ({ title: "Translation key storage" }) },
  });
}

/** `i18n.manifest`: the list of translatable fields the Studio keeps for the server. */
export function translationManifestType(): DocumentDefinition {
  return defineType({
    name: MANIFEST_TYPE,
    title: "Translation field manifest",
    type: "document",
    ...hiddenDocument,
    readOnly: true,
    fields: [text("hash", "Fingerprint"), defineField({ name: "manifest", title: "Manifest", type: "text", readOnly: true }), when("updatedAt", "Updated")],
    preview: { prepare: () => ({ title: "Translation field manifest" }) },
  });
}
