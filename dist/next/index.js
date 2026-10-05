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

// src/core/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const paddedLength = bytes.length + 9 + 63 >> 6 << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const h = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = hh + s1 + ch + K[i] + w[i] >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = s0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, "0");
  return out;
}

// src/core/legal.ts
var LEGAL_APPROVAL_ID_PREFIX = "i18n-legal-";
function normaliseLegalText(text3) {
  return text3.replace(/\s+/g, " ").trim();
}
function legalSourceHash(text3) {
  return sha256Hex(normaliseLegalText(text3));
}
function legalApprovalId(language, sourceHash) {
  return `${LEGAL_APPROVAL_ID_PREFIX}${language}-${sourceHash.slice(0, 12)}`;
}

// src/core/forms.ts
var FORM_TEXT_SETTINGS = ["submitButtonText", "nextButtonText", "backButtonText", "successMessage"];
var FORM_FIELD_TEXT_KEYS = ["label", "placeholder", "helpText", "tooltip", "heading", "description", "stepLabel", "consentText", "content"];
var CONSENT_FIELD_TYPE = "consentField";
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasValue(value) {
  if (value === null || value === void 0) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
function formFieldName(field) {
  const name = typeof field.name === "string" ? field.name.trim() : "";
  if (name !== "") return name;
  const label = typeof field.label === "string" ? field.label.toLowerCase().replace(/[^a-z0-9]+/g, "_") : "";
  return label !== "" ? label : `field_${String(field._key ?? "")}`;
}
function portableTextToPlain(value) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  const blocks = [];
  for (const block of value) {
    if (!isObject(block)) continue;
    const children = Array.isArray(block.children) ? block.children : [];
    const text3 = children.map((child) => isObject(child) && typeof child.text === "string" ? child.text : "").join("");
    if (text3.trim() !== "") blocks.push(text3.trim());
  }
  return blocks.join("\n\n");
}
function slugOf(doc) {
  const slug = doc.slug;
  if (typeof slug === "string") return slug;
  if (isObject(slug) && typeof slug.current === "string") return slug.current;
  return null;
}
function localizeOptions(source, translated) {
  if (!Array.isArray(source)) return source;
  const list = Array.isArray(translated) ? translated.filter(isObject) : [];
  return source.map((option, index) => {
    if (!isObject(option)) return option;
    const match = list.find((o) => typeof o._key === "string" && o._key === option._key) ?? (list.length === source.length ? list[index] : void 0);
    const label = match && hasValue(match.label) ? match.label : option.label;
    return { ...option, label };
  });
}
function localizeForm(source, translation, options = {}) {
  const textSettings = options.textSettings ?? FORM_TEXT_SETTINGS;
  const textKeys = options.textKeys ?? FORM_FIELD_TEXT_KEYS;
  const defaultId = options.defaultId ?? "en";
  const translatedFields = Array.isArray(translation?.fields) ? translation.fields.filter(isObject) : [];
  const byKey = new Map(translatedFields.filter((f) => typeof f._key === "string").map((f) => [f._key, f]));
  const fields = (Array.isArray(source.fields) ? source.fields : []).map((field) => {
    if (!isObject(field)) return field;
    const out = { ...field };
    const hasName = typeof field.name === "string" || typeof field.label === "string";
    if (hasName) out.name = formFieldName(field);
    const translated = typeof field._key === "string" ? byKey.get(field._key) : void 0;
    if (!translated) return out;
    for (const key of textKeys) {
      if (hasValue(translated[key])) out[key] = translated[key];
    }
    if (Array.isArray(field.options)) out.options = localizeOptions(field.options, translated.options);
    return out;
  });
  const sourceSettings = isObject(source.settings) ? source.settings : {};
  const translatedSettings = isObject(translation?.settings) ? translation.settings : {};
  const settings = { ...sourceSettings };
  for (const key of textSettings) {
    if (hasValue(translatedSettings[key])) settings[key] = translatedSettings[key];
  }
  const shown = translation ?? source;
  const language = translation && typeof translation[LANGUAGE_FIELD] === "string" ? translation[LANGUAGE_FIELD] : defaultId;
  return {
    ...source,
    title: translation && hasValue(translation.title) ? translation.title : source.title,
    fields,
    settings,
    i18nForm: {
      language,
      documentId: String(shown._id ?? ""),
      revision: typeof shown._rev === "string" ? shown._rev : null,
      sourceId: String(source._id ?? ""),
      sourceSlug: slugOf(source)
    }
  };
}
function isVisible(field, data) {
  const target = typeof field.conditionalField === "string" ? field.conditionalField : "";
  if (target === "") return true;
  const value = data[target];
  const compare = field.conditionalValue;
  switch (field.conditionalOperator) {
    case "equals":
      return String(value) === String(compare);
    case "not_equals":
      return String(value) !== String(compare);
    case "contains":
      return String(value ?? "").includes(String(compare ?? ""));
    case "is_empty":
      return !value;
    case "is_not_empty":
      return !!value;
    default:
      return true;
  }
}
function shownConsent(field) {
  return hasValue(field.consentText) ? { key: "consentText", value: field.consentText } : { key: "label", value: field.label };
}
function recordedApprovalIds(shown, fieldKey, part) {
  const legal = shown[I18N_FIELD]?.legal;
  const paths = Array.isArray(legal?.paths) ? legal.paths : [];
  const prefix = `fields[_key==${JSON.stringify(fieldKey)}].${part}`;
  const mine = paths.filter((p) => typeof p.path === "string" && (p.path === prefix || p.path.startsWith(`${prefix}[`)));
  return {
    ids: mine.map((p) => String(p.unitId ?? "")).filter((id) => id !== ""),
    approved: mine.length > 0 && mine.every((p) => p.status === "approved")
  };
}
function buildConsentRecords(input) {
  const defaultId = input.defaultId ?? "en";
  const isDefault = input.language === defaultId;
  const shownFields = Array.isArray(input.shown.fields) ? input.shown.fields.filter(isObject) : [];
  const shownByKey = new Map(shownFields.filter((f) => typeof f._key === "string").map((f) => [f._key, f]));
  const records = [];
  for (const field of Array.isArray(input.source.fields) ? input.source.fields : []) {
    if (!isObject(field) || field._type !== CONSENT_FIELD_TYPE) continue;
    if (!isVisible(field, input.data)) continue;
    const name = formFieldName(field);
    const key = typeof field._key === "string" ? field._key : "";
    const shownField = shownByKey.get(key) ?? field;
    const part = shownConsent(shownField);
    const wording = hasValue(part.value) ? part : shownConsent(field);
    const textAsShown = portableTextToPlain(wording.value);
    let ids = [];
    if (!isDefault) {
      ids = recordedApprovalIds(input.shown, key, wording.key).ids;
      if (ids.length === 0) {
        const english = shownConsent(field);
        const blocks = Array.isArray(english.value) ? english.value.map((b) => portableTextToPlain([b])) : [portableTextToPlain(english.value)];
        ids = blocks.filter((text3) => normaliseLegalText(text3) !== "").map((text3) => legalApprovalId(input.language, legalSourceHash(text3)));
      }
    }
    records.push({
      field: name,
      checked: input.data[name] === true || input.data[name] === "true" || input.data[name] === "on" || input.data[name] === 1,
      textAsShown,
      language: input.language,
      legalApprovalId: ids[0] ?? null,
      legalApprovalIds: ids
    });
  }
  return records;
}
function consentText(records) {
  return records.map((r) => r.textAsShown).filter((text3) => text3 !== "").join("\n\n");
}
function submissionWebhookFields(language, records) {
  return { language, consent_text: consentText(records) };
}
function consentWordingApproved(shown) {
  const fields = Array.isArray(shown.fields) ? shown.fields.filter(isObject) : [];
  return fields.filter((f) => f._type === CONSENT_FIELD_TYPE && typeof f._key === "string").every((f) => recordedApprovalIds(shown, f._key, shownConsent(f).key).approved);
}
function optionLabel(field, value) {
  const options = Array.isArray(field.options) ? field.options.filter(isObject) : [];
  const match = options.find((o) => o.value === value);
  return match && typeof match.label === "string" && match.label !== "" ? match.label : String(value ?? "");
}

