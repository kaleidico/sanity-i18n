import { useEffect, useState } from "react";
import { useClient, useSchema, type DocumentActionComponent, type DocumentActionProps } from "sanity";
import type { LanguagesConfig } from "../core/languages";
import { checkTranslationForPublish, LEGAL_APPROVAL_TYPE, type LegalApproval, type PublishCheck } from "../core/legal";
import { collectReferences, dependencyReasons, planDependencies, DEFAULT_REQUIRED_DEPENDENCY_TYPES } from "../core/dependencies";
import { translationId } from "../core/engineModel";
import { buildFieldManifest } from "../core/manifest";
import { LANGUAGE_FIELD, I18N_FIELD, type TranslationLabels } from "../core/translations";
import { STUDIO_API_VERSION } from "./ApiKeyInput";

export interface PublishTranslationActionOptions {
  languages: LanguagesConfig;
  labels?: TranslationLabels;
  /** Every translatable document type, so a reference to one is recognised as a dependency. */
  translatableTypes?: readonly string[];
  /** Types whose translation must be approved and live before a document that refers to them can be published. Defaults to `["form"]`. */
  requiredDependencyTypes?: readonly string[];
}

type Json = Record<string, unknown>;

/**
 * Wrap the publish action so a translation (a document in a language other
 * than the default) can only be published under the rule: its status is
 * Approved, it is not held by the reviewer, no legal text on it is waiting
 * for approval, and every legal path carries the approved wording word for
 * word, and every form it embeds is approved and live in the same language.
 * Otherwise Publish is disabled and its tooltip says why. English documents
 * are left exactly as they were.
 */
export function publishTranslationAction(original: DocumentActionComponent, options: PublishTranslationActionOptions): DocumentActionComponent {
  const defaultId = options.languages.defaultLanguage.id;

  const PublishTranslation: DocumentActionComponent = (props: DocumentActionProps) => {
    const description = original(props);
    const client = useClient({ apiVersion: STUDIO_API_VERSION });
    const schema = useSchema();
    const current = (props.draft ?? props.published) as Json | null;
    const language = current?.[LANGUAGE_FIELD];
    const isTranslation = typeof language === "string" && language !== "" && language !== defaultId;
    const [check, setCheck] = useState<PublishCheck | null>(null);

    // The registry entries this document depends on, read whenever the draft changes.
    const draft = props.draft as Json | null;
    const legal = (draft?.[I18N_FIELD] as { legal?: { paths?: { unitId?: string }[] } } | undefined)?.legal;
    const unitIds = (legal?.paths ?? []).map((p) => p.unitId).filter((id): id is string => typeof id === "string");
    const unitKey = unitIds.join(",");
    const draftRev = `${typeof draft?._rev === "string" ? draft._rev : ""}|${typeof draft?._updatedAt === "string" ? draft._updatedAt : ""}`;

    useEffect(() => {
      if (!isTranslation || !draft) return;
      let alive = true;
      const run = async () => {
        const docs = unitIds.length > 0 ? await client.fetch<LegalApproval[]>(`*[_type == $type && _id in $ids]{ _id, status, translatedText }`, { type: LEGAL_APPROVAL_TYPE, ids: unitIds }) : [];
        const entries = new Map(docs.map((d) => [d._id, d]));
        const manifest = buildFieldManifest(schema, [props.type], { defaultLanguage: defaultId });
        const result = checkTranslationForPublish(draft, manifest, entries, { labels: options.labels });

        // What it depends on in the same language: an embedded form must be approved and live first.
        const required = options.requiredDependencyTypes ?? DEFAULT_REQUIRED_DEPENDENCY_TYPES;
        const refs = required.length > 0 ? collectReferences(draft) : [];
        let reasons = result.reasons;
        if (refs.length > 0) {
          const types = [...new Set([props.type, ...(options.translatableTypes ?? []), ...required])].filter((t) => schema.get(t));
          const wide = buildFieldManifest(schema, types, { defaultLanguage: defaultId });
          const targets = await client.fetch<Json[]>(`*[_id in $ids]{ _id, _type, ${LANGUAGE_FIELD} }`, { ids: refs });
          const translationIds = targets.map((t) => translationId(String(t._id), String(language)));
          const found = translationIds.length > 0 ? await client.fetch<Json[]>(`*[_id in $ids]{ _id, ${I18N_FIELD}{ status } }`, { ids: [...translationIds, ...translationIds.map((id) => `drafts.${id}`)] }) : [];
          const translated = found.filter((t) => !String(t._id).startsWith("drafts."));
          const dependencies = planDependencies({
            document: draft,
            language: String(language),
            manifest: wide,
            referenced: new Map(targets.map((t) => [String(t._id), t])),
            translations: new Map(translated.map((t) => [String(t._id), t])),
            drafts: new Set(found.filter((t) => String(t._id).startsWith("drafts.")).map((t) => String(t._id).slice("drafts.".length))),
            requiredTypes: required,
          });
          reasons = [...reasons, ...dependencyReasons(dependencies)];
        }
        if (alive) setCheck({ ok: reasons.length === 0, reasons });
      };
      run().catch(() => {
        if (alive) setCheck({ ok: false, reasons: ["The legal text on this translation could not be checked. Try again in a moment."] });
      });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, schema, isTranslation, props.type, unitKey, draftRev, defaultId]);

    if (!description || !isTranslation) return description;
    if (!draft) return description;
    if (check === null) return { ...description, disabled: true, title: "Checking the legal text on this translation" };
    if (check.ok) return description;
    return {
      ...description,
      disabled: true,
      title: `Cannot publish yet. ${check.reasons.join(" ")}`,
    };
  };

  PublishTranslation.action = original.action;
  PublishTranslation.displayName = "PublishTranslation";
  return PublishTranslation;
}
