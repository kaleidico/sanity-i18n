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

// src/core/translations.ts
var TRANSLATION_STATUSES = [
  { title: "Draft", value: "draft" },
  { title: "Needs update", value: "needs_update" },
  { title: "Awaiting approval", value: "awaiting_approval" },
  { title: "Approved", value: "approved" }
];
function translationStatusLabel(status, labels) {
  if (!status) return labels?.draft ?? "Draft";
  const found = TRANSLATION_STATUSES.find((s) => s.value === status);
  if (!found) return status;
  return labels?.[found.value] ?? found.title;
}
var TRANSLATION_META_TYPE = "i18n.translationMeta";
var TRANSLATION_META_ID_PREFIX = "i18n.meta.";
function translationMetaId(sourceId) {
  const published = sourceId.startsWith("drafts.") ? sourceId.slice("drafts.".length) : sourceId;
  return TRANSLATION_META_ID_PREFIX + published;
}
var LANGUAGE_FIELD = "language";
var I18N_FIELD = "i18n";
function groqString(value) {
  return JSON.stringify(value);
}
function localeFilter(lang, defaultId = DEFAULT_LANGUAGE_ID) {
  if (lang === defaultId) {
    return `(${LANGUAGE_FIELD} == ${groqString(lang)} || !defined(${LANGUAGE_FIELD}))`;
  }
  return `${LANGUAGE_FIELD} == ${groqString(lang)}`;
}
function sharedProjection(fields) {
  return fields.map((field) => `${groqString(field)}: coalesce(${field}, ${I18N_FIELD}.source->${field})`).join(", ");
}
function translationLinks(options = {}) {
  const slugField = options.slugField ?? "slug";
  const defaultId = options.defaultId ?? DEFAULT_LANGUAGE_ID;
  const sourceId = `coalesce(^.${I18N_FIELD}.source._ref, ^._id)`;
  return [
    `"language": coalesce(${LANGUAGE_FIELD}, ${groqString(defaultId)})`,
    `"translations": *[_type == ${groqString(TRANSLATION_META_TYPE)} && _id == ${groqString(TRANSLATION_META_ID_PREFIX)} + ${sourceId}][0].translations[]{ language, "slug": document->${slugField}.current }`
  ].join(", ");
}

// src/next/index.ts
function defineI18nRoutes(_config) {
  throw new Error(
    "@kaleidico/sanity-i18n/next: defineI18nRoutes() is not implemented until part 3 (locale routing)."
  );
}

export { DEFAULT_LANGUAGE_ID, I18N_FIELD, LANGUAGE_FIELD, TRANSLATION_META_ID_PREFIX, TRANSLATION_META_TYPE, TRANSLATION_STATUSES, defineI18nRoutes, defineLanguages, languageFieldKey, localeFilter, readEnabledLanguages, sharedProjection, translationLinks, translationMetaId, translationStatusLabel };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map