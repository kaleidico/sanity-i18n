import { definePlugin, defineType, defineField } from 'sanity';

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
function translationStatusList(labels) {
  return TRANSLATION_STATUSES.map((s) => ({
    value: s.value,
    title: labels?.[s.value] ?? s.title
  }));
}
function translationStatusLabel(status, labels) {
  if (!status) return labels?.draft ?? "Draft";
  const found = TRANSLATION_STATUSES.find((s) => s.value === status);
  if (!found) return status;
  return labels?.[found.value] ?? found.title;
}
var TRANSLATION_META_TYPE = "i18n.translationMeta";
var TRANSLATION_META_ID_PREFIX = "i18n-meta-";
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
var I18N_MARKER = "__i18n";
function documentLanguage(document) {
  const value = document?.[LANGUAGE_FIELD];
  return typeof value === "string" && value !== "" ? value : void 0;
}
function isTranslationDocument(document, defaultId = DEFAULT_LANGUAGE_ID) {
  const lang = documentLanguage(document);
  return lang !== void 0 && lang !== defaultId;
}
function resolveConditional(prop, ctx) {
  if (typeof prop === "function") return Boolean(prop(ctx));
  return Boolean(prop);
}
function sharedNote(defaultTitle) {
  return `Shared with the ${defaultTitle} document; edit it there.`;
}
function translatable(documentType, options = {}) {
  const config = defineLanguages(
    options.languages ?? [{ id: DEFAULT_LANGUAGE_ID, title: "English", nativeTitle: "English", default: true }]
  );
  const defaultId = config.defaultLanguage.id;
  const defaultTitle = config.defaultLanguage.title;
  const sharedFields = [...options.sharedFields ?? []];
  const slugField = options.slugField ?? "slug";
  const labels = options.labels;
  const isTranslation = (ctx) => isTranslationDocument(ctx.document, defaultId);
  const isDefault = (ctx) => !isTranslation(ctx);
  const languageField = defineField({
    name: LANGUAGE_FIELD,
    title: "Language",
    type: "string",
    initialValue: defaultId,
    readOnly: true,
    hidden: options.hideLanguageOnDefault ? isDefault : false,
    description: `The language this document is written in. ${defaultTitle} documents are the source every translation is made from.`,
    options: {
      list: config.languages.map((l) => ({ title: l.title, value: l.id })),
      layout: "dropdown"
    }
  });
  const i18nField = defineField({
    name: I18N_FIELD,
    title: "Translation",
    type: "object",
    hidden: isDefault,
    options: { collapsible: true, collapsed: false },
    fields: [
      defineField({
        name: "source",
        title: "Source document",
        type: "reference",
        to: [{ type: documentType.name }],
        weak: true,
        readOnly: true,
        description: `The ${defaultTitle} document this one is a translation of.`
      }),
      defineField({
        name: "status",
        title: "Status",
        type: "string",
        options: { list: translationStatusList(labels), layout: "radio" },
        initialValue: "draft",
        hidden: isDefault,
        description: "Draft: not yet ready. Needs update: the source changed since this was translated. Awaiting approval: legal text is waiting for a person to approve it. Approved: live."
      }),
      defineField({
        name: "sourceHash",
        title: "Source fingerprint",
        type: "string",
        hidden: true,
        description: "Fingerprint of the source document when this translation was last made."
      }),
      defineField({ name: "translatedAt", title: "Translated at", type: "datetime", readOnly: true }),
      defineField({ name: "approvedAt", title: "Approved at", type: "datetime", readOnly: true }),
      defineField({ name: "approvedBy", title: "Approved by", type: "string", readOnly: true })
    ]
  });
  const fields = (documentType.fields ?? []).map((field) => {
    let next = field;
    if (sharedFields.includes(next.name)) {
      const existing = next.readOnly;
      const note = sharedNote(defaultTitle);
      next = {
        ...next,
        readOnly: (ctx) => isTranslation(ctx) || resolveConditional(existing, ctx),
        description: next.description ? `${next.description} ${note}` : note
      };
    }
    if (next.name === slugField && next.type === "slug") {
      const slugDef = next;
      const isUnique = async (slug, context) => {
        const doc = context.document;
        const language = documentLanguage(doc) ?? defaultId;
        const id = String(doc?._id ?? "");
        const published = id.replace(/^drafts\./, "");
        const client = context.getClient({ apiVersion: "2024-01-01" });
        const count = await client.fetch(
          `count(*[_type == $type && ${slugField}.current == $slug && ${localeFilter(language, defaultId)} && !(_id in [$draft, $published])])`,
          { type: documentType.name, slug, draft: `drafts.${published}`, published }
        );
        return count === 0;
      };
      next = { ...slugDef, options: { ...slugDef.options ?? {}, isUnique } };
    }
    return next;
  });
  const preview = withTranslationPreview(documentType.preview, defaultId, labels);
  const marker = { sharedFields, slugField, defaultLanguage: defaultId };
  return {
    ...documentType,
    fields: [languageField, i18nField, ...fields],
    preview,
    [I18N_MARKER]: marker
  };
}
function withTranslationPreview(preview, defaultId, labels) {
  const LANG_KEY = "__i18nLanguage";
  const STATUS_KEY = "__i18nStatus";
  const select = {
    ...preview?.select ?? (preview ? {} : { title: "title" }),
    [LANG_KEY]: LANGUAGE_FIELD,
    [STATUS_KEY]: `${I18N_FIELD}.status`
  };
  const original = preview?.prepare;
  return {
    ...preview ?? {},
    select,
    prepare: (value, viewOptions) => {
      const { [LANG_KEY]: lang, [STATUS_KEY]: status, ...rest } = value ?? {};
      const base = original ? original(rest, viewOptions) : { title: rest.title, subtitle: rest.subtitle };
      if (typeof lang !== "string" || lang === "" || lang === defaultId) return base;
      const tag = `${lang.toUpperCase()} \xB7 ${translationStatusLabel(status, labels)}`;
      const subtitle = base?.subtitle ? `${tag} \xB7 ${base.subtitle}` : tag;
      return { ...base, subtitle };
    }
  };
}
function getSharedFields(typeDef) {
  const marker = getTranslatableMarker(typeDef);
  return marker ? [...marker.sharedFields] : [];
}
function getTranslatableMarker(typeDef) {
  if (!typeDef || typeof typeDef !== "object") return void 0;
  const marker = typeDef[I18N_MARKER];
  if (!marker || typeof marker !== "object") return void 0;
  const m = marker;
  return {
    sharedFields: Array.isArray(m.sharedFields) ? [...m.sharedFields] : [],
    slugField: typeof m.slugField === "string" ? m.slugField : "slug",
    defaultLanguage: typeof m.defaultLanguage === "string" ? m.defaultLanguage : DEFAULT_LANGUAGE_ID
  };
}
function isTranslatable(typeDef) {
  return getTranslatableMarker(typeDef) !== void 0;
}

