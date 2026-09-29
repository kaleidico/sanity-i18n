import { defineType, defineField, definePlugin } from 'sanity';

// src/core/languages.ts
var DEFAULT_LANGUAGE_ID = "en";
var ENGLISH = {
  id: DEFAULT_LANGUAGE_ID,
  title: "English",
  nativeTitle: "English",
  default: true
};
var ID_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
function isConfig(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input) && "defaultLanguage" in input;
}
function defineLanguages(input) {
  if (isConfig(input)) return input;
  const given = Array.isArray(input) ? input : input.languages;
  if (!Array.isArray(given)) {
    throw new Error("defineLanguages: expected an array of languages");
  }
  const seen = /* @__PURE__ */ new Set();
  for (const lang of given) {
    if (!lang || typeof lang.id !== "string" || !ID_PATTERN.test(lang.id)) {
      throw new Error(
        `defineLanguages: invalid language id ${JSON.stringify(lang?.id)}. Use codes such as "es" or "pt-BR".`
      );
    }
    if (typeof lang.title !== "string" || lang.title.trim() === "") {
      throw new Error(`defineLanguages: language "${lang.id}" needs a title`);
    }
    if (seen.has(lang.id)) {
      throw new Error(`defineLanguages: language "${lang.id}" is listed twice`);
    }
    seen.add(lang.id);
  }
  const marked = given.filter((l) => l.default === true);
  if (marked.length > 1) {
    throw new Error(
      `defineLanguages: only one language can be the default, got ${marked.map((l) => l.id).join(", ")}`
    );
  }
  let list = given.map((l) => ({ ...l, default: false }));
  let defaultLanguage;
  if (marked.length === 1) {
    defaultLanguage = { ...marked[0], default: true };
  } else {
    const english = list.find((l) => l.id === DEFAULT_LANGUAGE_ID);
    defaultLanguage = english ? { ...english, default: true } : { ...ENGLISH };
  }
  list = [
    defaultLanguage,
    ...list.filter((l) => l.id !== defaultLanguage.id)
  ];
  return { languages: list, defaultLanguage };
}
function languageFieldKey(id) {
  return id.replace(/-/g, "_");
}
function readEnabledLanguages(settingsDoc, languages, options = {}) {
  const config = defineLanguages(languages);
  const fieldName = options.fieldName ?? "languages";
  const raw = settingsDoc?.[fieldName];
  const flags = raw && typeof raw === "object" ? raw : {};
  return config.languages.filter((lang) => {
    if (lang.id === config.defaultLanguage.id) return true;
    return flags[languageFieldKey(lang.id)] === true;
  });
}
var LANGUAGES_GROUP = { name: "languages", title: "Languages" };
var SWITCH_NOTE = "Switching a language on publishes nothing by itself. Pages in this language appear on the site only once they have been translated and marked ready.";
function languagesField(options) {
  const config = defineLanguages(options.languages);
  const fieldName = options.fieldName ?? "languages";
  const group = options.group === void 0 ? LANGUAGES_GROUP.name : options.group;
  const fields = config.languages.map((lang) => {
    const isDefault = lang.id === config.defaultLanguage.id;
    return defineField({
      name: languageFieldKey(lang.id),
      title: lang.nativeTitle ?? lang.title,
      type: "boolean",
      initialValue: isDefault,
      readOnly: isDefault,
      description: isDefault ? `${lang.title} is the default language. Every translation is made from it, so it is always on.` : `${lang.title}. ${SWITCH_NOTE}`
    });
  });
  return defineField({
    name: fieldName,
    title: "Languages",
    type: "object",
    description: "Which languages this site offers. The default language is always on. " + SWITCH_NOTE,
    options: { collapsible: false },
    fields,
    ...group ? { group } : {}
  });
}
var TRANSLATION_STATUSES = [
  { title: "Draft", value: "draft" },
  { title: "Needs update", value: "needs-update" },
  { title: "Awaiting approval", value: "awaiting-approval" },
  { title: "Approved", value: "approved" }
];
var TRANSLATION_META_TYPE = "i18n.translationMeta";
var translationMetaType = defineType({
  name: TRANSLATION_META_TYPE,
  title: "Translation metadata",
  type: "document",
  __experimental_omnisearch_visibility: false,
  fields: [
    defineField({
      name: "language",
      title: "Language",
      type: "string",
      description: "Language id of the translated document, e.g. es.",
      validation: (rule) => rule.required()
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: { list: [...TRANSLATION_STATUSES], layout: "radio" },
      initialValue: "draft",
      validation: (rule) => rule.required()
    }),
    defineField({
      name: "sourceHash",
      title: "Source hash",
      type: "string",
      description: "Fingerprint of the source document when this translation was last made. A different fingerprint later means the translation needs an update."
    }),
    defineField({
      name: "legal",
      title: "Legal content",
      type: "boolean",
      description: "Legal or regulated copy that must be approved by a person before it goes live.",
      initialValue: false
    })
  ],
  preview: {
    select: { title: "language", subtitle: "status" }
  }
});

// src/sanity/plugin.ts
var I18N_PLUGIN_NAME = "kaleidico-i18n";
var i18nPlugin = definePlugin((config) => {
  const languages = defineLanguages(config.languages);
  return {
    name: I18N_PLUGIN_NAME,
    schema: {
      types: [translationMetaType]
    },
    // Not a Sanity option; harmless extra property that later parts read.
    ...{ i18n: { languages } }
  };
});

export { DEFAULT_LANGUAGE_ID, I18N_PLUGIN_NAME, LANGUAGES_GROUP, TRANSLATION_META_TYPE, TRANSLATION_STATUSES, defineLanguages, i18nPlugin, languageFieldKey, languagesField, readEnabledLanguages, translationMetaType };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map