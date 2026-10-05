import { definePlugin, type DocumentActionComponent } from "sanity";
import { ENGINE_DOCUMENT_TYPES } from "../core/engineModel";
import { defineLanguages, type LanguagesConfig, type LanguagesInput } from "../core/languages";
import { LEGAL_APPROVAL_TYPE } from "../core/legal";
import { TRANSLATION_META_TYPE, type TranslationLabels } from "../core/translations";
import { translationBadge } from "./badge";
import { legalApprovalType, translationJobType, translationManifestType, translationSecretsType } from "./engineTypes";
import { legalApprovalsTool } from "./LegalApprovalsTool";
import { publishTranslationAction } from "./publishTranslationAction";
import { publishWithStaleCheck } from "./publishWithStaleCheck";
import type { StudioEngineOptions } from "./studioEngine";
import { translateAction } from "./translateAction";
import { translationMetaType } from "./translationMeta";
import { translationsTool } from "./TranslationsTool";

export const I18N_PLUGIN_NAME = "kaleidico-i18n";

/** The document types the package adds for its own bookkeeping. Leave them out of desk lists. */
export const I18N_HIDDEN_TYPES: readonly string[] = [TRANSLATION_META_TYPE, ...ENGINE_DOCUMENT_TYPES, LEGAL_APPROVAL_TYPE];

export interface I18nEngineConfig {
  /** Where the site mounts `createTranslateRoute()`. Defaults to `/api/i18n/translate`. */
  endpoint?: string;
  /** Where the site mounts `createApprovalRoute()`. Defaults to `/api/i18n/approve`. */
  approveEndpoint?: string;
  /** The Site Settings document type. Defaults to `settings`. */
  settingsType?: string;
  /** Name of the languages field on Site Settings. Defaults to `languages`. */
  languagesField?: string;
  /** Name of the legal approvers field on Site Settings. Defaults to `i18nLegalApprovers`. */
  legalApproversField?: string;
  /** How many translations the Translations tool runs at once. Defaults to 2. */
  concurrency?: number;
}

export interface I18nPluginConfig {
  /** The languages the site can offer. Pass the result of `defineLanguages()` or a plain array. */
  languages: LanguagesInput;
  /**
   * The document types wrapped with `translatable()`. They get the language
   * and status badge, and the `i18n.translationMeta` document type is
   * registered so it can reference them. Leave empty until a type is wrapped.
   */
  translatableTypes?: readonly string[];
  /** Host overrides for the status titles, e.g. `{ awaiting_approval: "Awaiting NOVA approval" }`. Keep in step with `translatable()`. */
  labels?: TranslationLabels;
  /** Titles per document type, shown in the Translations tool. Defaults to the type name. */
  titles?: Readonly<Record<string, string>>;
  /**
   * The translation engine in the Studio: the "Translate to <Language>"
   * action, the check that marks translations stale when the English is
   * published, the publish rule on translations, the Translations tool and
   * the Legal approvals tool. On by default once a type is translatable; pass
   * `false` to leave all of them out.
   */
  engine?: I18nEngineConfig | false;
}

/**
 * Sanity Studio plugin. Carries the language config, registers the
 * `i18n.translationMeta` document type for the translatable types, adds the
 * language and status badge to them, and wires the translation engine into
 * the Studio. Hosts add it once.
 */
export const i18nPlugin = definePlugin<I18nPluginConfig>((config) => {
  const languages: LanguagesConfig = defineLanguages(config.languages);
  const translatableTypes = [...(config.translatableTypes ?? [])];
  const badge = translationBadge({ defaultId: languages.defaultLanguage.id, labels: config.labels });
  const engineOn = config.engine !== false && translatableTypes.length > 0;
  const engineConfig: I18nEngineConfig = config.engine ? config.engine : {};
  const engine: StudioEngineOptions = { languages, translatableTypes, ...engineConfig };

  const translateActions = engineOn
    ? languages.languages
        .filter((language) => language.id !== languages.defaultLanguage.id)
        .map((language) => translateAction({ ...engine, language, labels: config.labels }))
    : [];

  // One wrapper per original action, so the wrapped action keeps its identity
  // between renders. English documents get the stale check; translations get
  // the publish rule. Each wrapper leaves the other kind of document alone.
  const wrappedPublish = new WeakMap<DocumentActionComponent, DocumentActionComponent>();
  const wrap = (action: DocumentActionComponent) => {
    let wrapped = wrappedPublish.get(action);
    if (!wrapped) {
      wrapped = publishTranslationAction(publishWithStaleCheck(action, { languages }), { languages, labels: config.labels, translatableTypes: config.translatableTypes });
      wrappedPublish.set(action, wrapped);
    }
    return wrapped;
  };

  return {
    name: I18N_PLUGIN_NAME,
    schema: {
      types:
        translatableTypes.length > 0
          ? [
              translationMetaType({ translatableTypes }),
              ...(engineOn ? [translationJobType(), translationSecretsType(), translationManifestType(), legalApprovalType()] : []),
            ]
          : [],
    },
    document: {
      badges: (prev, context) =>
        translatableTypes.includes(context.schemaType) ? [...prev, badge] : prev,
      actions: (prev, context) => {
        if (!engineOn || !translatableTypes.includes(context.schemaType)) return prev;
        return [...prev.map((action) => (action.action === "publish" ? wrap(action) : action)), ...translateActions];
      },
      // The bookkeeping documents are made by the package, never by hand.
      newDocumentOptions: (prev) => prev.filter((template) => !I18N_HIDDEN_TYPES.includes(template.templateId)),
    },
    tools: engineOn
      ? [translationsTool({ ...engine, titles: config.titles, labels: config.labels }), legalApprovalsTool({ ...engine, titles: config.titles, labels: config.labels })]
      : [],
    // Not a Sanity option; harmless extra property that later parts read.
    ...({ i18n: { languages, translatableTypes, engine: engineOn } } as Record<string, unknown>),
  };
});
