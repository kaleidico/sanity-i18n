import { useToast } from "@sanity/ui";
import { useClient, useSchema, type DocumentActionComponent, type DocumentActionProps } from "sanity";
import type { LanguagesConfig } from "../core/languages";
import { buildFieldManifest } from "../core/manifest";
import { diffSource } from "../core/payload";
import { I18N_FIELD, LANGUAGE_FIELD } from "../core/translations";
import { STUDIO_API_VERSION } from "./ApiKeyInput";

export interface PublishWithStaleCheckOptions {
  languages: LanguagesConfig;
}

interface TranslationRow {
  _id: string;
  [LANGUAGE_FIELD]?: string;
  [I18N_FIELD]?: { status?: string; sourceHashes?: unknown };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap the publish action so that publishing a default-language document
 * checks its translations. A translation whose stored source hashes no longer
 * match the English is marked "Needs update". Translations made by hand,
 * which have no stored hashes, are left alone because there is nothing to
 * compare them with.
 */
export function publishWithStaleCheck(original: DocumentActionComponent, options: PublishWithStaleCheckOptions): DocumentActionComponent {
  const defaultId = options.languages.defaultLanguage.id;

  const PublishWithStaleCheck: DocumentActionComponent = (props: DocumentActionProps) => {
    const description = original(props);
    const client = useClient({ apiVersion: STUDIO_API_VERSION });
    const schema = useSchema();
    const toast = useToast();

    if (!description) return description;
    const current = (props.draft ?? props.published) as Record<string, unknown> | null;
    const language = current?.[LANGUAGE_FIELD];
    if (typeof language === "string" && language !== "" && language !== defaultId) return description;

    const afterPublish = async () => {
      const before = props.published?._rev;
      let published: Record<string, unknown> | undefined;
      // Publishing is not instant. Wait until the published document has a new revision.
      for (let i = 0; i < 20; i++) {
        await wait(750);
        published = (await client.getDocument(props.id)) as Record<string, unknown> | undefined;
        if (published && published._rev !== before) break;
        published = undefined;
      }
      if (!published) return;

      const translations = await client.fetch<TranslationRow[]>(
        `*[_type == $type && ${I18N_FIELD}.source._ref == $id && defined(${I18N_FIELD}.sourceHashes)]{ _id, ${LANGUAGE_FIELD}, ${I18N_FIELD}{ status, sourceHashes } }`,
        { type: props.type, id: props.id },
        { perspective: "raw" },
      );
      if (translations.length === 0) return;

      const manifest = buildFieldManifest(schema, [props.type], { defaultLanguage: defaultId });
      const stale = translations.filter(
        (t) => t[I18N_FIELD]?.status !== "needs_update" && !diffSource(published as Record<string, unknown>, t as unknown as Record<string, unknown>, manifest).upToDate,
      );
      if (stale.length === 0) return;

      let transaction = client.transaction();
      for (const translation of stale) {
        transaction = transaction.patch(translation._id, (patch) => patch.set({ [`${I18N_FIELD}.status`]: "needs_update" }));
      }
      await transaction.commit();

      const names = [...new Set(stale.map((t) => t[LANGUAGE_FIELD]).filter(Boolean))]
        .map((id) => options.languages.languages.find((l) => l.id === id)?.title ?? String(id))
        .join(", ");
      toast.push({
        status: "info",
        title: "Translation marked Needs update",
        description: `The English changed, so the ${names} version needs updating. Use Translate and choose "Only what changed".`,
      });
    };

    return {
      ...description,
      onHandle: () => {
        description.onHandle?.();
        afterPublish().catch(() => {
          // The publish itself succeeded. A missed mark is caught the next time the English is published.
        });
      },
    };
  };

  PublishWithStaleCheck.action = original.action;
  PublishWithStaleCheck.displayName = "PublishWithStaleCheck";
  return PublishWithStaleCheck;
}
