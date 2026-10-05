/**
 * Loading what a translation depends on: the translatable documents it
 * refers to and their published translations in the same language.
 */
import { collectReferences, planDependencies, type TranslationDependency } from "../core/dependencies";
import { translationId } from "../core/engineModel";
import type { FieldManifest } from "../core/manifest";
import type { SanityLike } from "./sanityHttp";

type Json = Record<string, unknown>;

export async function loadDependencies(
  sanity: SanityLike,
  document: Json,
  language: string,
  manifest: FieldManifest,
  requiredTypes?: readonly string[],
): Promise<TranslationDependency[]> {
  const ids = collectReferences(document);
  if (ids.length === 0) return [];
  const referencedDocs = await sanity.getDocuments(ids);
  const referenced = new Map(referencedDocs.map((d) => [String(d._id), d]));
  const translatable = referencedDocs.filter((d) => manifest.documents[String(d._type ?? "")]);
  const translationIds = translatable.map((d) => translationId(String(d._id), language));
  const found = translationIds.length > 0 ? await sanity.getDocuments([...translationIds, ...translationIds.map((id) => `drafts.${id}`)]) : [];
  const translations = new Map(found.filter((d) => !String(d._id).startsWith("drafts.")).map((d) => [String(d._id), d]));
  const drafts = new Set(found.filter((d) => String(d._id).startsWith("drafts.")).map((d) => String(d._id).slice("drafts.".length)));
  return planDependencies({ document, language, manifest, referenced, translations, drafts, requiredTypes });
}
