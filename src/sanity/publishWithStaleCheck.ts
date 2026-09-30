import { useToast } from "@sanity/ui";
import { useClient, useSchema, type DocumentActionComponent, type DocumentActionProps } from "sanity";
import type { LanguagesConfig } from "../core/languages";
import { planStaleTranslations, type StaleMark } from "../core/legal";
import { buildFieldManifest } from "../core/manifest";
import { I18N_FIELD, LANGUAGE_FIELD, translationMetaId } from "../core/translations";
import { STUDIO_API_VERSION } from "./ApiKeyInput";

export interface PublishWithStaleCheckOptions {
  languages: LanguagesConfig;
}

type Json = Record<string, unknown>;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap the publish action so that publishing a default-language document
 * checks its translations against the English that just went live. A
 * translation whose stored source hashes no longer match is marked on its
 * DRAFT copy: "Awaiting approval" when legal wording changed (its registry
 * entries are marked superseded, so the Spanish re-locks), "Needs update"
 * otherwise, with `i18n.staleSince`. A draft is made from the published
 * translation when there is none. The published translation is never
 * touched, so the live page stays as it was last approved. Translations made
 * by hand, which have no stored hashes, are left alone.
 */
export function publishWithStaleCheck(original: DocumentActionComponent, options: PublishWithStaleCheckOptions): DocumentActionComponent {
  const defaultId = options.languages.defaultLanguage.id;

  const PublishWithStaleCheck: DocumentActionComponent = (props: DocumentActionProps) => {
    const description = original(props);
    const client = useClient({ apiVersion: STUDIO_API_VERSION });
    const schema = useSchema();
    const toast = useToast();

    if (!description) return description;
    const current = (props.draft ?? props.published) as Json | null;
    const language = current?.[LANGUAGE_FIELD];
    if (typeof language === "string" && language !== "" && language !== defaultId) return description;

    const afterPublish = async () => {
      const before = props.published?._rev;
      let published: Json | undefined;
      // Publishing is not instant. Wait until the published document has a new revision.
      for (let i = 0; i < 20; i++) {
        await wait(750);
        published = (await client.getDocument(props.id)) as Json | undefined;
        if (published && published._rev !== before) break;
        published = undefined;
      }
      if (!published) return;

      const rows = await client.fetch<Json[]>(
        `*[_type == $type && ${I18N_FIELD}.source._ref == $id && defined(${I18N_FIELD}.sourceHashes)]`,
        { type: props.type, id: props.id },
        { perspective: "raw" },
      );
      if (rows.length === 0) return;
      const metaId = translationMetaId(props.id);
      const metaCount = await client.fetch<number>(`count(*[_id == $id])`, { id: metaId });

      // A translation can exist as a draft and as a published document. Both are needed: the draft is marked, the published one stays live.
      const byId = new Map<string, { published?: Json; draft?: Json }>();
      for (const row of rows) {
        const id = String(row._id);
        const key = id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
        const pair = byId.get(key) ?? {};
        if (id.startsWith("drafts.")) pair.draft = row;
        else pair.published = row;
        byId.set(key, pair);
      }

      const manifest = buildFieldManifest(schema, [props.type], { defaultLanguage: defaultId });
      const plan = planStaleTranslations({
        source: published,
        translations: [...byId.values()],
        manifest,
        now: new Date().toISOString(),
        metaIds: new Set(metaCount > 0 ? [metaId] : []),
      });
      if (plan.marks.length === 0) return;
      await client.mutate(plan.mutations as never);
      toast.push(staleToast(plan.marks, options.languages));
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

/** The toast after a stale check, in plain words. Exported for tests. */
export function staleToast(marks: readonly StaleMark[], languages: LanguagesConfig): { status: "info" | "warning"; title: string; description: string } {
  const names = [...new Set(marks.map((m) => m.language))].map((id) => languages.languages.find((l) => l.id === id)?.title ?? id).join(", ");
  const legal = marks.filter((m) => m.legalChanged.length > 0);
  if (legal.length > 0) {
    return {
      status: "warning",
      title: "Legal text changed: translation re-locked",
      description: `The English legal wording changed, so the ${names} version is Awaiting approval again. The live ${names} page keeps its last approved wording. Use Translate and choose "Only what changed", then approve the new wording in Legal approvals.`,
    };
  }
  return {
    status: "info",
    title: "Translation marked Needs update",
    description: `The English changed, so the ${names} draft needs updating. The live ${names} page is unchanged. Use Translate and choose "Only what changed".`,
  };
}