// src/sanity/legal.ts
var LEGAL_NOTE = "(legal text: needs approval before it goes live in another language)";
function withLegalMark(def) {
  const description = typeof def.description === "string" && def.description.trim() !== "" ? `${def.description} ${LEGAL_NOTE}` : LEGAL_NOTE;
  const options = def.options ?? {};
  return {
    ...def,
    description,
    options: {
      ...options,
      i18n: { ...options.i18n ?? {}, legal: true }
    }
  };
}
function legalText(fieldDef) {
  return withLegalMark(fieldDef);
}
function legalBlock(blockTypeDef) {
  return withLegalMark(blockTypeDef);
}
function isLegal(schemaTypeOrField) {
  if (!schemaTypeOrField || typeof schemaTypeOrField !== "object") return false;
  const options = schemaTypeOrField.options;
  return options?.i18n?.legal === true;
}
function collectLegalPaths(documentTypeDef, options = {}) {
  const registry = /* @__PURE__ */ new Map();
  for (const t of options.types ?? []) {
    if (t && typeof t.name === "string") registry.set(t.name, t);
  }
  const out = [];
  walkFields(documentTypeDef.fields ?? [], "", registry, out, false);
  return out;
}
function resolve(member, registry) {
  if (member.fields || !member.type) return member;
  const named = registry.get(member.type);
  return named ? { ...named, ...member, options: { ...named.options ?? {}, ...member.options ?? {} } } : member;
}
function walkFields(fields, prefix, registry, out, insideArray) {
  for (const field of fields) {
    if (!field || typeof field.name !== "string") continue;
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const resolved = resolve(field, registry);
    if (isLegal(field) || resolved !== field && isLegal(resolved)) {
      out.push(path);
      continue;
    }
    if (Array.isArray(resolved.fields)) {
      walkFields(resolved.fields, path, registry, out, insideArray);
      continue;
    }
    if (!insideArray && Array.isArray(resolved.of)) {
      for (const member of resolved.of) {
        if (!member || typeof member !== "object") continue;
        const memberResolved = resolve(member, registry);
        const memberName = typeof member.name === "string" ? member.name : typeof member.type === "string" && member.type !== "object" ? member.type : "";
        const memberPath = `${path}[${memberName}]`;
        if (isLegal(member) || memberResolved !== member && isLegal(memberResolved)) {
          out.push(memberPath);
          continue;
        }
        if (Array.isArray(memberResolved.fields)) {
          walkFields(memberResolved.fields, memberPath, registry, out, true);
        }
      }
    }
  }
}
function translationMetaType(options) {
  const to = options.translatableTypes.map((type) => ({ type }));
  if (to.length === 0) {
    throw new Error("translationMetaType: translatableTypes must list at least one document type");
  }
  return defineType({
    name: TRANSLATION_META_TYPE,
    title: "Translation metadata",
    type: "document",
    __experimental_omnisearch_visibility: false,
    fields: [
      defineField({
        name: "sourceType",
        title: "Source type",
        type: "string",
        description: "Schema type of the source document, e.g. page.",
        readOnly: true,
        validation: (rule) => rule.required()
      }),
      defineField({
        name: "translations",
        title: "Translations",
        type: "array",
        readOnly: true,
        of: [
          {
            type: "object",
            name: "translation",
            fields: [
              defineField({ name: "language", title: "Language", type: "string", validation: (rule) => rule.required() }),
              defineField({ name: "document", title: "Document", type: "reference", to, weak: true })
            ],
            preview: { select: { title: "language", subtitle: "document._ref" } }
          }
        ]
      })
    ],
    preview: {
      select: { title: "sourceType", translations: "translations" },
      prepare: ({ title, translations }) => ({
        title: title ? `Translations of a ${title}` : "Translations",
        subtitle: Array.isArray(translations) ? translations.map((t) => t?.language).filter(Boolean).join(", ") : void 0
      })
    }
  });
}

