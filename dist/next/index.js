import { jsx, jsxs } from 'react/jsx-runtime';

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
function sharedProjection(fields) {
  return fields.map((field) => `${groqString(field)}: coalesce(${field}, ${I18N_FIELD}.source->${field})`).join(", ");
}
function translationLinks(options = {}) {
  const slugField = options.slugField ?? "slug";
  const defaultId = options.defaultId ?? DEFAULT_LANGUAGE_ID;
  const sourceId = `coalesce(^.${I18N_FIELD}.source._ref, ^._id)`;
  return [
    `"language": coalesce(${LANGUAGE_FIELD}, ${groqString(defaultId)})`,
    `"translations": *[_type == ${groqString(TRANSLATION_META_TYPE)} && _id == ${groqString(TRANSLATION_META_ID_PREFIX)} + ${sourceId}][0].translations[]{ language, "slug": document->${slugField}.current, "status": document->${I18N_FIELD}.status }`
  ].join(", ");
}

// src/next/routing.ts
var ALWAYS_EXCLUDED = ["/api", "/_next", "/studio"];
var FILE_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
function firstSegment(pathname) {
  const rest = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}
function stripPrefix(pathname, id) {
  const stripped = pathname.slice(id.length + 1);
  return stripped === "" ? "/" : stripped;
}
function hasPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}
function isExcludedPath(pathname, exclude = []) {
  if (FILE_EXTENSION.test(pathname)) return true;
  for (const rule of [...ALWAYS_EXCLUDED, ...exclude]) {
    if (typeof rule === "string") {
      if (hasPrefix(pathname, rule)) return true;
    } else if (rule.test(pathname)) {
      return true;
    }
  }
  return false;
}
function resolveLanguageIds(input, defaultId) {
  if (Array.isArray(input) && input.every((l) => typeof l === "string")) {
    const ids = input;
    const def = defaultId ?? "en";
    return { ids: ids.includes(def) ? ids : [def, ...ids], defaultId: def };
  }
  const config = defineLanguages(input);
  return { ids: config.languages.map((l) => l.id), defaultId: defaultId ?? config.defaultLanguage.id };
}
function resolveLocaleRoute(pathname, options) {
  const { ids, defaultId, exclude = [] } = options;
  if (isExcludedPath(pathname, exclude)) return { kind: "pass" };
  const segment = firstSegment(pathname);
  if (segment === defaultId) {
    return { kind: "redirect", pathname: stripPrefix(pathname, defaultId), status: 308 };
  }
  if (ids.includes(segment)) return { kind: "pass" };
  return { kind: "rewrite", pathname: pathname === "/" ? `/${defaultId}` : `/${defaultId}${pathname}` };
}