// src/core/hosts.ts
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function normaliseHostPatterns(patterns) {
  const out = [];
  for (const raw of patterns ?? []) {
    let host = text(raw).toLowerCase();
    if (host === "") continue;
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\/\//, "");
    host = host.split(/[/?#]/)[0].replace(/:\d+$/, "");
    if (host !== "" && !out.includes(host)) out.push(host);
  }
  return out;
}
function linkHost(href, base) {
  const value = text(href);
  if (value === "") return null;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
  if (!absolute && !base) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}
function hostMatches(host, pattern) {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}
function matchesApplyHost(href, patterns, base) {
  const host = linkHost(href, base);
  if (!host) return false;
  return patterns.some((pattern) => hostMatches(host, pattern));
}

// src/core/applyNotice.ts
var APPLY_NOTICE_FIELD = "i18nApplyNotice";
function isObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text2(value) {
  return typeof value === "string" ? value.trim() : "";
}
function approvalOf(approvals, id) {
  if (!approvals) return void 0;
  return approvals instanceof Map ? approvals.get(id) : approvals[id];
}
function resolveApplyNotice(input) {
  const defaultId = input.defaultId ?? "en";
  const fieldName = input.fieldName ?? APPLY_NOTICE_FIELD;
  if (input.lang === defaultId) return { state: "off", hosts: [], reason: "Default-language pages never show the notice." };
  const base = input.base ?? {};
  if (base.enabled === false) return { state: "off", hosts: [], reason: "The notice is switched off in Site Settings." };
  const listed = normaliseHostPatterns(base.appliesTo);
  const hosts = listed.length > 0 ? listed : normaliseHostPatterns(input.defaultAppliesTo);
  if (hosts.length === 0) return { state: "off", hosts: [], reason: "The notice applies to no host." };
  const blocked = (reason) => ({ state: "blocked", hosts, reason });
  const local = input.local;
  if (!isObject2(local)) return blocked("There is no approved Site Settings translation in this language.");
  const i18n = isObject2(local[I18N_FIELD]) ? local[I18N_FIELD] : {};
  if (i18n.status !== "approved") return blocked("The Site Settings translation in this language is not approved.");
  const value = isObject2(local[fieldName]) ? local[fieldName] : {};
  const body = text2(value.body);
  if (body === "") return blocked("The notice has no wording in this language.");
  const legal = isObject2(i18n.legal) ? i18n.legal : {};
  const paths = Array.isArray(legal.paths) ? legal.paths : [];
  const record = paths.find((p) => p.path === `${fieldName}.body`);
  if (!record || record.status !== "approved") return blocked("The notice wording in this language has not been approved.");
  const entry = approvalOf(input.approvals, String(record.unitId ?? ""));
  if (!entry || entry.status !== "approved") return blocked("The approval for the notice wording in this language is missing or no longer stands.");
  if (normaliseLegalText(text2(entry.translatedText)) !== normaliseLegalText(body)) return blocked("The notice wording in this language differs from the approved wording.");
  const title = text2(value.title);
  const continueLabel = text2(value.continueLabel);
  const cancelLabel = text2(value.cancelLabel);
  if (title === "" || continueLabel === "" || cancelLabel === "") return blocked("The notice is missing its title or a button label in this language.");
  return { state: "active", hosts, notice: { title, body, continueLabel, cancelLabel }, reason: "The notice wording in this language is approved." };
}
function applyNoticeHideCss(hosts) {
  const selectors = [];
  for (const pattern of normaliseHostPatterns(hosts)) {
    if (!/^[a-z0-9.*-]+$/.test(pattern)) continue;
    if (pattern.startsWith("*.")) {
      const tail = pattern.slice(1);
      selectors.push(`a[href*="${tail}" i]`);
    } else {
      for (const scheme of ["https://", "http://", "//"]) {
        selectors.push(`a[href^="${scheme}${pattern}/" i]`, `a[href="${scheme}${pattern}" i]`, `a[href^="${scheme}${pattern}?" i]`, `a[href^="${scheme}${pattern}#" i]`, `a[href^="${scheme}${pattern}:" i]`);
      }
    }
  }
  return selectors.length > 0 ? `${selectors.join(",")}{display:none!important}` : "";
}

export { APPLY_NOTICE_FIELD, CONSENT_FIELD_TYPE, DEFAULT_LANGUAGE_ID, FORM_FIELD_TEXT_KEYS, FORM_TEXT_SETTINGS, I18N_FIELD, LANGUAGE_FIELD, LanguageSwitcher, TRANSLATION_META_ID_PREFIX, TRANSLATION_META_TYPE, TRANSLATION_STATUSES, applyNoticeHideCss, buildAlternates, buildConsentRecords, consentText, consentWordingApproved, createDictionary, defineLanguages, formFieldName, hostMatches, inLanguage, interpolate, isExcludedPath, languageFieldKey, languageTag, linkHost, localeFilter, localePath, localeUrl, localizeForm, matchesApplyHost, normaliseHostPatterns, openGraphLocale, optionLabel, portableTextToPlain, readEnabledLanguages, resolveApplyNotice, resolveLanguageIds, resolveLocaleRoute, sharedProjection, submissionWebhookFields, switcherHref, translationLinks, translationMetaId, translationStatusLabel };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map