// src/sanity/badge.ts
var TRANSLATION_BADGE_COLORS = {
  draft: void 0,
  needs_update: "danger",
  awaiting_approval: "warning",
  approved: "success"
};
function translationBadge(options = {}) {
  const defaultId = options.defaultId ?? DEFAULT_LANGUAGE_ID;
  const labels = options.labels;
  const TranslationBadge = (props) => {
    const doc = props.draft ?? props.published;
    const language = doc?.[LANGUAGE_FIELD];
    if (typeof language !== "string" || language === "") return null;
    if (language === defaultId) {
      return { label: language.toUpperCase(), title: "Source language" };
    }
    const i18n = doc?.[I18N_FIELD];
    const status = i18n?.status ?? "draft";
    const statusLabel = translationStatusLabel(status, labels);
    return {
      label: `${language.toUpperCase()} \xB7 ${statusLabel}`,
      title: `Translation status: ${statusLabel}`,
      color: TRANSLATION_BADGE_COLORS[status] ?? void 0
    };
  };
  return TranslationBadge;
}

// src/sanity/structure.ts
function languageFilter(languageId, defaultId = DEFAULT_LANGUAGE_ID) {
  return localeFilter(languageId, defaultId);
}
function translationsStructure(S, options) {
  const config = defineLanguages(options.languages);
  const defaultId = config.defaultLanguage.id;
  const title = options.title ?? "Translations";
  const others = config.languages.filter((l) => l.id !== defaultId);
  const typeTitle = (type) => options.titles?.[type] ?? type;
  return S.listItem().id("i18n-translations").title(title).child(
    S.list().id("i18n-translations-list").title(title).items(
      others.map(
        (lang) => S.listItem().id(`i18n-translations-${lang.id}`).title(lang.nativeTitle ? `${lang.title} (${lang.nativeTitle})` : lang.title).child(
          S.list().id(`i18n-translations-${lang.id}-types`).title(`${lang.title} translations`).items(
            options.types.map(
              (type) => S.listItem().id(`i18n-translations-${lang.id}-${type}`).title(typeTitle(type)).schemaType(type).child(
                S.documentTypeList(type).title(`${typeTitle(type)} (${lang.title})`).filter(`_type == $type && ${localeFilter(lang.id, defaultId)}`).params({ type })
              )
            )
          )
        )
      )
    )
  );
}
var I18N_PLUGIN_NAME = "kaleidico-i18n";
var i18nPlugin = definePlugin((config) => {
  const languages = defineLanguages(config.languages);
  const translatableTypes = [...config.translatableTypes ?? []];
  const badge = translationBadge({ defaultId: languages.defaultLanguage.id, labels: config.labels });
  return {
    name: I18N_PLUGIN_NAME,
    schema: {
      types: translatableTypes.length > 0 ? [translationMetaType({ translatableTypes })] : []
    },
    document: {
      badges: (prev, context) => translatableTypes.includes(context.schemaType) ? [...prev, badge] : prev
    },
    // Not a Sanity option; harmless extra property that later parts read.
    ...{ i18n: { languages, translatableTypes } }
  };
});

export { DEFAULT_LANGUAGE_ID, I18N_FIELD, I18N_MARKER, I18N_PLUGIN_NAME, LANGUAGES_GROUP, LANGUAGE_FIELD, LEGAL_NOTE, TRANSLATION_BADGE_COLORS, TRANSLATION_META_ID_PREFIX, TRANSLATION_META_TYPE, TRANSLATION_STATUSES, collectLegalPaths, defineLanguages, getSharedFields, getTranslatableMarker, i18nPlugin, isLegal, isTranslatable, isTranslationDocument, languageFieldKey, languageFilter, languagesField, legalBlock, legalText, readEnabledLanguages, translatable, translationBadge, translationMetaId, translationMetaType, translationStatusLabel, translationStatusList, translationsStructure };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map