// src/next/alternates.ts
var DEFAULT_REGIONS = {
  en: "US",
  es: "US"
};
function languageTag(lang, region) {
  if (lang.includes("-")) return lang;
  const r = region ?? DEFAULT_REGIONS[lang];
  return r ? `${lang}-${r}` : lang;
}
function inLanguage(lang, region) {
  return languageTag(lang, region);
}
function localePath(lang, path, defaultId = DEFAULT_LANGUAGE_ID) {
  const clean = path === "" ? "/" : path.startsWith("/") ? path : `/${path}`;
  if (lang === defaultId) return clean;
  return clean === "/" ? `/${lang}` : `/${lang}${clean}`;
}
function localeUrl(siteUrl, lang, path, defaultId = DEFAULT_LANGUAGE_ID) {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}${localePath(lang, path, defaultId)}`;
}
function buildAlternates(options) {
  const defaultId = options.defaultId ?? DEFAULT_LANGUAGE_ID;
  const paths = {};
  for (const [id, path] of Object.entries(options.translations ?? {})) {
    if (typeof path === "string" && path !== "") paths[id] = path;
  }
  paths[options.lang] = options.path;
  const languages = {};
  const ordered = [
    ...defaultId in paths ? [defaultId] : [],
    ...Object.keys(paths).filter((id) => id !== defaultId).sort()
  ];
  for (const id of ordered) {
    languages[languageTag(id)] = localeUrl(options.siteUrl, id, paths[id], defaultId);
  }
  const xDefault = defaultId in paths ? paths[defaultId] : options.path;
  languages["x-default"] = localeUrl(options.siteUrl, defaultId in paths ? defaultId : options.lang, xDefault, defaultId);
  return {
    canonical: localeUrl(options.siteUrl, options.lang, options.path, defaultId),
    languages
  };
}
function openGraphLocale(lang, others = [], region) {
  const toOg = (id) => languageTag(id, region).replace("-", "_");
  const alternateLocale = others.filter((id) => id !== lang).map(toOg);
  return alternateLocale.length > 0 ? { locale: toOg(lang), alternateLocale } : { locale: toOg(lang) };
}

// src/next/dictionary.ts
var PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;
function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(
    PLACEHOLDER,
    (match, name) => name in vars ? String(vars[name]) : match
  );
}
function createDictionary(input, options = {}) {
  const languages = Object.keys(input);
  if (languages.length === 0) {
    throw new Error("createDictionary: at least one language is required");
  }
  const defaultId = options.defaultId ?? (languages.includes("en") ? "en" : languages[0]);
  const base = input[defaultId];
  if (!base) {
    throw new Error(`createDictionary: no strings for the default language "${defaultId}"`);
  }
  const keys = Object.keys(base);
  for (const lang of languages) {
    const missing = keys.filter((key) => typeof input[lang][key] !== "string");
    if (missing.length > 0) {
      throw new Error(`createDictionary: language "${lang}" is missing ${missing.length} key(s): ${missing.join(", ")}`);
    }
  }
  const strings = (lang) => input[lang] ?? base;
  const t = (lang, key, vars) => {
    const value = strings(lang)[key] ?? base[key];
    if (typeof value !== "string") {
      throw new Error(`createDictionary: unknown key "${String(key)}"`);
    }
    return interpolate(value, vars);
  };
  return {
    languages,
    defaultId,
    keys,
    has: (lang) => lang in input,
    t,
    for: (lang) => (key, vars) => t(lang, key, vars)
  };
}
function switcherHref(id, links, homeHrefs) {
  const link = links?.[id];
  if (typeof link === "string" && link !== "") return link;
  return homeHrefs[id];
}
function LanguageSwitcher(props) {
  const {
    current,
    languages,
    links,
    homeHrefs,
    labels,
    showCurrent = false,
    className,
    listClassName,
    itemClassName,
    linkClassName,
    currentClassName,
    prefix
  } = props;
  const items = languages.filter((l) => showCurrent || l.id !== current).map((l) => ({ language: l, href: l.id === current ? void 0 : switcherHref(l.id, links, homeHrefs) })).filter((item) => item.language.id === current || item.href);
  if (languages.length < 2 || items.length === 0) return null;
  return /* @__PURE__ */ jsx("nav", { "aria-label": labels.ariaLabel, "data-i18n-switcher": true, className, children: /* @__PURE__ */ jsx("ul", { className: listClassName, children: items.map(({ language, href }) => {
    const name = language.nativeTitle ?? language.title;
    const isCurrent = language.id === current;
    return /* @__PURE__ */ jsx("li", { className: itemClassName, children: isCurrent || !href ? /* @__PURE__ */ jsxs("span", { lang: language.id, "aria-current": "true", className: currentClassName, children: [
      prefix,
      name
    ] }) : /* @__PURE__ */ jsxs("a", { href, lang: language.id, hrefLang: language.id, className: linkClassName, children: [
      prefix,
      name
    ] }) }, language.id);
  }) }) });
}

export { DEFAULT_LANGUAGE_ID, I18N_FIELD, LANGUAGE_FIELD, LanguageSwitcher, TRANSLATION_META_ID_PREFIX, TRANSLATION_META_TYPE, TRANSLATION_STATUSES, buildAlternates, createDictionary, defineLanguages, inLanguage, interpolate, isExcludedPath, languageFieldKey, languageTag, localeFilter, localePath, localeUrl, openGraphLocale, readEnabledLanguages, resolveLanguageIds, resolveLocaleRoute, sharedProjection, switcherHref, translationLinks, translationMetaId, translationStatusLabel };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map