/**
 * What a translation needs before it can go live: the other translatable
 * documents it refers to, in the same language. A page that embeds a form is
 * the case that matters: a page in Spanish with a form that has no approved
 * Spanish translation would either show an English form or a hole where the
 * form should be, so the page waits for the form.
 *
 * Pure functions over plain JSON. The engine loads the documents and calls
 * `planDependencies()`; the Studio's Publish button does the same.
 */
import { translationId } from "./engineModel";
import type { FieldManifest } from "./manifest";
import { I18N_FIELD, LANGUAGE_FIELD } from "./translations";

type Json = Record<string, unknown>;

/** The document types whose missing translation stops a document that refers to them from being published. */
export const DEFAULT_REQUIRED_DEPENDENCY_TYPES: readonly string[] = ["form"];

export interface TranslationDependency {
  _key: string;
  /** The default-language document that is referred to. */
  id: string;
  type: string;
  /** Where its translation in this language lives, published. */
  translationId: string;
  /**
   * `approved` when the published translation exists and is approved;
   * `missing` when there is no translation at all; `unpublished` when there is
   * only a draft; otherwise the status the published translation has.
   */
  status: string;
  /** True when the document cannot be published until this one is approved and live. */
  blocking: boolean;
}

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The ids of every document a document refers to, in document order, without
 * duplicates. The link to its own source (`i18n.source`) and the bookkeeping
 * under `i18n` are left out.
 */
export function collectReferences(doc: Json): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isObject(value)) return;
    if (typeof value._ref === "string" && value._ref !== "") {
      const id = value._ref.startsWith("drafts.") ? value._ref.slice("drafts.".length) : value._ref;
      if (!out.includes(id)) out.push(id);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (value === doc && key === I18N_FIELD) continue;
      walk(child);
    }
  };
  walk(doc);
  return out;
}

export interface DependencyPlanInput {
  /** The translation (or the source it was made from: the references are the same). */
  document: Json;
  language: string;
  manifest: FieldManifest;
  /** The documents the references point at, by id. Ids that are not here are ignored (assets, deleted documents). */
  referenced: ReadonlyMap<string, Json>;
  /** The published translations of those documents in this language, by translation id. */
  translations: ReadonlyMap<string, Json>;
  /** The translation ids that exist as a draft only, so "not live yet" can be told from "not translated". */
  drafts?: ReadonlySet<string>;
  /** Types whose missing translation blocks publishing. Defaults to `["form"]`. */
  requiredTypes?: readonly string[];
}

/**
 * The translatable documents a document refers to and how each one stands in
 * this language. A reference to a document that is already in this language
 * (a translation pointing at another translation) is not a dependency.
 */
export function planDependencies(input: DependencyPlanInput): TranslationDependency[] {
  const required = input.requiredTypes ?? DEFAULT_REQUIRED_DEPENDENCY_TYPES;
  const ownId = String(input.document._id ?? "").replace(/^drafts\./, "");
  const out: TranslationDependency[] = [];
  for (const id of collectReferences(input.document)) {
    if (id === ownId) continue;
    const target = input.referenced.get(id);
    if (!target) continue;
    const type = String(target._type ?? "");
    if (!input.manifest.documents[type]) continue;
    const targetLanguage = target[LANGUAGE_FIELD];
    if (typeof targetLanguage === "string" && targetLanguage !== "" && targetLanguage !== input.manifest.defaultLanguage) continue;
    const tid = translationId(id, input.language);
    const translation = input.translations.get(tid);
    const status = translation ? String((translation[I18N_FIELD] as Json | undefined)?.status ?? "draft") : input.drafts?.has(tid) ? "unpublished" : "missing";
    out.push({ _key: `d${out.length}`, id, type, translationId: tid, status, blocking: required.includes(type) && status !== "approved" });
  }
  return out;
}

/** Plain reasons a document cannot be published because of what it depends on. Empty when nothing blocks. */
export function dependencyReasons(dependencies: readonly TranslationDependency[], languageTitle?: string): string[] {
  const language = languageTitle ? `${languageTitle} ` : "";
  return dependencies
    .filter((d) => d.blocking)
    .map((d) =>
      d.status === "missing"
        ? `It embeds the ${d.type} ${d.id}, which has no ${language}translation yet. Translate and approve that ${d.type} first.`
        : d.status === "unpublished"
          ? `It embeds the ${d.type} ${d.id}, whose ${language}translation is still a draft. Approve and publish that ${d.type} first.`
          : `It embeds the ${d.type} ${d.id}, whose ${language}translation is not approved and live yet (${d.status.replace(/_/g, " ")}). Approve and publish that ${d.type} first.`,
    );
}
