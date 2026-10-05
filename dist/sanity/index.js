import { definePlugin, defineType, defineField, useClient, useSchema, useCurrentUser } from 'sanity';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { TranslateIcon, CheckmarkCircleIcon } from '@sanity/icons';
import { Flex, Spinner, Container, Stack, Heading, Text, Card, Box, Select, Checkbox, Button, TabList, Tab, TabPanel, Radio, TextArea, useToast, TextInput } from '@sanity/ui';
import { useRouter } from 'sanity/router';
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

// src/core/pricing.ts
var RATES_AS_OF = "2026-09-25";
var MODELS = [
  {
    id: "claude-opus-5-5",
    title: "Claude Opus 5.5",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 5,
    contextWindow: 1e6,
    maxOutputTokens: 128e3,
    effort: true,
    fallbacks: true,
    note: "Recommended."
  },
  {
    id: "claude-sonnet-5-5",
    title: "Claude Sonnet 5.5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
    contextWindow: 1e6,
    maxOutputTokens: 128e3,
    effort: true,
    fallbacks: true,
    note: "Half the cost of Opus."
  },
  {
    id: "claude-fable-5-1",
    title: "Claude Fable 5.1",
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadPerMTok: 0.25,
    cacheWritePerMTok: 12.5,
    contextWindow: 1e6,
    maxOutputTokens: 128e3,
    effort: true,
    fallbacks: true,
    note: "Most capable and most expensive. The Anthropic account must keep data for 30 days to use it."
  },
  {
    id: "claude-haiku-4-5",
    title: "Claude Haiku 4.5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    contextWindow: 2e5,
    maxOutputTokens: 64e3,
    effort: false,
    fallbacks: false,
    note: "Cheapest and fastest. Not advised for legal text."
  }
];
var DEFAULT_TRANSLATOR_MODEL = "claude-opus-5-5";
var DEFAULT_REVIEWER_MODEL = "claude-opus-5-5";

// src/core/engineModel.ts
var SECRETS_ID = "i18n.secrets";
var SECRETS_TYPE = "i18n.secrets";
var MANIFEST_ID = "i18n.manifest";
var MANIFEST_TYPE = "i18n.manifest";
var JOB_TYPE = "i18n.job";
var JOB_ID_PREFIX = "i18n.job.";
function jobId(uuid2) {
  return JOB_ID_PREFIX + uuid2;
}
var ENGINE_DOCUMENT_TYPES = [SECRETS_TYPE, MANIFEST_TYPE, JOB_TYPE];
var GLOSSARY_FIELD = "i18nGlossary";
var STYLE_GUIDE_FIELD = "i18nStyleGuide";
var ENGINE_FIELD = "i18nEngine";
var API_KEY_FIELD = "i18nApiKey";
var LEGAL_APPROVERS_FIELD = "i18nLegalApprovers";
var ENGINE_SETTINGS_FIELDS = [GLOSSARY_FIELD, STYLE_GUIDE_FIELD, ENGINE_FIELD, API_KEY_FIELD, LEGAL_APPROVERS_FIELD];
var DEFAULT_STYLE_GUIDE = { market: "es-US"};
var DEFAULT_ENGINE_SETTINGS = {
  translatorModel: DEFAULT_TRANSLATOR_MODEL,
  reviewerModel: DEFAULT_REVIEWER_MODEL};
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function readGlossary(settings, field = GLOSSARY_FIELD) {
  const raw = settings?.[field] ?? {};
  const doNotTranslate = Array.isArray(raw.doNotTranslate) ? [...new Set(raw.doNotTranslate.map(text).filter((t) => t !== ""))] : [];
  const terms = [];
  if (Array.isArray(raw.terms)) {
    for (const entry of raw.terms) {
      const e = entry ?? {};
      const source = text(e.source);
      const target = text(e.target);
      if (source === "" || target === "") continue;
      const note = text(e.note);
      terms.push(note ? { source, target, note } : { source, target });
    }
  }
  return { doNotTranslate, terms };
}
function readStyleGuide(settings, field = STYLE_GUIDE_FIELD) {
  const raw = settings?.[field] ?? {};
  return {
    market: text(raw.market) || DEFAULT_STYLE_GUIDE.market,
    register: raw.register === "tu" ? "tu" : "usted",
    audience: text(raw.audience),
    notes: text(raw.notes)
  };
}
function readEngineSettings(settings, field = ENGINE_FIELD) {
  const raw = settings?.[field] ?? {};
  return {
    translatorModel: text(raw.translatorModel) || DEFAULT_ENGINE_SETTINGS.translatorModel,
    reviewerModel: text(raw.reviewerModel) || DEFAULT_ENGINE_SETTINGS.reviewerModel,
    autoPublishMarketing: raw.autoPublishMarketing !== false
  };
}
function readLegalApprovers(settings, field = LEGAL_APPROVERS_FIELD) {
  const raw = settings?.[field];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => text(v).toLowerCase()).filter((v) => v !== ""))];
}
function isLegalApprover(email, approvers) {
  const normalised = text(email).toLowerCase();
  return normalised !== "" && approvers.includes(normalised);
}
function translationId(sourceId, language) {
  const published = sourceId.startsWith("drafts.") ? sourceId.slice("drafts.".length) : sourceId;
  return `${published}-${language}`;
}
function toSlug(input) {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}
function fromBase64(value) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
async function sha256Bytes(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function publicKeyFingerprint(publicKey) {
  return (await sha256Bytes(fromBase64(publicKey))).slice(0, 16);
}
async function encryptSecret(publicKey, secret) {
  const key = await globalThis.crypto.subtle.importKey(
    "spki",
    fromBase64(publicKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const encrypted = await globalThis.crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(secret));
  return toBase64(new Uint8Array(encrypted));
}

// src/core/paths.ts
function pathToString(segments) {
  let out = "";
  for (const segment of segments) {
    if (typeof segment === "string") out += out ? `.${segment}` : segment;
    else if (typeof segment === "number") out += `[${segment}]`;
    else out += `[_key==${JSON.stringify(segment._key)}]`;
  }
  return out;
}
var SEGMENT = /\[_key=="((?:[^"\\]|\\.)*)"\]|\[(\d+)\]|([^.[\]]+)/g;
function parsePath(path) {
  const segments = [];
  SEGMENT.lastIndex = 0;
  let match;
  while ((match = SEGMENT.exec(path)) !== null) {
    if (match[1] !== void 0) segments.push({ _key: JSON.parse(`"${match[1]}"`) });
    else if (match[2] !== void 0) segments.push(Number(match[2]));
    else if (match[3] !== void 0) segments.push(match[3]);
  }
  return segments;
}
function step(current, segment) {
  if (current === null || typeof current !== "object") return void 0;
  if (typeof segment === "string") {
    return Array.isArray(current) ? void 0 : current[segment];
  }
  if (!Array.isArray(current)) return void 0;
  if (typeof segment === "number") return current[segment];
  return current.find(
    (item) => item !== null && typeof item === "object" && item._key === segment._key
  );
}
function getAtPath(root, segments) {
  let current = root;
  for (const segment of segments) {
    current = step(current, segment);
    if (current === void 0) return void 0;
  }
  return current;
}
function setAtPath(root, segments, value) {
  if (segments.length === 0) return false;
  const parent = getAtPath(root, segments.slice(0, -1));
  const last = segments[segments.length - 1];
  if (parent === null || typeof parent !== "object") return false;
  if (typeof last === "string") {
    if (Array.isArray(parent)) return false;
    parent[last] = value;
    return true;
  }
  if (!Array.isArray(parent)) return false;
  if (typeof last === "number") {
    if (last < 0 || last >= parent.length) return false;
    parent[last] = value;
    return true;
  }
  const index = parent.findIndex(
    (item) => item !== null && typeof item === "object" && item._key === last._key
  );
  if (index === -1) return false;
  parent[index] = value;
  return true;
}

// src/core/manifest.ts
var CORE_TYPES = /* @__PURE__ */ new Set([
  "any",
  "array",
  "block",
  "boolean",
  "crossDatasetReference",
  "date",
  "datetime",
  "document",
  "email",
  "file",
  "geopoint",
  "globalDocumentReference",
  "image",
  "number",
  "object",
  "reference",
  "slug",
  "span",
  "string",
  "text",
  "url"
]);
var NEVER_TEXT_STRING_TYPES = ["url", "email", "date", "datetime"];
var NEVER_TEXT_OBJECT_TYPES = ["reference", "slug", "file", "geopoint", "crossDatasetReference", "globalDocumentReference"];
var IMAGE_SYSTEM_FIELDS = /* @__PURE__ */ new Set(["asset", "media", "hotspot", "crop"]);
var NON_TEXT_FIELD_NAME = /^(?:href|url|uri|link|src|path|icon|color|colour|id|anchor|className|variant|.*(?:Href|Url|URL|Uri|Link|Src|Path|Id|ID|Key|Icon|Color|Colour|Class|Token|Code|Slug))$/;
function chainNames(type) {
  const names = [];
  let current = type;
  let guard = 0;
  while (current && guard++ < 20) {
    if (typeof current.name === "string") names.push(current.name);
    current = current.type ?? null;
  }
  return names;
}
function extendsAny(type, bases) {
  const names = chainNames(type);
  return bases.some((base) => names.includes(base));
}
function i18nOption(type, key) {
  let current = type;
  let guard = 0;
  while (current && guard++ < 20) {
    const i18n = current.options?.i18n;
    if (i18n && typeof i18n[key] === "boolean") return i18n[key];
    current = current.type ?? null;
  }
  return void 0;
}
function hasList(type) {
  let current = type;
  let guard = 0;
  while (current && guard++ < 20) {
    const list = current.options?.list;
    if (Array.isArray(list) && list.length > 0) return true;
    current = current.type ?? null;
  }
  return false;
}
function namedType(type) {
  return chainNames(type.type).find((name) => !CORE_TYPES.has(name) && !name.startsWith("sanity."));
}
function buildFieldManifest(schema, documentTypes, options = {}) {
  const types = {};
  const building = /* @__PURE__ */ new Set();
  const withLegal = (node, legal) => legal ? { ...node, legal: true } : node;
  function walkNamed2(name) {
    if (types[name]) return true;
    if (building.has(name)) return true;
    const compiled = schema.get(name);
    if (!compiled) return false;
    building.add(name);
    const node = walkInline(compiled, void 0);
    building.delete(name);
    if (!node) return false;
    types[name] = node;
    return true;
  }
  function walk(type, fieldName) {
    const translate = i18nOption(type, "translate");
    if (translate === false) return null;
    const legal = i18nOption(type, "legal") === true;
    if (type.jsonType === "object" && !extendsAny(type, NEVER_TEXT_OBJECT_TYPES) && !extendsAny(type, ["image", "block"])) {
      const name = namedType(type);
      if (name && schema.get(name)) {
        return walkNamed2(name) ? withLegal({ kind: "ref", type: name }, legal) : null;
      }
    }
    return walkInline(type, fieldName);
  }
  function walkInline(type, fieldName) {
    const translate = i18nOption(type, "translate");
    if (translate === false) return null;
    const legal = i18nOption(type, "legal") === true;
    switch (type.jsonType) {
      case "string": {
        if (translate !== true) {
          if (extendsAny(type, NEVER_TEXT_STRING_TYPES)) return null;
          if (hasList(type)) return null;
          if (fieldName && !extendsAny(type, ["text"]) && NON_TEXT_FIELD_NAME.test(fieldName)) return null;
        }
        return withLegal({ kind: "text" }, legal);
      }
      case "array": {
        if (hasList(type)) return null;
        const members = type.of ?? [];
        const isPortableText = members.some((m) => extendsAny(m, ["block"]));
        const objectMembers = {};
        let stringMember = false;
        for (const member of members) {
          if (extendsAny(member, ["block"])) continue;
          if (member.jsonType === "string") {
            if (walkInline(member, fieldName)) stringMember = true;
            continue;
          }
          if (member.jsonType !== "object") continue;
          const node = walk(member, void 0);
          if (node) objectMembers[member.name ?? "object"] = node;
        }
        if (isPortableText) return withLegal({ kind: "portableText", members: objectMembers }, legal);
        if (Object.keys(objectMembers).length > 0) return withLegal({ kind: "array", members: objectMembers }, legal);
        if (stringMember) return withLegal({ kind: "list" }, legal);
        return null;
      }
      case "object": {
        if (extendsAny(type, NEVER_TEXT_OBJECT_TYPES)) return null;
        const isImage = extendsAny(type, ["image"]);
        const fields = {};
        for (const field of type.fields ?? []) {
          if (isImage && IMAGE_SYSTEM_FIELDS.has(field.name)) continue;
          if (field.name.startsWith("_")) continue;
          const node = walk(field.type, field.name);
          if (node) fields[field.name] = node;
        }
        if (Object.keys(fields).length === 0) return null;
        return withLegal({ kind: "object", fields }, legal);
      }
      default:
        return null;
    }
  }
  const documents = {};
  let defaultLanguage = options.defaultLanguage;
  for (const typeName of documentTypes) {
    const compiled = schema.get(typeName);
    if (!compiled) continue;
    const marker = compiled.__i18n ?? {};
    const sharedFields = Array.isArray(marker.sharedFields) ? marker.sharedFields.map(String) : [];
    const slugField = typeof marker.slugField === "string" ? marker.slugField : (compiled.fields ?? []).find((f) => extendsAny(f.type, ["slug"]))?.name ?? null;
    if (!defaultLanguage && typeof marker.defaultLanguage === "string") defaultLanguage = marker.defaultLanguage;
    const fields = {};
    for (const field of compiled.fields ?? []) {
      if (field.name === LANGUAGE_FIELD || field.name === I18N_FIELD) continue;
      if (field.name.startsWith("_")) continue;
      if (sharedFields.includes(field.name)) continue;
      if (slugField && field.name === slugField) continue;
      const node = walk(field.type, field.name);
      if (node) fields[field.name] = node;
    }
    const hasSlug = slugField !== null && (compiled.fields ?? []).some((f) => f.name === slugField);
    documents[typeName] = { fields, sharedFields, slugField: hasSlug ? slugField : null };
  }
  return { version: 1, defaultLanguage: defaultLanguage ?? DEFAULT_LANGUAGE_ID, documents, types };
}
function resolveManifestNode(manifest, node) {
  let current = node;
  let legal = node.legal === true;
  let guard = 0;
  while (current && current.kind === "ref" && guard++ < 10) {
    current = manifest.types[current.type];
    if (current?.legal) legal = true;
  }
  if (!current || current.kind === "ref") return null;
  return { node: current, legal };
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
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const record = value;
  const keys = Object.keys(record).filter((k) => record[k] !== void 0).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

// src/core/payload.ts
var LETTER = /\p{L}/u;
var SINGLE_TOKEN_NON_TEXT = /^(?:https?:\/\/|mailto:|tel:|www\.|\/|#)\S*$/i;
var EMAIL_ONLY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isTranslatableValue(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (!LETTER.test(trimmed)) return false;
  if (SINGLE_TOKEN_NON_TEXT.test(trimmed)) return false;
  if (EMAIL_ONLY.test(trimmed)) return false;
  return true;
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isBlock(value) {
  return isObject(value) && value._type === "block" && Array.isArray(value.children);
}
function pruneBlock(block) {
  const out = {};
  if (typeof block._key === "string") out._key = block._key;
  out._type = "block";
  if (typeof block.style === "string") out.style = block.style;
  if (typeof block.listItem === "string") out.listItem = block.listItem;
  if (typeof block.level === "number") out.level = block.level;
  if (Array.isArray(block.markDefs) && block.markDefs.length > 0) {
    out.markDefs = JSON.parse(JSON.stringify(block.markDefs));
  }
  out.children = (Array.isArray(block.children) ? block.children : []).map((child) => {
    const c = isObject(child) ? child : {};
    const span = {};
    if (typeof c._key === "string") span._key = c._key;
    span._type = typeof c._type === "string" ? c._type : "span";
    if (span._type === "span") {
      span.marks = Array.isArray(c.marks) ? c.marks.map(String) : [];
      span.text = typeof c.text === "string" ? c.text : "";
    }
    return span;
  });
  return out;
}
function blockText(block) {
  return block.children.map((c) => typeof c.text === "string" ? c.text : "").join("");
}
function memberSegment(item, index) {
  return isObject(item) && typeof item._key === "string" && item._key !== "" ? { _key: item._key } : index;
}
function pieceOf(segments) {
  const head = segments.slice(0, typeof segments[1] === "string" || segments[1] === void 0 ? 1 : 2);
  return pathToString(head);
}
function extractUnits(doc, manifest, typeName) {
  const type = typeName ?? (typeof doc._type === "string" ? doc._type : "");
  const documentType = manifest.documents[type];
  if (!documentType) return [];
  const units = [];
  const push = (segments, kind, value, legal) => {
    units.push({
      path: pathToString(segments),
      segments,
      kind,
      value,
      legal,
      hash: sha256Hex(stableStringify(value)),
      piece: pieceOf(segments)
    });
  };
  const walk = (value, node, segments, inheritedLegal) => {
    const resolved = resolveManifestNode(manifest, node);
    if (!resolved) return;
    const legal = inheritedLegal || resolved.legal;
    const current = resolved.node;
    switch (current.kind) {
      case "text":
        if (isTranslatableValue(value)) push(segments, "text", value, legal);
        return;
      case "list":
        if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string") && value.some(isTranslatableValue)) {
          push(segments, "list", [...value], legal);
        }
        return;
      case "portableText":
        if (!Array.isArray(value)) return;
        value.forEach((item, index) => {
          const next = [...segments, memberSegment(item, index)];
          if (isBlock(item)) {
            const pruned = pruneBlock(item);
            if (pruned.children.some((c) => isTranslatableValue(c.text))) push(next, "block", pruned, legal);
            return;
          }
          if (!isObject(item)) return;
          const member = current.members[typeof item._type === "string" ? item._type : "object"];
          if (member) walk(item, member, next, legal);
        });
        return;
      case "array": {
        if (!Array.isArray(value)) return;
        const names = Object.keys(current.members);
        value.forEach((item, index) => {
          if (!isObject(item)) return;
          const member = current.members[typeof item._type === "string" ? item._type : "object"] ?? (names.length === 1 ? current.members[names[0]] : void 0);
          if (member) walk(item, member, [...segments, memberSegment(item, index)], legal);
        });
        return;
      }
      case "object":
        if (!isObject(value)) return;
        for (const [name, child] of Object.entries(current.fields)) {
          if (value[name] !== void 0 && value[name] !== null) walk(value[name], child, [...segments, name], legal);
        }
        return;
    }
  };
  for (const [name, node] of Object.entries(documentType.fields)) {
    if (doc[name] !== void 0 && doc[name] !== null) walk(doc[name], node, [name], false);
  }
  return units;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function readUnit(payload, unit) {
  const value = getAtPath(payload, unit.segments);
  if (unit.kind === "text") return typeof value === "string" ? value : void 0;
  if (unit.kind === "list") {
    return Array.isArray(value) && value.length === unit.value.length && value.every((v) => typeof v === "string") ? value : void 0;
  }
  return isBlock(value) ? pruneBlock(value) : void 0;
}
var STRUCTURE_HASH_PATH = "__structure";
var SYSTEM_FIELDS = ["_id", "_rev", "_createdAt", "_updatedAt", "_system", "_originalId"];
function structureHash(doc, manifest, units) {
  const documentType = manifest.documents[typeof doc._type === "string" ? doc._type : ""];
  const copy = clone(doc);
  for (const field of SYSTEM_FIELDS) delete copy[field];
  delete copy[LANGUAGE_FIELD];
  delete copy[I18N_FIELD];
  for (const field of documentType?.sharedFields ?? []) delete copy[field];
  if (documentType?.slugField) delete copy[documentType.slugField];
  for (const unit of units) {
    if (unit.kind === "text") setAtPath(copy, unit.segments, "");
    else if (unit.kind === "list") setAtPath(copy, unit.segments, []);
    else {
      const block = getAtPath(copy, unit.segments);
      if (isBlock(block)) {
        for (const child of block.children) if (isObject(child) && typeof child.text === "string") child.text = "";
      }
    }
  }
  return sha256Hex(stableStringify(copy));
}
function sourceHashes(doc, manifest, units) {
  const list = units ?? extractUnits(doc, manifest);
  const entries = list.map((unit) => ({ _key: sha256Hex(unit.path).slice(0, 12), path: unit.path, hash: unit.hash }));
  entries.push({ _key: "structure", path: STRUCTURE_HASH_PATH, hash: structureHash(doc, manifest, list) });
  return entries;
}
function diffSource(sourceDoc, translationDoc, manifest) {
  const units = extractUnits(sourceDoc, manifest);
  const current = sourceHashes(sourceDoc, manifest, units);
  const storedRaw = translationDoc?.[I18N_FIELD]?.sourceHashes;
  const stored = /* @__PURE__ */ new Map();
  if (Array.isArray(storedRaw)) {
    for (const entry of storedRaw) {
      if (isObject(entry) && typeof entry.path === "string" && typeof entry.hash === "string") stored.set(entry.path, entry.hash);
    }
  }
  const changed = [];
  const added = [];
  let structureChanged = false;
  const seen = /* @__PURE__ */ new Set();
  for (const entry of current) {
    seen.add(entry.path);
    const before = stored.get(entry.path);
    if (entry.path === STRUCTURE_HASH_PATH) {
      structureChanged = before !== entry.hash;
      continue;
    }
    if (before === void 0) added.push(entry.path);
    else if (before !== entry.hash) changed.push(entry.path);
  }
  const removed = [...stored.keys()].filter((path) => path !== STRUCTURE_HASH_PATH && !seen.has(path));
  const upToDate = changed.length === 0 && added.length === 0 && removed.length === 0 && !structureChanged;
  return { changed, added, removed, structureChanged, upToDate };
}

// src/core/legal.ts
var LEGAL_APPROVAL_TYPE = "i18n.legalApproval";
var LEGAL_APPROVAL_ID_PREFIX = "i18n-legal-";
function normaliseLegalText(text5) {
  return text5.replace(/\s+/g, " ").trim();
}
function legalSourceHash(text5) {
  return sha256Hex(normaliseLegalText(text5));
}
function legalApprovalId(language, sourceHash) {
  return `${LEGAL_APPROVAL_ID_PREFIX}${language}-${sourceHash.slice(0, 12)}`;
}
function unitText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join("\n");
  return blockText(value);
}
function occurrenceKey(documentId, path) {
  return sha256Hex(`${documentId}
${path}`).slice(0, 12);
}
function legalUnitsOf(doc, manifest, typeName) {
  return extractUnits(doc, manifest, typeName).filter((unit) => unit.legal);
}
function publishedId(id) {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}
function isObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseLegalValue(entry) {
  try {
    const parsed = JSON.parse(entry.translatedValue);
    if (entry.kind === "text" && typeof parsed === "string") return parsed;
    if (entry.kind === "list" && Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
    if (entry.kind === "block" && isObject2(parsed) && Array.isArray(parsed.children)) return parsed;
  } catch {
  }
  return entry.kind === "text" ? entry.translatedText : null;
}
function applyLegalValue(target, segments, value) {
  if (typeof value === "string" || Array.isArray(value)) return setAtPath(target, segments, JSON.parse(JSON.stringify(value)));
  const block = getAtPath(target, segments);
  if (!isObject2(block) || !Array.isArray(block.children)) return false;
  const spans = block.children.filter((c) => isObject2(c) && c._type === "span");
  const approved = value.children.filter((c) => c._type === "span" && typeof c.text === "string");
  if (spans.length === 0) return false;
  if (spans.length === approved.length) {
    spans.forEach((span, i) => {
      span.text = approved[i].text;
    });
    return true;
  }
  spans.forEach((span, i) => {
    span.text = i === 0 ? blockText(value) : "";
  });
  return true;
}
var NEW_PROPOSAL = "Proposed by a translation run";
function occurrencePatch(id, occurrence) {
  return [
    { patch: { id, setIfMissing: { occurrences: [] } } },
    { patch: { id, unset: [`occurrences[_key == ${JSON.stringify(occurrence._key)}]`] } },
    { patch: { id, insert: { after: "occurrences[-1]", items: [occurrence] } } }
  ];
}
function historyPatch(id, decision) {
  return [
    { patch: { id, setIfMissing: { history: [] } } },
    { patch: { id, insert: { after: "history[-1]", items: [decision] } } }
  ];
}
function decisionKey(now, status, seed) {
  return sha256Hex(`${now}
${status}
${seed}`).slice(0, 12);
}
function planLegalRegistry(input) {
  const mutations = [];
  const paths = [];
  let pending = 0;
  let approved = 0;
  for (const unit of input.units) {
    const proposal = readUnit(input.translation, unit);
    if (proposal === void 0) continue;
    const sourceText = unitText(unit.value);
    const sourceHash = legalSourceHash(sourceText);
    const id = legalApprovalId(input.language, sourceHash);
    const occurrence = {
      _key: occurrenceKey(input.documentId, unit.path),
      documentId: input.documentId,
      documentType: input.documentType,
      path: unit.path
    };
    const entry = input.entries.get(id);
    let status = "pending";
    if (!entry) {
      const decision = {
        _key: decisionKey(input.now, "pending", id),
        status: "pending",
        decidedAt: input.now,
        sourceHash,
        comment: input.note ?? NEW_PROPOSAL,
        ...input.by ? { decidedBy: input.by } : {}
      };
      const doc = {
        _id: id,
        _type: LEGAL_APPROVAL_TYPE,
        language: input.language,
        sourceHash,
        sourceText,
        kind: unit.kind,
        translatedText: unitText(proposal),
        translatedValue: JSON.stringify(proposal),
        status: "pending",
        occurrences: [],
        history: [decision],
        createdAt: input.now,
        updatedAt: input.now
      };
      mutations.push({ createIfNotExists: doc }, ...occurrencePatch(id, occurrence));
    } else if (entry.status === "approved") {
      const value = parseLegalValue(entry);
      if (value !== null) applyLegalValue(input.translation, unit.segments, value);
      status = "approved";
      mutations.push(...occurrencePatch(id, occurrence));
    } else if (entry.status === "pending") {
      const value = parseLegalValue(entry);
      if (value !== null) applyLegalValue(input.translation, unit.segments, value);
      mutations.push(...occurrencePatch(id, occurrence));
    } else {
      const decision = {
        _key: decisionKey(input.now, "pending", id),
        status: "pending",
        decidedAt: input.now,
        sourceHash,
        comment: input.note ?? NEW_PROPOSAL,
        ...input.by ? { decidedBy: input.by } : {}
      };
      mutations.push(
        {
          patch: {
            id,
            set: { status: "pending", translatedText: unitText(proposal), translatedValue: JSON.stringify(proposal), updatedAt: input.now },
            unset: ["decidedBy", "decidedAt", "comment", "supersededBy"]
          }
        },
        ...historyPatch(id, decision),
        ...occurrencePatch(id, occurrence)
      );
    }
    if (status === "approved") approved++;
    else pending++;
    paths.push({ _key: sha256Hex(unit.path).slice(0, 12), path: unit.path, unitId: id, sourceHash, status });
  }
  return { mutations, legal: { pending, approved, paths } };
}
function statusAfterRun(held, legal) {
  if (held) return "draft";
  return legal.pending > 0 ? "awaiting_approval" : "approved";
}
function readLegalRecord(doc) {
  const legal = doc[I18N_FIELD]?.legal;
  if (!isObject2(legal)) return null;
  return {
    pending: typeof legal.pending === "number" ? legal.pending : 0,
    approved: typeof legal.approved === "number" ? legal.approved : 0,
    paths: Array.isArray(legal.paths) ? legal.paths : []
  };
}
function checkTranslationForPublish(doc, manifest, entries, options = {}) {
  const reasons = [];
  const i18n = doc[I18N_FIELD] ?? {};
  const status = typeof i18n.status === "string" ? i18n.status : "draft";
  if (status !== "approved") {
    reasons.push(`The translation is ${translationStatusLabel(status, options.labels)}, not ${translationStatusLabel("approved", options.labels)}.`);
  }
  if (i18n.report?.held === true) {
    reasons.push("The translation is held for a person to look at; see the translation report.");
  }
  const record = readLegalRecord(doc);
  if (record && record.pending > 0) {
    reasons.push(`${record.pending} piece(s) of legal text are waiting for approval.`);
  }
  for (const path of record?.paths ?? []) {
    const entry = entries.get(path.unitId);
    if (!entry || entry.status !== "approved") {
      reasons.push(`Legal text at ${path.path} is ${entry ? entry.status.replace("_", " ") : "not in the approval queue"}.`);
    }
  }
  if (manifest) {
    const units = legalUnitsOf(doc, manifest);
    for (const unit of units) {
      const path = record?.paths.find((p) => p.path === unit.path);
      if (!path) {
        reasons.push(`Legal text at ${unit.path} has not been through the approval queue.`);
        continue;
      }
      const entry = entries.get(path.unitId);
      if (!entry || entry.status !== "approved") continue;
      if (normaliseLegalText(entry.translatedText) !== normaliseLegalText(unitText(unit.value))) {
        reasons.push(`Legal text at ${unit.path} differs from the approved wording.`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}
function planStaleTranslations(input) {
  const mutations = [];
  const marks = [];
  const sourceUnits = extractUnits(input.source, input.manifest);
  const legalByPath = new Map(sourceUnits.filter((u) => u.legal).map((u) => [u.path, u]));
  const sourceId = publishedId(String(input.source._id ?? ""));
  const metaId = translationMetaId(sourceId);
  const touchedLanguages = [];
  for (const t of input.translations) {
    const current = t.draft ?? t.published;
    if (!current) continue;
    const i18n = current[I18N_FIELD] ?? {};
    if (!Array.isArray(i18n.sourceHashes)) continue;
    const diff = diffSource(input.source, current, input.manifest);
    if (diff.upToDate) continue;
    const id = publishedId(String(current._id ?? ""));
    const language = String(current[LANGUAGE_FIELD] ?? "");
    const draftId = `drafts.${id}`;
    const legalChanged = [...diff.changed, ...diff.added].filter((path) => legalByPath.has(path));
    const status = legalChanged.length > 0 ? "awaiting_approval" : "needs_update";
    const alreadyStale = typeof i18n.staleSince === "string";
    const superseded = [];
    if (!t.draft && t.published) {
      const copy = JSON.parse(JSON.stringify(t.published));
      for (const field of ["_rev", "_createdAt", "_updatedAt"]) delete copy[field];
      mutations.push({ createIfNotExists: { ...copy, _id: draftId } });
    }
    mutations.push({ patch: { id: draftId, set: { [`${I18N_FIELD}.status`]: status, [`${I18N_FIELD}.staleSince`]: input.now } } });
    if (!alreadyStale) {
      const record = readLegalRecord(current);
      for (const path of legalChanged) {
        const stored = record?.paths.find((p) => p.path === path);
        const unit = legalByPath.get(path);
        if (!stored || !unit) continue;
        const newHash = legalSourceHash(unitText(unit.value));
        if (newHash === stored.sourceHash) continue;
        superseded.push(stored.unitId);
        mutations.push(
          { patch: { id: stored.unitId, set: { status: "superseded", supersededBy: newHash, updatedAt: input.now } } },
          ...historyPatch(stored.unitId, {
            _key: decisionKey(input.now, "superseded", stored.unitId),
            status: "superseded",
            decidedAt: input.now,
            sourceHash: stored.sourceHash,
            comment: `The English wording changed in ${sourceId}.`
          })
        );
      }
    }
    if (language && !touchedLanguages.includes(language)) touchedLanguages.push(language);
    marks.push({ id, language, status, legalChanged, superseded, draftCreated: !t.draft && !!t.published });
  }
  if (marks.length > 0 && input.metaIds?.has(metaId)) {
    const set = { staleSince: input.now };
    for (const language of touchedLanguages) set[`translations[_key == ${JSON.stringify(language)}].staleSince`] = input.now;
    mutations.push({ patch: { id: metaId, set } });
  }
  return { mutations, marks };
}
function legalPathSegments(path) {
  return parsePath(path);
}

// src/sanity/engineTypes.ts
var text2 = (name, title) => defineField({ name, title, type: "string", readOnly: true });
var number = (name, title) => defineField({ name, title, type: "number", readOnly: true });
var flag = (name, title) => defineField({ name, title, type: "boolean", readOnly: true });
var when = (name, title) => defineField({ name, title, type: "datetime", readOnly: true });
var texts = (name, title) => defineField({ name, title, type: "array", of: [{ type: "string" }], readOnly: true });
var findingFields = () => [
  text2("path", "Path"),
  text2("category", "Category"),
  text2("source", "English"),
  text2("translated", "Translation"),
  text2("note", "Note")
];
function sourceHashesField() {
  return defineField({
    name: "sourceHashes",
    title: "Source fingerprints",
    type: "array",
    hidden: true,
    readOnly: true,
    description: "Fingerprint of each piece of the source when this translation was last made. Used to find what changed.",
    of: [{ type: "object", name: "sourceHash", fields: [text2("path", "Path"), text2("hash", "SHA-256")] }]
  });
}
function reportFields() {
  return [
    text2("mode", "Mode"),
    text2("language", "Language"),
    text2("sourceId", "Source document"),
    text2("translationId", "Translation document"),
    when("startedAt", "Started"),
    when("finishedAt", "Finished"),
    text2("translatorModel", "Translator model"),
    text2("reviewerModel", "Reviewer model"),
    texts("servedBy", "Models that answered"),
    number("inputTokens", "Input tokens"),
    number("outputTokens", "Output tokens"),
    number("costUsd", "Cost in US dollars"),
    text2("ratesAsOf", "Rates as of"),
    defineField({
      name: "usage",
      title: "Usage per model",
      type: "array",
      readOnly: true,
      of: [
        {
          type: "object",
          name: "callUsage",
          fields: [
            text2("model", "Model"),
            number("requests", "Requests"),
            number("inputTokens", "Input tokens"),
            number("outputTokens", "Output tokens"),
            number("cacheReadTokens", "Cache read tokens"),
            number("cacheWriteTokens", "Cache write tokens")
          ]
        }
      ]
    }),
    number("unitsTotal", "Pieces of text in the document"),
    number("unitsTranslated", "Pieces translated on this run"),
    number("unitsReused", "Pieces kept from the existing translation"),
    texts("translatedPaths", "Paths translated on this run"),
    number("structureRetries", "Structure retries"),
    flag("check1Passed", "Exact-match check passed"),
    number("check1Checked", "Strings compared"),
    defineField({ name: "check1Failures", title: "Exact-match failures", type: "array", readOnly: true, of: [{ type: "object", name: "finding", fields: findingFields() }] }),
    defineField({ name: "check1Warnings", title: "Exact-match warnings", type: "array", readOnly: true, of: [{ type: "object", name: "finding", fields: findingFields() }] }),
    flag("reviewPassed", "Reviewer check passed"),
    defineField({
      name: "reviewIssues",
      title: "Reviewer issues",
      type: "array",
      readOnly: true,
      of: [{ type: "object", name: "reviewIssue", fields: [text2("path", "Path"), text2("severity", "Severity"), text2("category", "Category"), text2("note", "Note")] }]
    }),
    texts("legalPaths", "Legal text paths"),
    text2("sourceSlug", "Source slug"),
    text2("proposedSlug", "Proposed slug"),
    flag("held", "Held for a person"),
    texts("holdReasons", "Why it is held"),
    flag("saved", "Saved as a draft"),
    text2("status", "Status given"),
    number("legalPending", "Legal text waiting for approval"),
    number("legalApproved", "Legal text with approved wording"),
    flag("published", "Published"),
    text2("publishNote", "Why it was not published")
  ];
}
function legalRecordField() {
  return defineField({
    name: "legal",
    title: "Legal text",
    type: "object",
    hidden: true,
    readOnly: true,
    description: "Which pieces of legal text on this translation are waiting for approval and which carry approved wording.",
    fields: [
      number("pending", "Waiting for approval"),
      number("approved", "Approved"),
      defineField({
        name: "paths",
        title: "Paths",
        type: "array",
        readOnly: true,
        of: [{ type: "object", name: "legalPath", fields: [text2("path", "Path"), text2("unitId", "Registry entry"), text2("sourceHash", "English fingerprint"), text2("status", "Status")] }]
      })
    ]
  });
}
function staleSinceField() {
  return defineField({
    name: "staleSince",
    title: "English changed at",
    type: "datetime",
    readOnly: true,
    hidden: true,
    description: "When the English document was published with changes this translation does not have yet."
  });
}
var person = (name, title) => defineField({ name, title, type: "object", readOnly: true, fields: [text2("id", "User id"), text2("name", "Name"), text2("email", "Email")] });
function legalApprovalType() {
  return defineType({
    name: LEGAL_APPROVAL_TYPE,
    title: "Legal approval",
    type: "document",
    ...hiddenDocument,
    readOnly: true,
    fields: [
      text2("language", "Language"),
      text2("sourceHash", "English fingerprint"),
      defineField({ name: "sourceText", title: "English", type: "text", readOnly: true }),
      text2("kind", "Kind"),
      defineField({ name: "translatedText", title: "Translation", type: "text", readOnly: true }),
      defineField({ name: "translatedValue", title: "Translation (stored value)", type: "text", readOnly: true, hidden: true }),
      text2("status", "Status"),
      person("decidedBy", "Decided by"),
      when("decidedAt", "Decided"),
      defineField({ name: "comment", title: "Comment", type: "text", readOnly: true }),
      text2("supersededBy", "Superseded by"),
      defineField({
        name: "occurrences",
        title: "Where it appears",
        type: "array",
        readOnly: true,
        of: [{ type: "object", name: "occurrence", fields: [text2("documentId", "Document"), text2("documentType", "Type"), text2("path", "Path")] }]
      }),
      defineField({
        name: "history",
        title: "History",
        type: "array",
        readOnly: true,
        of: [
          {
            type: "object",
            name: "decision",
            fields: [text2("status", "Outcome"), person("decidedBy", "By"), when("decidedAt", "When"), defineField({ name: "comment", title: "Comment", type: "text", readOnly: true }), text2("sourceHash", "English fingerprint")]
          }
        ]
      }),
      when("createdAt", "Created"),
      when("updatedAt", "Updated")
    ],
    preview: {
      select: { title: "sourceText", status: "status", language: "language" },
      prepare: ({ title, status, language }) => ({
        title: typeof title === "string" ? title.slice(0, 80) : "Legal text",
        subtitle: `${String(language ?? "").toUpperCase()} \xB7 ${String(status ?? "")}`
      })
    }
  });
}
function reportField() {
  return defineField({
    name: "report",
    title: "Translation report",
    type: "object",
    hidden: true,
    readOnly: true,
    description: "What the translation engine did on its last run: models, tokens, cost and the result of both checks.",
    fields: reportFields()
  });
}
var hiddenDocument = { __experimental_omnisearch_visibility: false };
function translationJobType() {
  return defineType({
    name: JOB_TYPE,
    title: "Translation job",
    type: "document",
    ...hiddenDocument,
    readOnly: true,
    fields: [
      text2("kind", "Kind"),
      text2("sourceId", "Source document"),
      text2("sourceType", "Source type"),
      texts("sourceIds", "Source documents"),
      text2("language", "Language"),
      text2("mode", "Mode"),
      text2("requestedBy", "Requested by"),
      text2("status", "Status"),
      text2("progress", "Progress"),
      when("createdAt", "Created"),
      when("startedAt", "Started"),
      when("finishedAt", "Finished"),
      defineField({ name: "report", title: "Report", type: "object", readOnly: true, fields: reportFields() }),
      defineField({
        name: "estimate",
        title: "Estimate",
        type: "object",
        readOnly: true,
        fields: [
          number("documents", "Documents"),
          number("strings", "Strings"),
          number("characters", "Characters"),
          number("inputTokens", "Input tokens"),
          number("outputTokens", "Output tokens"),
          number("costUsd", "Cost in US dollars"),
          text2("translatorModel", "Translator model"),
          text2("reviewerModel", "Reviewer model"),
          text2("ratesAsOf", "Rates as of"),
          text2("method", "Method"),
          number("counted", "Documents counted"),
          text2("note", "Note")
        ]
      }),
      defineField({
        name: "error",
        title: "Error",
        type: "object",
        readOnly: true,
        fields: [text2("code", "Code"), text2("message", "Message"), texts("details", "Details")]
      })
    ],
    preview: {
      select: { kind: "kind", status: "status", sourceId: "sourceId", language: "language" },
      prepare: ({ kind, status, sourceId, language }) => ({
        title: `${kind === "estimate" ? "Estimate" : "Translate"}${sourceId ? ` ${sourceId}` : ""} (${language ?? "?"})`,
        subtitle: status
      })
    }
  });
}
function translationSecretsType() {
  return defineType({
    name: SECRETS_TYPE,
    title: "Translation key storage",
    type: "document",
    ...hiddenDocument,
    readOnly: true,
    fields: [
      defineField({
        name: "anthropicKey",
        title: "Anthropic API key",
        type: "object",
        readOnly: true,
        fields: [
          text2("ciphertext", "Encrypted key"),
          text2("last4", "Last four characters"),
          when("savedAt", "Saved"),
          text2("savedBy", "Saved by"),
          text2("keyFingerprint", "Key pair fingerprint")
        ]
      })
    ],
    preview: { prepare: () => ({ title: "Translation key storage" }) }
  });
}
function translationManifestType() {
  return defineType({
    name: MANIFEST_TYPE,
    title: "Translation field manifest",
    type: "document",
    ...hiddenDocument,
    readOnly: true,
    fields: [text2("hash", "Fingerprint"), defineField({ name: "manifest", title: "Manifest", type: "text", readOnly: true }), when("updatedAt", "Updated")],
    preview: { prepare: () => ({ title: "Translation field manifest" }) }
  });
}

// src/sanity/translatable.ts
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
      sourceHashesField(),
      defineField({ name: "translatedAt", title: "Translated at", type: "datetime", readOnly: true }),
      defineField({ name: "approvedAt", title: "Approved at", type: "datetime", readOnly: true }),
      defineField({ name: "approvedBy", title: "Approved by", type: "string", readOnly: true }),
      defineField({ name: "publishedAt", title: "Published at", type: "datetime", readOnly: true, hidden: true }),
      staleSinceField(),
      legalRecordField(),
      reportField()
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
function noTranslate(fieldDef) {
  const options = fieldDef.options ?? {};
  return {
    ...fieldDef,
    options: { ...options, i18n: { ...options.i18n ?? {}, translate: false } }
  };
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
  walkFields(documentTypeDef.fields ?? [], "", registry, out, /* @__PURE__ */ new Set());
  return out;
}
function resolve(member, registry) {
  if (member.fields || !member.type) return member;
  const named = registry.get(member.type);
  return named ? { ...named, ...member, options: { ...named.options ?? {}, ...member.options ?? {} } } : member;
}
function walkFields(fields, prefix, registry, out, visiting) {
  for (const field of fields) {
    if (!field || typeof field.name !== "string") continue;
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const resolved = resolve(field, registry);
    if (isLegal(field) || resolved !== field && isLegal(resolved)) {
      out.push(path);
      continue;
    }
    if (Array.isArray(resolved.fields)) {
      walkNamed(resolved, field, () => walkFields(resolved.fields, path, registry, out, visiting), visiting);
      continue;
    }
    if (Array.isArray(resolved.of)) {
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
          walkNamed(memberResolved, member, () => walkFields(memberResolved.fields, memberPath, registry, out, visiting), visiting);
        }
      }
    }
  }
}
function walkNamed(resolved, original, walk, visiting) {
  const name = resolved !== original && typeof original.type === "string" ? original.type : void 0;
  if (name && visiting.has(name)) return;
  if (name) visiting.add(name);
  walk();
  if (name) visiting.delete(name);
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
              defineField({ name: "document", title: "Document", type: "reference", to, weak: true }),
              defineField({ name: "staleSince", title: "English changed at", type: "datetime", readOnly: true })
            ],
            preview: { select: { title: "language", subtitle: "document._ref" } }
          }
        ]
      }),
      defineField({
        name: "staleSince",
        title: "English changed at",
        type: "datetime",
        readOnly: true,
        description: "When the source was last published with changes some translation does not have yet."
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
var STUDIO_API_VERSION = "2024-01-01";
var KEY_STORAGE_NOT_CONFIGURED = "Translation key storage is not configured on this server yet.";
function ApiKeyInput(props) {
  const options = props.schemaType.options ?? {};
  const publicKey = (options.i18n?.publicKey ?? "").trim();
  const client = useClient({ apiVersion: STUDIO_API_VERSION });
  const user = useCurrentUser();
  const [saved, setSaved] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const refresh = useCallback(async () => {
    try {
      const stored = await client.fetch(`*[_id == $id][0].anthropicKey{ last4, savedAt }`, { id: SECRETS_ID });
      setSaved(stored && stored.last4 ? stored : null);
    } catch {
      setSaved(null);
    }
    setLoaded(true);
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const save = useCallback(async () => {
    const value = entry.trim();
    if (value.length < 8) {
      setProblem("That does not look like a complete key.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      const [ciphertext, keyFingerprint] = await Promise.all([encryptSecret(publicKey, value), publicKeyFingerprint(publicKey)]);
      const anthropicKey = {
        ciphertext,
        last4: value.slice(-4),
        savedAt: (/* @__PURE__ */ new Date()).toISOString(),
        keyFingerprint,
        ...user?.name ? { savedBy: user.name } : {}
      };
      await client.createOrReplace({ _id: SECRETS_ID, _type: SECRETS_TYPE, anthropicKey });
      setEntry("");
      setEditing(false);
      await refresh();
    } catch {
      setProblem("The key could not be saved. Check that you are allowed to edit Site Settings, then try again.");
    }
    setBusy(false);
  }, [client, entry, publicKey, refresh, user]);
  const remove = useCallback(async () => {
    setBusy(true);
    setProblem("");
    try {
      await client.delete(SECRETS_ID);
      await refresh();
    } catch {
      setProblem("The key could not be removed. Try again.");
    }
    setBusy(false);
  }, [client, refresh]);
  if (publicKey === "") {
    return /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, tone: "caution", border: true, children: /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
      /* @__PURE__ */ jsx(Text, { size: 1, weight: "medium", children: KEY_STORAGE_NOT_CONFIGURED }),
      /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: "A developer needs to add the two I18N keys to the hosting environment. Until then no API key can be saved, and nothing else on the site is affected." })
    ] }) });
  }
  if (!loaded) {
    return /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, border: true, children: /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: "Checking for a saved key" }) });
  }
  if (saved && !editing) {
    const when3 = saved.savedAt ? new Date(saved.savedAt).toLocaleDateString() : "";
    return /* @__PURE__ */ jsxs(Card, { padding: 3, radius: 2, tone: "positive", border: true, children: [
      /* @__PURE__ */ jsxs(Flex, { align: "center", gap: 3, wrap: "wrap", children: [
        /* @__PURE__ */ jsxs(Stack, { space: 2, flex: 1, children: [
          /* @__PURE__ */ jsxs(Text, { size: 1, weight: "medium", children: [
            "Key saved, ending in ...",
            saved.last4
          ] }),
          /* @__PURE__ */ jsxs(Text, { size: 1, muted: true, children: [
            when3 ? `Saved ${when3}. ` : "",
            "The key is stored encrypted and cannot be shown again."
          ] })
        ] }),
        props.readOnly ? null : /* @__PURE__ */ jsxs(Flex, { gap: 2, children: [
          /* @__PURE__ */ jsx(Button, { text: "Replace", mode: "ghost", disabled: busy, onClick: () => setEditing(true) }),
          /* @__PURE__ */ jsx(Button, { text: "Remove", mode: "ghost", tone: "critical", disabled: busy, onClick: () => void remove() })
        ] })
      ] }),
      problem ? /* @__PURE__ */ jsx(Text, { size: 1, style: { marginTop: 12 }, children: problem }) : null
    ] });
  }
  if (props.readOnly) {
    return /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, border: true, children: /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: "No key saved. Add it on the default-language Site Settings." }) });
  }
  return /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
    /* @__PURE__ */ jsxs(Flex, { gap: 2, children: [
      /* @__PURE__ */ jsx(Card, { flex: 1, children: /* @__PURE__ */ jsx(
        TextInput,
        {
          type: "password",
          autoComplete: "off",
          spellCheck: false,
          placeholder: "Paste the key",
          value: entry,
          disabled: busy,
          onChange: (event) => setEntry(event.currentTarget.value)
        }
      ) }),
      /* @__PURE__ */ jsx(Button, { text: busy ? "Saving" : "Save key", tone: "primary", disabled: busy || entry.trim() === "", onClick: () => void save() }),
      saved ? /* @__PURE__ */ jsx(Button, { text: "Cancel", mode: "ghost", disabled: busy, onClick: () => {
        setEditing(false);
        setEntry("");
        setProblem("");
      } }) : null
    ] }),
    /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: "The key is encrypted in your browser before it is saved and is never shown again." }),
    problem ? /* @__PURE__ */ jsx(Text, { size: 1, children: problem }) : null
  ] });
}
var DEFAULT_ENDPOINT = "/api/i18n/translate";
var DEFAULT_APPROVE_ENDPOINT = "/api/i18n/approve";
async function ensureManifest(client, schema, options) {
  const manifest = buildFieldManifest(schema, options.translatableTypes, { defaultLanguage: options.languages.defaultLanguage.id });
  const serialised = JSON.stringify(manifest);
  const hash = sha256Hex(serialised);
  const stored = await client.fetch(`*[_id == $id][0].hash`, { id: MANIFEST_ID });
  if (stored !== hash) {
    await client.createOrReplace({ _id: MANIFEST_ID, _type: MANIFEST_TYPE, hash, manifest: serialised, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  return manifest;
}
function uuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function createJob(client, job) {
  const id = jobId(uuid());
  await client.create({
    _id: id,
    _type: JOB_TYPE,
    status: "pending",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    mode: job.mode ?? "full",
    ...job
  });
  return id;
}
async function startJob(endpoint, id) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: id })
    });
    if (response.ok) return null;
    if (response.status === 404 || response.status === 405) {
      return `The translation service was not found at ${endpoint}. A developer needs to add the route to the site.`;
    }
    if (response.status === 504 || response.status === 408) return null;
    try {
      const body = await response.json();
      if (body?.error?.message) return body.error.message;
    } catch {
    }
    return "The translation service could not start the job. Try again in a moment.";
  } catch {
    return null;
  }
}
var FINAL = /* @__PURE__ */ new Set(["done", "held", "failed"]);
function isFinished(job) {
  return !!job && FINAL.has(job.status);
}
async function watchJob(client, id, onUpdate, options = {}) {
  const started = Date.now();
  const interval = options.intervalMs ?? 2e3;
  const timeout = options.timeoutMs ?? 6 * 60 * 1e3;
  let last = null;
  while (!options.cancelled?.()) {
    try {
      const job = await client.getDocument(id);
      if (job) {
        last = job;
        onUpdate(job);
        if (isFinished(job)) return job;
      }
    } catch {
    }
    if (Date.now() - started > timeout) return last;
    await new Promise((resolve2) => setTimeout(resolve2, interval));
  }
  return last;
}
function useEnabledLanguageIds(client, options) {
  const [ids, setIds] = useState(null);
  const defaultId = options.languages.defaultLanguage.id;
  const settingsType = options.settingsType ?? "settings";
  const fieldName = options.languagesField ?? "languages";
  useEffect(() => {
    let alive = true;
    client.fetch(
      `*[_type == $type && (${LANGUAGE_FIELD} == $lang || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))][0]{ ${JSON.stringify(fieldName)}: ${fieldName} }`,
      { type: settingsType, lang: defaultId }
    ).then((settings) => {
      if (alive) setIds(readEnabledLanguages(settings, options.languages, { fieldName }).map((l) => l.id));
    }).catch(() => {
      if (alive) setIds([defaultId]);
    });
    return () => {
      alive = false;
    };
  }, [client, defaultId, settingsType, fieldName, options.languages]);
  return ids;
}
function useLegalApprovers(client, options) {
  const [approvers, setApprovers] = useState(null);
  const defaultId = options.languages.defaultLanguage.id;
  const settingsType = options.settingsType ?? "settings";
  const fieldName = options.legalApproversField ?? LEGAL_APPROVERS_FIELD;
  useEffect(() => {
    let alive = true;
    client.fetch(
      `*[_type == $type && (${LANGUAGE_FIELD} == $lang || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))][0]{ ${JSON.stringify(fieldName)}: ${fieldName} }`,
      { type: settingsType, lang: defaultId }
    ).then((settings) => {
      if (alive) setApprovers(readLegalApprovers(settings, fieldName));
    }).catch(() => {
      if (alive) setApprovers([]);
    });
    return () => {
      alive = false;
    };
  }, [client, defaultId, settingsType, fieldName]);
  return approvers;
}
function formatDollars(amount) {
  if (amount > 0 && amount < 0.01) return "less than $0.01";
  return `$${amount.toFixed(2)}`;
}
function formatCount(value) {
  return value.toLocaleString("en-US");
}
var APPROVER_NOTICE = "You can see the queue, but only a listed legal approver can approve or send back. Ask the site owner to add your email under Site Settings, Languages, Legal approvers.";
function who(person2) {
  if (!person2) return "the translation engine";
  return person2.name && person2.email ? `${person2.name} (${person2.email})` : person2.name || person2.email || person2.id || "someone";
}
function when2(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
function outcomeWord(status) {
  switch (status) {
    case "approved":
      return "Approved";
    case "sent_back":
      return "Sent back";
    case "superseded":
      return "Superseded (the English changed)";
    default:
      return "Proposed";
  }
}
function excerpt(text5, max = 140) {
  const flat = text5.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
}
function buildLog(entries) {
  const rows = [];
  for (const entry of entries) {
    for (const decision of entry.history ?? []) rows.push({ unitId: entry._id, language: entry.language, sourceText: entry.sourceText, decision });
  }
  return rows.sort((a, b) => a.decision.decidedAt < b.decision.decidedAt ? 1 : a.decision.decidedAt > b.decision.decidedAt ? -1 : 0);
}
async function resubmitLegalUnit(client, entry, by) {
  for (const occurrence of entry.occurrences ?? []) {
    const draft = await client.fetch(`*[_id == $id][0]`, { id: `drafts.${occurrence.documentId}` }, { perspective: "raw" });
    if (!draft) continue;
    const segments = legalPathSegments(occurrence.path);
    const unit = { path: occurrence.path, segments, kind: entry.kind, value: "" };
    const value = readUnit(draft, unit) ?? getAtPath(draft, segments);
    if (value === void 0) continue;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const decision = {
      _key: sha256Hex(`${now}
pending
${entry._id}`).slice(0, 12),
      status: "pending",
      decidedAt: now,
      sourceHash: entry.sourceHash,
      comment: `Resubmitted with the wording in ${occurrence.documentId}.`,
      ...by ? { decidedBy: by } : {}
    };
    await client.mutate([
      { patch: { id: entry._id, set: { status: "pending", translatedText: unitText(value), translatedValue: JSON.stringify(value), updatedAt: now }, unset: ["decidedBy", "decidedAt", "comment", "supersededBy"] } },
      { patch: { id: entry._id, setIfMissing: { history: [] } } },
      { patch: { id: entry._id, insert: { after: "history[-1]", items: [decision] } } }
    ]);
    return true;
  }
  return false;
}
function Occurrences({ occurrences, titles, typeTitle }) {
  const router = useRouter();
  if (occurrences.length === 0) return /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: "Not on any translation yet." });
  return /* @__PURE__ */ jsx(Stack, { space: 2, children: occurrences.map((o) => /* @__PURE__ */ jsxs(Flex, { align: "center", gap: 2, wrap: "wrap", children: [
    /* @__PURE__ */ jsx(
      Button,
      {
        mode: "bleed",
        padding: 1,
        fontSize: 1,
        text: `${typeTitle(o.documentType)}: ${titles.get(o.documentId) ?? o.documentId}`,
        onClick: () => router.navigateIntent("edit", { id: o.documentId, type: o.documentType })
      }
    ),
    /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: o.path })
  ] }, o._key ?? occurrenceKey(o.documentId, o.path))) });
}
function History({ history }) {
  const [open, setOpen] = useState(false);
  if (!history || history.length === 0) return null;
  return /* @__PURE__ */ jsxs(Stack, { space: 2, children: [
    /* @__PURE__ */ jsx(Button, { mode: "bleed", padding: 1, fontSize: 1, text: open ? "Hide history" : `History (${history.length})`, onClick: () => setOpen((v) => !v) }),
    open ? [...history].reverse().map((d) => /* @__PURE__ */ jsxs(Text, { size: 1, muted: true, children: [
      when2(d.decidedAt),
      ": ",
      outcomeWord(d.status),
      " by ",
      who(d.decidedBy),
      d.comment ? `. ${d.comment}` : ""
    ] }, d._key)) : null
  ] });
}
function UnitCard({
  entry,
  languages,
  titles,
  typeTitle,
  canDecide,
  busy,
  onApprove,
  onSendBack,
  onResubmit
}) {
  const [sendingBack, setSendingBack] = useState(false);
  const [comment, setComment] = useState("");
  const language = languages.languages.find((l) => l.id === entry.language);
  const languageTitle = language?.title ?? entry.language.toUpperCase();
  const sentBack = entry.status === "sent_back";
  return /* @__PURE__ */ jsx(Card, { padding: 4, radius: 2, border: true, tone: sentBack ? "caution" : "default", children: /* @__PURE__ */ jsxs(Stack, { space: 4, children: [
    /* @__PURE__ */ jsx(Flex, { align: "center", gap: 3, wrap: "wrap", children: /* @__PURE__ */ jsxs(Text, { size: 1, weight: "medium", children: [
      languageTitle,
      " \xB7 ",
      sentBack ? "Sent back" : "Waiting for approval",
      " \xB7 since ",
      when2(entry.createdAt ?? entry._createdAt)
    ] }) }),
    /* @__PURE__ */ jsxs(Flex, { gap: 4, wrap: "wrap", children: [
      /* @__PURE__ */ jsx(Box, { flex: 1, style: { minWidth: 280 }, children: /* @__PURE__ */ jsxs(Stack, { space: 2, children: [
        /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: languages.defaultLanguage.title }),
        /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, tone: "transparent", border: true, children: /* @__PURE__ */ jsx(Text, { size: 1, style: { whiteSpace: "pre-wrap" }, children: entry.sourceText }) })
      ] }) }),
      /* @__PURE__ */ jsx(Box, { flex: 1, style: { minWidth: 280 }, children: /* @__PURE__ */ jsxs(Stack, { space: 2, children: [
        /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: languageTitle }),
        /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, tone: "primary", border: true, children: /* @__PURE__ */ jsx(Text, { size: 1, style: { whiteSpace: "pre-wrap" }, children: entry.translatedText }) })
      ] }) })
    ] }),
    sentBack && entry.comment ? /* @__PURE__ */ jsxs(Text, { size: 1, children: [
      "Sent back by ",
      who(entry.decidedBy),
      " on ",
      when2(entry.decidedAt),
      ": ",
      entry.comment
    ] }) : null,
    /* @__PURE__ */ jsxs(Stack, { space: 2, children: [
      /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: "Where it appears" }),
      /* @__PURE__ */ jsx(Occurrences, { occurrences: entry.occurrences ?? [], titles, typeTitle })
    ] }),
    /* @__PURE__ */ jsx(History, { history: entry.history ?? [] }),
    canDecide ? /* @__PURE__ */ jsx(Stack, { space: 3, children: sendingBack ? /* @__PURE__ */ jsxs(Stack, { space: 2, children: [
      /* @__PURE__ */ jsx(TextArea, { rows: 3, placeholder: "What needs to change (required)", value: comment, onChange: (event) => setComment(event.currentTarget.value), disabled: busy }),
      /* @__PURE__ */ jsxs(Flex, { gap: 2, children: [
        /* @__PURE__ */ jsx(Button, { text: "Send back with this comment", tone: "critical", disabled: busy || comment.trim() === "", onClick: () => onSendBack(entry, comment.trim()) }),
        /* @__PURE__ */ jsx(Button, { text: "Cancel", mode: "ghost", disabled: busy, onClick: () => setSendingBack(false) })
      ] })
    ] }) : /* @__PURE__ */ jsxs(Flex, { gap: 2, wrap: "wrap", children: [
      /* @__PURE__ */ jsx(Button, { text: sentBack ? "Approve as it is" : "Approve", tone: "positive", icon: CheckmarkCircleIcon, disabled: busy, onClick: () => onApprove(entry) }),
      !sentBack ? /* @__PURE__ */ jsx(Button, { text: "Send back", mode: "ghost", tone: "critical", disabled: busy, onClick: () => setSendingBack(true) }) : null,
      sentBack ? /* @__PURE__ */ jsx(Button, { text: "Resubmit with the draft's current wording", mode: "ghost", disabled: busy, onClick: () => onResubmit(entry) }) : null
    ] }) }) : sentBack ? /* @__PURE__ */ jsx(Button, { text: "Resubmit with the draft's current wording", mode: "ghost", disabled: busy, onClick: () => onResubmit(entry) }) : null
  ] }) });
}
function LegalApprovalsToolView({ tool }) {
  const options = tool.options;
  const client = useClient({ apiVersion: STUDIO_API_VERSION });
  const user = useCurrentUser();
  const approvers = useLegalApprovers(client, options);
  const canDecide = approvers !== null && isLegalApprover(user?.email, approvers);
  const [tab, setTab] = useState("queue");
  const [queue, setQueue] = useState(null);
  const [log, setLog] = useState(null);
  const [titles, setTitles] = useState(/* @__PURE__ */ new Map());
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const typeTitle = useCallback((type) => options.titles?.[type] ?? type, [options.titles]);
  const load = useCallback(async () => {
    const [pending, all] = await Promise.all([
      client.fetch(`*[_type == $type && status in ["pending", "sent_back"]] | order(createdAt asc, _createdAt asc)`, { type: LEGAL_APPROVAL_TYPE }),
      client.fetch(`*[_type == $type]{ _id, language, sourceText, history }`, { type: LEGAL_APPROVAL_TYPE })
    ]);
    const ids = [...new Set(pending.flatMap((e) => (e.occurrences ?? []).map((o) => o.documentId)))];
    const named = ids.length > 0 ? await client.fetch(`*[_id in $ids || _id in $drafts]{ _id, "title": coalesce(title, name, siteName, heading, _id) }`, { ids, drafts: ids.map((id) => `drafts.${id}`) }, { perspective: "raw" }) : [];
    if (!alive.current) return;
    const map = /* @__PURE__ */ new Map();
    for (const row of named) map.set(row._id.replace(/^drafts\./, ""), String(row.title ?? row._id));
    setTitles(map);
    setQueue(pending);
    setLog(buildLog(all));
  }, [client]);
  useEffect(() => {
    void load().catch(() => setMessage({ tone: "critical", text: "The approval queue could not be loaded." }));
  }, [load]);
  const decide = useCallback(
    async (entry, kind, comment) => {
      setBusy(entry._id);
      setMessage(null);
      try {
        const id = await createJob(client, {
          kind,
          language: entry.language,
          unitId: entry._id,
          ...comment ? { comment } : {},
          approver: { id: user?.id, name: user?.name, email: user?.email },
          requestedBy: user?.name ?? user?.email ?? user?.id
        });
        let refused = null;
        void startJob(options.approveEndpoint ?? DEFAULT_APPROVE_ENDPOINT, id).then((m) => {
          refused = m;
        });
        const job = await watchJob(client, id, () => void 0, { cancelled: () => !alive.current || refused !== null, timeoutMs: 2 * 60 * 1e3 });
        if (!alive.current) return;
        if (job?.status === "done" && job.approval) {
          const published = job.approval.translations.filter((t) => t.published).length;
          const approved = job.approval.translations.filter((t) => t.status === "approved").length;
          setMessage({
            tone: "positive",
            text: kind === "approve" ? `Approved. ${job.approval.translations.length} translation(s) updated with the approved wording; ${approved} now Approved, ${published} published.` : `Sent back. ${job.approval.translations.length} translation(s) stay held until the wording is fixed and resubmitted.`
          });
        } else if (job?.status === "failed") setMessage({ tone: "critical", text: job.error?.message ?? "The decision could not be recorded." });
        else if (!isFinished(job)) setMessage({ tone: "critical", text: refused ?? "The decision is taking longer than expected. Reload in a moment." });
        await load();
      } catch {
        setMessage({ tone: "critical", text: "The decision could not be started. Check that you are allowed to edit content." });
      }
      if (alive.current) setBusy(null);
    },
    [client, user, options.approveEndpoint, load]
  );
  const resubmit = useCallback(
    async (entry) => {
      setBusy(entry._id);
      setMessage(null);
      try {
        const done = await resubmitLegalUnit(client, entry, user ? { id: user.id, name: user.name, email: user.email } : void 0);
        setMessage(done ? { tone: "positive", text: "Resubmitted. It is waiting for approval again with the draft's current wording." } : { tone: "caution", text: "No draft carries this text yet, so there is nothing to resubmit. Run Translate on the page first." });
        await load();
      } catch {
        setMessage({ tone: "critical", text: "The text could not be resubmitted. Check that you are allowed to edit content." });
      }
      if (alive.current) setBusy(null);
    },
    [client, user, load]
  );
  const byLanguage = useMemo(() => {
    const groups = /* @__PURE__ */ new Map();
    for (const entry of queue ?? []) groups.set(entry.language, [...groups.get(entry.language) ?? [], entry]);
    return [...groups.entries()];
  }, [queue]);
  return /* @__PURE__ */ jsx(Container, { width: 4, padding: 4, children: /* @__PURE__ */ jsxs(Stack, { space: 5, children: [
    /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
      /* @__PURE__ */ jsx(Heading, { size: 2, children: "Legal approvals" }),
      /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: "Legal and disclosure text waits here before it goes live in another language. Each piece is approved once and reused on every page that carries the same English. A translation with legal text waiting stays unpublished." })
    ] }),
    approvers !== null && !canDecide ? /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, border: true, tone: "caution", children: /* @__PURE__ */ jsx(Text, { size: 1, children: APPROVER_NOTICE }) }) : null,
    /* @__PURE__ */ jsxs(TabList, { space: 2, children: [
      /* @__PURE__ */ jsx(Tab, { id: "queue-tab", "aria-controls": "queue-panel", label: `Queue${queue ? ` (${queue.length})` : ""}`, selected: tab === "queue", onClick: () => setTab("queue") }),
      /* @__PURE__ */ jsx(Tab, { id: "log-tab", "aria-controls": "log-panel", label: "Log", selected: tab === "log", onClick: () => setTab("log") })
    ] }),
    message ? /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, border: true, tone: message.tone, children: /* @__PURE__ */ jsx(Text, { size: 1, children: message.text }) }) : null,
    /* @__PURE__ */ jsx(TabPanel, { id: "queue-panel", "aria-labelledby": "queue-tab", hidden: tab !== "queue", children: queue === null ? /* @__PURE__ */ jsx(Flex, { padding: 4, justify: "center", children: /* @__PURE__ */ jsx(Spinner, { muted: true }) }) : queue.length === 0 ? /* @__PURE__ */ jsx(Card, { padding: 4, radius: 2, border: true, tone: "positive", children: /* @__PURE__ */ jsx(Text, { size: 1, children: "Nothing is waiting. Every piece of legal text in the queue has been decided." }) }) : /* @__PURE__ */ jsx(Stack, { space: 5, children: byLanguage.map(([languageId, entries]) => /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
      /* @__PURE__ */ jsx(Heading, { size: 1, children: options.languages.languages.find((l) => l.id === languageId)?.title ?? languageId }),
      entries.map((entry) => /* @__PURE__ */ jsx(
        UnitCard,
        {
          entry,
          languages: options.languages,
          titles,
          typeTitle,
          canDecide,
          busy: busy !== null,
          onApprove: (e) => void decide(e, "approve"),
          onSendBack: (e, comment) => void decide(e, "send_back", comment),
          onResubmit: (e) => void resubmit(e)
        },
        entry._id
      ))
    ] }, languageId)) }) }),
    /* @__PURE__ */ jsx(TabPanel, { id: "log-panel", "aria-labelledby": "log-tab", hidden: tab !== "log", children: log === null ? /* @__PURE__ */ jsx(Flex, { padding: 4, justify: "center", children: /* @__PURE__ */ jsx(Spinner, { muted: true }) }) : log.length === 0 ? /* @__PURE__ */ jsx(Card, { padding: 4, radius: 2, border: true, tone: "transparent", children: /* @__PURE__ */ jsx(Text, { size: 1, children: "No decisions yet." }) }) : /* @__PURE__ */ jsx(Card, { radius: 2, border: true, style: { overflowX: "auto" }, children: /* @__PURE__ */ jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [
      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsx("tr", { children: ["When", "Who", "Language", "English", "Outcome", "Comment"].map((heading) => /* @__PURE__ */ jsx("th", { style: { padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--card-border-color)" }, children: /* @__PURE__ */ jsx(Text, { size: 1, weight: "medium", children: heading }) }, heading)) }) }),
      /* @__PURE__ */ jsx("tbody", { children: log.map((row) => /* @__PURE__ */ jsx("tr", { children: [when2(row.decision.decidedAt), who(row.decision.decidedBy), row.language.toUpperCase(), excerpt(row.sourceText), outcomeWord(row.decision.status), row.decision.comment ?? ""].map((value, i) => /* @__PURE__ */ jsx("td", { style: { padding: "10px 12px", verticalAlign: "top", borderBottom: "1px solid var(--card-border-color)" }, children: /* @__PURE__ */ jsx(Text, { size: 1, muted: i === 0 || i === 5, children: value }) }, i)) }, `${row.unitId}-${row.decision._key}`)) })
    ] }) }) })
  ] }) });
}
function legalApprovalsTool(options) {
  return {
    name: "legal-approvals",
    title: "Legal approvals",
    icon: CheckmarkCircleIcon,
    component: LegalApprovalsToolView,
    options
  };
}

// src/core/dependencies.ts
var DEFAULT_REQUIRED_DEPENDENCY_TYPES = ["form"];
function isObject3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function collectReferences(doc) {
  const out = [];
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isObject3(value)) return;
    if (typeof value._ref === "string" && value._ref !== "") {
      const id = value._ref.startsWith("drafts.") ? value._ref.slice("drafts.".length) : value._ref;
      if (!out.includes(id)) out.push(id);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (value === doc && key === I18N_FIELD) continue;
      walk(child);
    }
  };
  walk(doc);
  return out;
}
function planDependencies(input) {
  const required = input.requiredTypes ?? DEFAULT_REQUIRED_DEPENDENCY_TYPES;
  const ownId = String(input.document._id ?? "").replace(/^drafts\./, "");
  const out = [];
  for (const id of collectReferences(input.document)) {
    if (id === ownId) continue;
    const target = input.referenced.get(id);
    if (!target) continue;
    const type = String(target._type ?? "");
    if (!input.manifest.documents[type]) continue;
    const targetLanguage = target[LANGUAGE_FIELD];
    if (typeof targetLanguage === "string" && targetLanguage !== "" && targetLanguage !== input.manifest.defaultLanguage) continue;
    const tid = translationId(id, input.language);
    const translation = input.translations.get(tid);
    const status = translation ? String(translation[I18N_FIELD]?.status ?? "draft") : input.drafts?.has(tid) ? "unpublished" : "missing";
    out.push({ _key: `d${out.length}`, id, type, translationId: tid, status, blocking: required.includes(type) && status !== "approved" });
  }
  return out;
}
function dependencyReasons(dependencies, languageTitle) {
  const language = languageTitle ? `${languageTitle} ` : "";
  return dependencies.filter((d) => d.blocking).map(
    (d) => d.status === "missing" ? `It embeds the ${d.type} ${d.id}, which has no ${language}translation yet. Translate and approve that ${d.type} first.` : d.status === "unpublished" ? `It embeds the ${d.type} ${d.id}, whose ${language}translation is still a draft. Approve and publish that ${d.type} first.` : `It embeds the ${d.type} ${d.id}, whose ${language}translation is not approved and live yet (${d.status.replace(/_/g, " ")}). Approve and publish that ${d.type} first.`
  );
}

// src/sanity/publishTranslationAction.ts
function publishTranslationAction(original, options) {
  const defaultId = options.languages.defaultLanguage.id;
  const PublishTranslation = (props) => {
    const description = original(props);
    const client = useClient({ apiVersion: STUDIO_API_VERSION });
    const schema = useSchema();
    const current = props.draft ?? props.published;
    const language = current?.[LANGUAGE_FIELD];
    const isTranslation = typeof language === "string" && language !== "" && language !== defaultId;
    const [check, setCheck] = useState(null);
    const draft = props.draft;
    const legal = draft?.[I18N_FIELD]?.legal;
    const unitIds = (legal?.paths ?? []).map((p) => p.unitId).filter((id) => typeof id === "string");
    const unitKey = unitIds.join(",");
    const draftRev = `${typeof draft?._rev === "string" ? draft._rev : ""}|${typeof draft?._updatedAt === "string" ? draft._updatedAt : ""}`;
    useEffect(() => {
      if (!isTranslation || !draft) return;
      let alive = true;
      const run = async () => {
        const docs = unitIds.length > 0 ? await client.fetch(`*[_type == $type && _id in $ids]{ _id, status, translatedText }`, { type: LEGAL_APPROVAL_TYPE, ids: unitIds }) : [];
        const entries = new Map(docs.map((d) => [d._id, d]));
        const manifest = buildFieldManifest(schema, [props.type], { defaultLanguage: defaultId });
        const result = checkTranslationForPublish(draft, manifest, entries, { labels: options.labels });
        const required = options.requiredDependencyTypes ?? DEFAULT_REQUIRED_DEPENDENCY_TYPES;
        const refs = required.length > 0 ? collectReferences(draft) : [];
        let reasons = result.reasons;
        if (refs.length > 0) {
          const types = [.../* @__PURE__ */ new Set([props.type, ...options.translatableTypes ?? [], ...required])].filter((t) => schema.get(t));
          const wide = buildFieldManifest(schema, types, { defaultLanguage: defaultId });
          const targets = await client.fetch(`*[_id in $ids]{ _id, _type, ${LANGUAGE_FIELD} }`, { ids: refs });
          const translationIds = targets.map((t) => translationId(String(t._id), String(language)));
          const found = translationIds.length > 0 ? await client.fetch(`*[_id in $ids]{ _id, ${I18N_FIELD}{ status } }`, { ids: [...translationIds, ...translationIds.map((id) => `drafts.${id}`)] }) : [];
          const translated = found.filter((t) => !String(t._id).startsWith("drafts."));
          const dependencies = planDependencies({
            document: draft,
            language: String(language),
            manifest: wide,
            referenced: new Map(targets.map((t) => [String(t._id), t])),
            translations: new Map(translated.map((t) => [String(t._id), t])),
            drafts: new Set(found.filter((t) => String(t._id).startsWith("drafts.")).map((t) => String(t._id).slice("drafts.".length))),
            requiredTypes: required
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
    }, [client, schema, isTranslation, props.type, unitKey, draftRev, defaultId]);
    if (!description || !isTranslation) return description;
    if (!draft) return description;
    if (check === null) return { ...description, disabled: true, title: "Checking the legal text on this translation" };
    if (check.ok) return description;
    return {
      ...description,
      disabled: true,
      title: `Cannot publish yet. ${check.reasons.join(" ")}`
    };
  };
  PublishTranslation.action = original.action;
  PublishTranslation.displayName = "PublishTranslation";
  return PublishTranslation;
}
var wait = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
function publishWithStaleCheck(original, options) {
  const defaultId = options.languages.defaultLanguage.id;
  const PublishWithStaleCheck = (props) => {
    const description = original(props);
    const client = useClient({ apiVersion: STUDIO_API_VERSION });
    const schema = useSchema();
    const toast = useToast();
    if (!description) return description;
    const current = props.draft ?? props.published;
    const language = current?.[LANGUAGE_FIELD];
    if (typeof language === "string" && language !== "" && language !== defaultId) return description;
    const afterPublish = async () => {
      const before = props.published?._rev;
      let published;
      for (let i = 0; i < 20; i++) {
        await wait(750);
        published = await client.getDocument(props.id);
        if (published && published._rev !== before) break;
        published = void 0;
      }
      if (!published) return;
      const rows = await client.fetch(
        `*[_type == $type && ${I18N_FIELD}.source._ref == $id && defined(${I18N_FIELD}.sourceHashes)]`,
        { type: props.type, id: props.id },
        { perspective: "raw" }
      );
      if (rows.length === 0) return;
      const metaId = translationMetaId(props.id);
      const metaCount = await client.fetch(`count(*[_id == $id])`, { id: metaId });
      const byId = /* @__PURE__ */ new Map();
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
        now: (/* @__PURE__ */ new Date()).toISOString(),
        metaIds: new Set(metaCount > 0 ? [metaId] : [])
      });
      if (plan.marks.length === 0) return;
      await client.mutate(plan.mutations);
      toast.push(staleToast(plan.marks, options.languages));
    };
    return {
      ...description,
      onHandle: () => {
        description.onHandle?.();
        afterPublish().catch(() => {
        });
      }
    };
  };
  PublishWithStaleCheck.action = original.action;
  PublishWithStaleCheck.displayName = "PublishWithStaleCheck";
  return PublishWithStaleCheck;
}
function staleToast(marks, languages) {
  const names = [...new Set(marks.map((m) => m.language))].map((id) => languages.languages.find((l) => l.id === id)?.title ?? id).join(", ");
  const legal = marks.filter((m) => m.legalChanged.length > 0);
  if (legal.length > 0) {
    return {
      status: "warning",
      title: "Legal text changed: translation re-locked",
      description: `The English legal wording changed, so the ${names} version is Awaiting approval again. The live ${names} page keeps its last approved wording. Use Translate and choose "Only what changed", then approve the new wording in Legal approvals.`
    };
  }
  return {
    status: "info",
    title: "Translation marked Needs update",
    description: `The English changed, so the ${names} draft needs updating. The live ${names} page is unchanged. Use Translate and choose "Only what changed".`
  };
}
function Line({ children, muted }) {
  return /* @__PURE__ */ jsx(Text, { size: 1, muted, children });
}
function JobOutcomeView({ job, languageTitle }) {
  const report = job.report;
  if (job.status === "failed") {
    return /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, tone: "critical", border: true, children: /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
      /* @__PURE__ */ jsx(Text, { size: 1, weight: "medium", children: "The translation did not finish" }),
      /* @__PURE__ */ jsx(Line, { children: job.error?.message ?? "Something went wrong. Nothing was saved." }),
      (job.error?.details ?? []).slice(0, 8).map((detail, i) => /* @__PURE__ */ jsx(Line, { muted: true, children: detail }, i))
    ] }) });
  }
  if (!report) return null;
  const usage = /* @__PURE__ */ jsxs(Line, { muted: true, children: [
    formatCount(report.inputTokens),
    " tokens in, ",
    formatCount(report.outputTokens),
    " out, about ",
    formatDollars(report.costUsd),
    " (",
    report.translatorModel,
    report.reviewerModel !== report.translatorModel ? ` and ${report.reviewerModel}` : "",
    ")."
  ] });
  if (job.status === "held") {
    return /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, tone: "caution", border: true, children: /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
      /* @__PURE__ */ jsx(Text, { size: 1, weight: "medium", children: "Held for a person to look at" }),
      report.holdReasons.map((reason, i) => /* @__PURE__ */ jsx(Line, { children: reason }, i)),
      report.check1Failures.slice(0, 10).map((f, i) => /* @__PURE__ */ jsxs(Line, { muted: true, children: [
        f.path,
        ': English "',
        f.source,
        '", ',
        languageTitle,
        ' "',
        f.translated,
        '". ',
        f.note
      ] }, `f${i}`)),
      report.reviewIssues.filter((issue) => issue.severity === "high").slice(0, 10).map((issue, i) => /* @__PURE__ */ jsxs(Line, { muted: true, children: [
        issue.path,
        ": ",
        issue.note
      ] }, `r${i}`)),
      /* @__PURE__ */ jsx(Line, { muted: true, children: report.saved ? `The ${languageTitle} draft was saved so it can be corrected.` : "Nothing was saved." }),
      report.inputTokens > 0 ? usage : null
    ] }) });
  }
  if (!report.saved) {
    return /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, tone: "positive", border: true, children: /* @__PURE__ */ jsxs(Text, { size: 1, weight: "medium", children: [
      "The ",
      languageTitle,
      " is already up to date. Nothing needed translating."
    ] }) });
  }
  const notes = report.reviewIssues.length;
  return /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, tone: "positive", border: true, children: /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
    /* @__PURE__ */ jsxs(Text, { size: 1, weight: "medium", children: [
      languageTitle,
      " draft saved. Both checks passed."
    ] }),
    /* @__PURE__ */ jsxs(Line, { children: [
      report.unitsTranslated,
      " piece(s) of text translated",
      report.unitsReused > 0 ? `, ${report.unitsReused} kept as they were` : "",
      ". ",
      report.check1Checked,
      " string(s) checked for numbers, links and other exact values."
    ] }),
    report.check1Warnings.length > 0 ? /* @__PURE__ */ jsxs(Line, { children: [
      report.check1Warnings.length,
      " value(s) are written in a different format. Worth a look."
    ] }) : null,
    notes > 0 ? /* @__PURE__ */ jsxs(Line, { children: [
      "The reviewer left ",
      notes,
      " note(s), none of them serious."
    ] }) : /* @__PURE__ */ jsx(Line, { children: "The reviewer found nothing to report." }),
    (report.legalPending ?? 0) > 0 ? /* @__PURE__ */ jsxs(Line, { children: [
      report.legalPending,
      " piece(s) of legal text are waiting in Legal approvals. The ",
      languageTitle,
      " page stays unpublished until they are approved."
    ] }) : null,
    (report.legalApproved ?? 0) > 0 ? /* @__PURE__ */ jsxs(Line, { children: [
      report.legalApproved,
      " piece(s) of legal text carry wording that was approved before."
    ] }) : null,
    report.inputTokens > 0 ? usage : /* @__PURE__ */ jsx(Line, { muted: true, children: "No text needed translating, so nothing was sent to Anthropic." }),
    report.published ? /* @__PURE__ */ jsx(Line, { children: "Published: both checks passed and no legal text is waiting." }) : report.status === "approved" ? /* @__PURE__ */ jsxs(Line, { muted: true, children: [
      "Approved and saved as a draft. ",
      report.publishNote ?? "Publish it from the document when ready."
    ] }) : /* @__PURE__ */ jsx(Line, { muted: true, children: "It is a draft. Nothing has been published." })
  ] }) });
}
function TranslateDialog({ options, sourceId, sourceType, onClose }) {
  const client = useClient({ apiVersion: STUDIO_API_VERSION });
  const schema = useSchema();
  const user = useCurrentUser();
  const router = useRouter();
  const language = options.language;
  const targetId = translationId(sourceId, language.id);
  const [existing, setExisting] = useState(void 0);
  const [mode, setMode] = useState("full");
  const [job, setJob] = useState(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState("");
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    client.fetch(
      `*[_id in [$draft, $published]]{ _id, "status": ${I18N_FIELD}.status, "hasHashes": defined(${I18N_FIELD}.sourceHashes) }`,
      { draft: `drafts.${targetId}`, published: targetId },
      { perspective: "raw" }
    ).then((found) => {
      const current = found.find((d) => d._id.startsWith("drafts.")) ?? found[0] ?? null;
      setExisting(current);
      if (current?.hasHashes) setMode("changes");
    }).catch(() => setExisting(null));
    return () => {
      cancelled.current = true;
    };
  }, [client, targetId]);
  const run = useCallback(async () => {
    setRunning(true);
    setProblem("");
    setJob(null);
    try {
      await ensureManifest(client, schema, options);
      const id = await createJob(client, {
        kind: "translate",
        language: language.id,
        mode,
        sourceId,
        sourceType,
        requestedBy: user?.name ?? user?.email ?? user?.id
      });
      void startJob(options.endpoint ?? DEFAULT_ENDPOINT, id).then((message) => {
        if (message && !cancelled.current) setProblem(message);
      });
      const finished2 = await watchJob(client, id, (next) => setJob(next), { cancelled: () => cancelled.current });
      if (!isFinished(finished2) && !cancelled.current) {
        setProblem("This is taking longer than expected. The job may still finish; check the translation in a few minutes.");
      }
    } catch {
      setProblem("The job could not be created. Check that you are allowed to edit this document.");
    }
    setRunning(false);
  }, [client, schema, options, language.id, mode, sourceId, sourceType, user]);
  const finished = isFinished(job);
  const title = language.title;
  return /* @__PURE__ */ jsx(Box, { padding: 4, children: /* @__PURE__ */ jsxs(Stack, { space: 4, children: [
    !running && !finished ? /* @__PURE__ */ jsxs(Stack, { space: 4, children: [
      /* @__PURE__ */ jsxs(Line, { children: [
        "The published English is sent to Anthropic with the API key saved in Site Settings, translated as a whole with the site's glossary and style guide, and checked twice. Legal text goes to the Legal approvals queue. A page with no legal text waiting is published when automatic publishing is on in Site Settings; otherwise it is saved as a ",
        title,
        " draft."
      ] }),
      existing === void 0 ? /* @__PURE__ */ jsxs(Line, { muted: true, children: [
        "Looking for an existing ",
        title,
        " version"
      ] }) : null,
      existing ? /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
        /* @__PURE__ */ jsxs(Line, { children: [
          "A ",
          title,
          " version already exists (",
          translationStatusLabel(existing.status, options.labels),
          ")."
        ] }),
        existing.hasHashes ? /* @__PURE__ */ jsxs(Flex, { align: "center", gap: 2, as: "label", children: [
          /* @__PURE__ */ jsx(Radio, { checked: mode === "changes", onChange: () => setMode("changes"), name: "i18n-mode" }),
          /* @__PURE__ */ jsxs(Line, { children: [
            "Only what changed in the English. The rest of the ",
            title,
            " stays as it is."
          ] })
        ] }) : null,
        /* @__PURE__ */ jsxs(Flex, { align: "center", gap: 2, as: "label", children: [
          /* @__PURE__ */ jsx(Radio, { checked: mode === "full", onChange: () => setMode("full"), name: "i18n-mode" }),
          /* @__PURE__ */ jsxs(Line, { children: [
            "The whole document again. This replaces the ",
            title,
            " draft, including any edits made to it by hand."
          ] })
        ] })
      ] }) : null
    ] }) : null,
    running ? /* @__PURE__ */ jsxs(Flex, { align: "center", gap: 3, children: [
      /* @__PURE__ */ jsx(Spinner, { muted: true }),
      /* @__PURE__ */ jsx(Line, { children: job?.progress && job.status === "running" ? `${job.progress}...` : "Starting..." })
    ] }) : null,
    problem && !finished ? /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, tone: "critical", border: true, children: /* @__PURE__ */ jsx(Line, { children: problem }) }) : null,
    finished && job ? /* @__PURE__ */ jsx(JobOutcomeView, { job, languageTitle: title }) : null,
    /* @__PURE__ */ jsxs(Flex, { gap: 2, justify: "flex-end", children: [
      finished && job?.report?.saved ? /* @__PURE__ */ jsx(
        Button,
        {
          text: `Open the ${title} draft`,
          tone: "primary",
          onClick: () => {
            onClose();
            router.navigateIntent("edit", { id: targetId, type: sourceType });
          }
        }
      ) : null,
      !running && !finished ? /* @__PURE__ */ jsx(Button, { text: `Translate to ${title}`, tone: "primary", disabled: existing === void 0, onClick: () => void run() }) : null,
      /* @__PURE__ */ jsx(Button, { text: finished ? "Close" : "Cancel", mode: "ghost", disabled: running, onClick: onClose })
    ] })
  ] }) });
}
function translateAction(options) {
  const defaultId = options.languages.defaultLanguage.id;
  const language = options.language;
  const TranslateAction = (props) => {
    const client = useClient({ apiVersion: STUDIO_API_VERSION });
    const enabled = useEnabledLanguageIds(client, options);
    const [open, setOpen] = useState(false);
    const current = props.draft ?? props.published;
    const documentLanguage2 = current?.[LANGUAGE_FIELD];
    if (typeof documentLanguage2 === "string" && documentLanguage2 !== "" && documentLanguage2 !== defaultId) return null;
    if (!enabled || !enabled.includes(language.id)) return null;
    const close = () => {
      setOpen(false);
      props.onComplete();
    };
    return {
      label: `Translate to ${language.title}`,
      icon: TranslateIcon,
      disabled: !props.published,
      title: props.published ? void 0 : "Publish this document first. The published version is what gets translated.",
      onHandle: () => setOpen(true),
      dialog: open ? {
        type: "dialog",
        header: `Translate to ${language.title}`,
        onClose: close,
        content: /* @__PURE__ */ jsx(TranslateDialog, { options, sourceId: props.id, sourceType: props.type, onClose: close })
      } : null
    };
  };
  TranslateAction.displayName = `TranslateTo_${language.id}`;
  return TranslateAction;
}
var cell = { padding: "10px 12px", textAlign: "right", borderBottom: "1px solid var(--card-border-color)" };
var firstCell = { ...cell, textAlign: "left" };
function summarise(sources, translations, types) {
  const bySource = /* @__PURE__ */ new Map();
  for (const row of translations) {
    if (!row.source) continue;
    const current = bySource.get(row.source);
    if (!current || row._id.startsWith("drafts.")) bySource.set(row.source, row);
  }
  return types.map((type) => {
    const counts = { type, total: 0, translated: 0, needsUpdate: 0, awaitingApproval: 0, approved: 0, work: [] };
    for (const source of sources) {
      if (source._type !== type) continue;
      counts.total++;
      const translation = bySource.get(source._id);
      if (!translation) {
        counts.work.push({ sourceId: source._id, mode: "full" });
        continue;
      }
      counts.translated++;
      if (translation.status === "needs_update" || translation.stale) {
        counts.needsUpdate++;
        counts.work.push({ sourceId: source._id, mode: translation.hasHashes ? "changes" : "full" });
      } else if (translation.status === "awaiting_approval") counts.awaitingApproval++;
      else if (translation.status === "approved") counts.approved++;
    }
    return counts;
  });
}
function TranslationsToolView({ tool }) {
  const options = tool.options;
  const client = useClient({ apiVersion: STUDIO_API_VERSION });
  const schema = useSchema();
  const user = useCurrentUser();
  const defaultLanguage = options.languages.defaultLanguage;
  const enabledIds = useEnabledLanguageIds(client, options);
  const targets = useMemo(
    () => options.languages.languages.filter((l) => l.id !== defaultLanguage.id && (enabledIds ?? []).includes(l.id)),
    [options.languages, defaultLanguage.id, enabledIds]
  );
  const [languageId, setLanguageId] = useState("");
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(/* @__PURE__ */ new Set());
  const [hasKey, setHasKey] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [problem, setProblem] = useState("");
  const [items, setItems] = useState([]);
  const [runningBulk, setRunningBulk] = useState(false);
  const stop = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
    };
  }, []);
  useEffect(() => {
    if (!languageId && targets.length > 0) setLanguageId(targets[0].id);
  }, [languageId, targets]);
  const language = targets.find((l) => l.id === languageId);
  const typeTitle = useCallback((type) => options.titles?.[type] ?? type, [options.titles]);
  const load = useCallback(async () => {
    if (!languageId) return;
    const types = [...options.translatableTypes];
    const [sources, translations, keyCount] = await Promise.all([
      client.fetch(
        `*[_type in $types && (${LANGUAGE_FIELD} == $default || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))]{ _id, _type }`,
        { types, default: defaultLanguage.id },
        { perspective: "raw" }
      ),
      client.fetch(
        `*[_type in $types && ${LANGUAGE_FIELD} == $lang]{ _id, _type, "source": ${I18N_FIELD}.source._ref, "status": ${I18N_FIELD}.status, "hasHashes": defined(${I18N_FIELD}.sourceHashes), "stale": defined(${I18N_FIELD}.staleSince) }`,
        { types, lang: languageId },
        { perspective: "raw" }
      ),
      client.fetch(`count(*[_id == $id && defined(anthropicKey.ciphertext)])`, { id: SECRETS_ID })
    ]);
    if (!alive.current) return;
    setRows(summarise(sources, translations, types));
    setHasKey(keyCount > 0);
  }, [client, languageId, options.translatableTypes, defaultLanguage.id]);
  useEffect(() => {
    setRows(null);
    setEstimate(null);
    void load().catch(() => setProblem("The translation counts could not be loaded."));
  }, [load]);
  const chosen = useMemo(() => (rows ?? []).filter((r) => selected.size === 0 || selected.has(r.type)), [rows, selected]);
  const work = useMemo(() => chosen.flatMap((r) => r.work.map((w) => ({ ...w, type: r.type }))), [chosen]);
  const selectionKey = `${languageId}|${chosen.map((r) => r.type).join(",")}|${work.length}`;
  const scope = selected.size === 0 ? "all types" : `${selected.size} selected type(s)`;
  const toggle = (type) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };
  const runEstimate = useCallback(async () => {
    if (!language || work.length === 0) return;
    setEstimating(true);
    setProblem("");
    setEstimate(null);
    try {
      await ensureManifest(client, schema, options);
      const id = await createJob(client, {
        kind: "estimate",
        language: language.id,
        sourceIds: work.map((w) => w.sourceId),
        requestedBy: user?.name ?? user?.email ?? user?.id
      });
      void startJob(options.endpoint ?? DEFAULT_ENDPOINT, id).then((message) => {
        if (message && alive.current) setProblem(message);
      });
      const job = await watchJob(client, id, () => void 0, { cancelled: () => !alive.current });
      if (!alive.current) return;
      if (job?.status === "done" && job.estimate) setEstimate({ key: selectionKey, value: job.estimate });
      else if (job?.status === "failed") setProblem(job.error?.message ?? "The estimate could not be made.");
      else if (!isFinished(job)) setProblem("The estimate is taking longer than expected. Try again in a moment.");
    } catch {
      setProblem("The estimate could not be started. Check that you are allowed to edit content.");
    }
    if (alive.current) setEstimating(false);
  }, [client, schema, options, language, work, user, selectionKey]);
  const runBulk = useCallback(async () => {
    if (!language || work.length === 0) return;
    stop.current = false;
    setRunningBulk(true);
    setProblem("");
    const queue = work.map((w) => ({ sourceId: w.sourceId, type: w.type, mode: w.mode, state: "waiting" }));
    setItems(queue);
    const update = (index, patch) => {
      queue[index] = { ...queue[index], ...patch };
      if (alive.current) setItems([...queue]);
    };
    try {
      await ensureManifest(client, schema, options);
    } catch {
      setProblem("The run could not be started. Check that you are allowed to edit content.");
      setRunningBulk(false);
      return;
    }
    let next = 0;
    const worker = async () => {
      while (!stop.current) {
        const index = next++;
        if (index >= queue.length) return;
        const item = queue[index];
        update(index, { state: "running" });
        try {
          const id = await createJob(client, {
            kind: "translate",
            language: language.id,
            mode: item.mode,
            sourceId: item.sourceId,
            sourceType: item.type,
            requestedBy: user?.name ?? user?.email ?? user?.id
          });
          let refused = null;
          void startJob(options.endpoint ?? DEFAULT_ENDPOINT, id).then((message) => {
            refused = message;
          });
          const job = await watchJob(client, id, () => void 0, { cancelled: () => !alive.current || refused !== null });
          if (job?.status === "done") {
            const r = job.report;
            update(index, { state: "done", message: !r?.saved ? "Already up to date" : r.published ? "Published" : r.status === "awaiting_approval" ? "Draft saved, legal text awaiting approval" : "Draft saved" });
          } else if (job?.status === "held") update(index, { state: "held", message: job.report?.holdReasons[0] ?? "Held for a person to look at" });
          else update(index, { state: "failed", message: job?.error?.message ?? refused ?? "Did not finish in time" });
        } catch {
          update(index, { state: "failed", message: "The job could not be created" });
        }
      }
    };
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 5));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (alive.current) {
      setRunningBulk(false);
      setEstimate(null);
      void load();
    }
  }, [client, schema, options, language, work, user, load]);
  const done = items.filter((i) => i.state === "done").length;
  const held = items.filter((i) => i.state === "held").length;
  const failed = items.filter((i) => i.state === "failed").length;
  const estimateIsCurrent = estimate?.key === selectionKey;
  if (enabledIds === null) {
    return /* @__PURE__ */ jsx(Flex, { padding: 5, justify: "center", children: /* @__PURE__ */ jsx(Spinner, { muted: true }) });
  }
  return /* @__PURE__ */ jsx(Container, { width: 4, padding: 4, children: /* @__PURE__ */ jsxs(Stack, { space: 5, children: [
    /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
      /* @__PURE__ */ jsx(Heading, { size: 2, children: "Translations" }),
      /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: 'Where every translatable document stands, per language. Estimate the cost before a run. A run saves drafts; a translation that passes both checks and carries no legal text waiting for approval goes live on its own when "Publish marketing pages automatically" is on in Site Settings. Legal text waits in Legal approvals.' })
    ] }),
    targets.length === 0 ? /* @__PURE__ */ jsx(Card, { padding: 4, radius: 2, border: true, tone: "transparent", children: /* @__PURE__ */ jsx(Text, { size: 1, children: "No other language is switched on yet. Switch one on in Site Settings under Languages." }) }) : /* @__PURE__ */ jsxs(Stack, { space: 4, children: [
      targets.length > 1 ? /* @__PURE__ */ jsx(Box, { style: { maxWidth: 280 }, children: /* @__PURE__ */ jsx(Select, { value: languageId, onChange: (event) => setLanguageId(event.currentTarget.value), children: targets.map((l) => /* @__PURE__ */ jsx("option", { value: l.id, children: l.title }, l.id)) }) }) : /* @__PURE__ */ jsx(Heading, { size: 1, children: language?.nativeTitle ? `${language.title} (${language.nativeTitle})` : language?.title }),
      hasKey === false ? /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, border: true, tone: "caution", children: /* @__PURE__ */ jsx(Text, { size: 1, children: "No Anthropic API key is saved yet. Add it in Site Settings under Languages. An estimate still works without one, from the length of the text." }) }) : null,
      /* @__PURE__ */ jsx(Card, { radius: 2, border: true, style: { overflowX: "auto" }, children: rows === null ? /* @__PURE__ */ jsx(Flex, { padding: 4, justify: "center", children: /* @__PURE__ */ jsx(Spinner, { muted: true }) }) : /* @__PURE__ */ jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsx("tr", { children: ["Document type", "Total", "Translated", "Needs update", translationStatusLabel("awaiting_approval", options.labels), translationStatusLabel("approved", options.labels), "To do"].map(
          (heading, i) => /* @__PURE__ */ jsx("th", { style: i === 0 ? firstCell : cell, children: /* @__PURE__ */ jsx(Text, { size: 1, weight: "medium", children: heading }) }, heading)
        ) }) }),
        /* @__PURE__ */ jsx("tbody", { children: rows.map((row) => /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("td", { style: firstCell, children: /* @__PURE__ */ jsxs(Flex, { align: "center", gap: 2, as: "label", children: [
            /* @__PURE__ */ jsx(Checkbox, { checked: selected.has(row.type), onChange: () => toggle(row.type), disabled: runningBulk }),
            /* @__PURE__ */ jsx(Text, { size: 1, children: typeTitle(row.type) })
          ] }) }),
          [row.total, row.translated, row.needsUpdate, row.awaitingApproval, row.approved, row.work.length].map((value, i) => /* @__PURE__ */ jsx("td", { style: cell, children: /* @__PURE__ */ jsx(Text, { size: 1, muted: value === 0, children: formatCount(value) }) }, i))
        ] }, row.type)) })
      ] }) }),
      /* @__PURE__ */ jsxs(Text, { size: 1, muted: true, children: [
        '"To do" counts documents with no ',
        language?.title,
        " version yet, plus the ones marked Needs update or re-locked because the English changed. Tick types to limit a run; with nothing ticked a run covers all of them."
      ] }),
      /* @__PURE__ */ jsxs(Flex, { gap: 2, align: "center", wrap: "wrap", children: [
        /* @__PURE__ */ jsx(
          Button,
          {
            text: estimating ? "Estimating" : `Estimate cost for ${scope}`,
            mode: "ghost",
            disabled: estimating || runningBulk || work.length === 0,
            onClick: () => void runEstimate()
          }
        ),
        /* @__PURE__ */ jsx(
          Button,
          {
            text: `Translate ${formatCount(work.length)} document(s)`,
            tone: "primary",
            disabled: !estimateIsCurrent || runningBulk || estimating || work.length === 0 || hasKey === false,
            onClick: () => void runBulk()
          }
        ),
        runningBulk ? /* @__PURE__ */ jsx(Button, { text: "Stop after the current ones", mode: "ghost", tone: "critical", onClick: () => stop.current = true }) : null,
        !estimateIsCurrent && work.length > 0 && !runningBulk ? /* @__PURE__ */ jsx(Text, { size: 1, muted: true, children: "Estimate first. The cost is shown before anything runs." }) : null
      ] }),
      problem ? /* @__PURE__ */ jsx(Card, { padding: 3, radius: 2, border: true, tone: "critical", children: /* @__PURE__ */ jsx(Text, { size: 1, children: problem }) }) : null,
      estimateIsCurrent && estimate ? /* @__PURE__ */ jsx(Card, { padding: 4, radius: 2, border: true, tone: "primary", children: /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
        /* @__PURE__ */ jsxs(Text, { size: 2, weight: "medium", children: [
          "About ",
          formatDollars(estimate.value.costUsd),
          " for ",
          formatCount(estimate.value.documents),
          " document(s)"
        ] }),
        /* @__PURE__ */ jsxs(Text, { size: 1, children: [
          formatCount(estimate.value.inputTokens),
          " tokens in and about ",
          formatCount(estimate.value.outputTokens),
          " out, across ",
          formatCount(estimate.value.strings),
          " strings (",
          formatCount(estimate.value.characters),
          " characters)."
        ] }),
        /* @__PURE__ */ jsxs(Text, { size: 1, muted: true, children: [
          "Translator ",
          estimate.value.translatorModel,
          ", reviewer ",
          estimate.value.reviewerModel,
          ", at Anthropic's published rates as of ",
          estimate.value.ratesAsOf,
          ". ",
          estimate.value.note,
          " Documents that only need an update usually cost less than shown, because only what changed is sent. Anthropic bills the account that owns the API key."
        ] })
      ] }) }) : null,
      items.length > 0 ? /* @__PURE__ */ jsx(Card, { padding: 4, radius: 2, border: true, children: /* @__PURE__ */ jsxs(Stack, { space: 3, children: [
        /* @__PURE__ */ jsxs(Flex, { align: "center", gap: 3, children: [
          runningBulk ? /* @__PURE__ */ jsx(Spinner, { muted: true }) : null,
          /* @__PURE__ */ jsxs(Text, { size: 1, weight: "medium", children: [
            done + held + failed,
            " of ",
            items.length,
            " finished: ",
            done,
            " saved, ",
            held,
            " held, ",
            failed,
            " failed"
          ] })
        ] }),
        items.filter((i) => i.state !== "waiting").slice(-40).map((item) => /* @__PURE__ */ jsxs(Text, { size: 1, muted: item.state === "done", children: [
          typeTitle(item.type),
          " ",
          item.sourceId,
          ": ",
          item.state === "running" ? "working" : item.message ?? item.state
        ] }, item.sourceId))
      ] }) }) : null
    ] })
  ] }) });
}
function translationsTool(options) {
  return {
    name: "translations",
    title: "Translations",
    icon: TranslateIcon,
    component: TranslationsToolView,
    options
  };
}

// src/sanity/plugin.ts
var I18N_PLUGIN_NAME = "kaleidico-i18n";
var I18N_HIDDEN_TYPES = [TRANSLATION_META_TYPE, ...ENGINE_DOCUMENT_TYPES, LEGAL_APPROVAL_TYPE];
var i18nPlugin = definePlugin((config) => {
  const languages = defineLanguages(config.languages);
  const translatableTypes = [...config.translatableTypes ?? []];
  const badge = translationBadge({ defaultId: languages.defaultLanguage.id, labels: config.labels });
  const engineOn = config.engine !== false && translatableTypes.length > 0;
  const engineConfig = config.engine ? config.engine : {};
  const engine = { languages, translatableTypes, ...engineConfig };
  const translateActions = engineOn ? languages.languages.filter((language) => language.id !== languages.defaultLanguage.id).map((language) => translateAction({ ...engine, language, labels: config.labels })) : [];
  const wrappedPublish = /* @__PURE__ */ new WeakMap();
  const wrap = (action) => {
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
      types: translatableTypes.length > 0 ? [
        translationMetaType({ translatableTypes }),
        ...engineOn ? [translationJobType(), translationSecretsType(), translationManifestType(), legalApprovalType()] : []
      ] : []
    },
    document: {
      badges: (prev, context) => translatableTypes.includes(context.schemaType) ? [...prev, badge] : prev,
      actions: (prev, context) => {
        if (!engineOn || !translatableTypes.includes(context.schemaType)) return prev;
        return [...prev.map((action) => action.action === "publish" ? wrap(action) : action), ...translateActions];
      },
      // The bookkeeping documents are made by the package, never by hand.
      newDocumentOptions: (prev) => prev.filter((template) => !I18N_HIDDEN_TYPES.includes(template.templateId))
    },
    tools: engineOn ? [translationsTool({ ...engine, titles: config.titles, labels: config.labels }), legalApprovalsTool({ ...engine, titles: config.titles, labels: config.labels })] : [],
    // Not a Sanity option; harmless extra property that later parts read.
    ...{ i18n: { languages, translatableTypes, engine: engineOn } }
  };
});
var notTranslated = { i18n: { translate: false } };
function grouped(options) {
  const group = options.group === void 0 ? LANGUAGES_GROUP.name : options.group;
  return group ? { group } : {};
}
function glossaryField(options = {}) {
  return defineField({
    name: options.name ?? GLOSSARY_FIELD,
    title: "Translation glossary",
    type: "object",
    description: "Applied to every translation. Change it here and later translations follow it; existing ones are not changed.",
    options: { collapsible: true, collapsed: true, ...notTranslated },
    fields: [
      defineField({
        name: "doNotTranslate",
        title: "Never translate",
        type: "array",
        of: [{ type: "string" }],
        options: { layout: "tags" },
        description: "Names that stay exactly as written in every language: the company, its brands, products and programs, abbreviations."
      }),
      defineField({
        name: "terms",
        title: "Fixed terms",
        type: "array",
        description: "A term on the left is always translated with the term on the right.",
        of: [
          {
            type: "object",
            name: "term",
            fields: [
              defineField({ name: "source", title: "English term", type: "string", validation: (rule) => rule.required() }),
              defineField({ name: "target", title: "Translation", type: "string", validation: (rule) => rule.required() }),
              defineField({ name: "note", title: "Note", type: "string", description: "When to use it, or that it still needs confirming." })
            ],
            preview: {
              select: { source: "source", target: "target", note: "note" },
              prepare: ({ source, target, note }) => ({ title: `${source ?? ""} = ${target ?? ""}`, subtitle: note })
            }
          }
        ]
      })
    ],
    ...grouped(options)
  });
}
function styleGuideField(options = {}) {
  return defineField({
    name: options.name ?? STYLE_GUIDE_FIELD,
    title: "Translation style guide",
    type: "object",
    description: "How translations should read. Applied to every translation.",
    options: { collapsible: true, collapsed: true, ...notTranslated },
    fields: [
      defineField({
        name: "market",
        title: "Market",
        type: "string",
        initialValue: "es-US",
        description: "Who the translation is for, as a language and country code. es-US is Spanish as used in the United States."
      }),
      defineField({
        name: "register",
        title: "Register",
        type: "string",
        initialValue: "usted",
        options: {
          layout: "radio",
          list: [
            { title: "Usted (formal)", value: "usted" },
            { title: "T\xFA (informal)", value: "tu" }
          ]
        },
        description: "How the reader is addressed in Spanish. One choice for the whole site."
      }),
      defineField({
        name: "audience",
        title: "Audience",
        type: "text",
        rows: 3,
        description: "Who reads the site, in a sentence or two. For example: first-time home buyers and homeowners thinking about refinancing."
      }),
      defineField({
        name: "notes",
        title: "Notes",
        type: "text",
        rows: 4,
        description: "Anything else a translator should know: words to avoid, tone, how to write dates."
      })
    ],
    ...grouped(options)
  });
}
var modelList = MODELS.map((m) => ({ title: `${m.title}. ${m.note}`, value: m.id }));
function engineField(options = {}) {
  return defineField({
    name: options.name ?? ENGINE_FIELD,
    title: "Translation engine",
    type: "object",
    description: "Which Claude models do the work. Usage is billed by Anthropic to the account that owns the API key below.",
    options: { collapsible: true, collapsed: true, ...notTranslated },
    fields: [
      defineField({
        name: "translatorModel",
        title: "Translator model",
        type: "string",
        initialValue: DEFAULT_TRANSLATOR_MODEL,
        options: { list: modelList },
        description: "Translates each document as a whole."
      }),
      defineField({
        name: "reviewerModel",
        title: "Reviewer model",
        type: "string",
        initialValue: DEFAULT_REVIEWER_MODEL,
        options: { list: modelList },
        description: "Reads the English and the translation side by side in a separate pass and flags problems for a person."
      }),
      defineField({
        name: "autoPublishMarketing",
        title: "Publish marketing pages automatically",
        type: "boolean",
        initialValue: true,
        description: "On: a translation goes live as soon as both checks pass and no legal text on it is waiting for approval. Off: every translation stays a draft until a person publishes it. Legal text always waits for an approver either way."
      })
    ],
    ...grouped(options)
  });
}
function legalApproversField(options = {}) {
  return defineField({
    name: options.name ?? LEGAL_APPROVERS_FIELD,
    title: "Legal approvers",
    type: "array",
    of: [{ type: "string", validation: (rule) => rule.email() }],
    options: { layout: "tags", ...notTranslated },
    validation: (rule) => rule.unique(),
    description: "Email addresses of the people who may approve or send back legal text in another language, exactly as they sign in to the Studio. Everyone else can see the Legal approvals queue but not decide.",
    ...grouped(options)
  });
}
function apiKeyField(options = {}) {
  return defineField({
    name: options.name ?? API_KEY_FIELD,
    title: "Anthropic API key",
    type: "string",
    description: "The site owner's own Anthropic API key. Entered once, stored encrypted, never shown again. Translation usage is billed by Anthropic to the account that owns this key.",
    components: { input: ApiKeyInput },
    options: { i18n: { translate: false, publicKey: options.publicKey ?? "" } },
    ...grouped(options)
  });
}

// src/core/hosts.ts
function text3(value) {
  return typeof value === "string" ? value.trim() : "";
}
function normaliseHostPatterns(patterns) {
  const out = [];
  for (const raw of patterns ?? []) {
    let host = text3(raw).toLowerCase();
    if (host === "") continue;
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\/\//, "");
    host = host.split(/[/?#]/)[0].replace(/:\d+$/, "");
    if (host !== "" && !out.includes(host)) out.push(host);
  }
  return out;
}
function linkHost(href, base) {
  const value = text3(href);
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
function isObject4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text4(value) {
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
  if (!isObject4(local)) return blocked("There is no approved Site Settings translation in this language.");
  const i18n = isObject4(local[I18N_FIELD]) ? local[I18N_FIELD] : {};
  if (i18n.status !== "approved") return blocked("The Site Settings translation in this language is not approved.");
  const value = isObject4(local[fieldName]) ? local[fieldName] : {};
  const body = text4(value.body);
  if (body === "") return blocked("The notice has no wording in this language.");
  const legal = isObject4(i18n.legal) ? i18n.legal : {};
  const paths = Array.isArray(legal.paths) ? legal.paths : [];
  const record = paths.find((p) => p.path === `${fieldName}.body`);
  if (!record || record.status !== "approved") return blocked("The notice wording in this language has not been approved.");
  const entry = approvalOf(input.approvals, String(record.unitId ?? ""));
  if (!entry || entry.status !== "approved") return blocked("The approval for the notice wording in this language is missing or no longer stands.");
  if (normaliseLegalText(text4(entry.translatedText)) !== normaliseLegalText(body)) return blocked("The notice wording in this language differs from the approved wording.");
  const title = text4(value.title);
  const continueLabel = text4(value.continueLabel);
  const cancelLabel = text4(value.cancelLabel);
  if (title === "" || continueLabel === "" || cancelLabel === "") return blocked("The notice is missing its title or a button label in this language.");
  return { state: "active", hosts, notice: { title, body, continueLabel, cancelLabel }, reason: "The notice wording in this language is approved." };
}

// src/sanity/applyNoticeField.ts
function applyNoticeField(options = {}) {
  const group = options.group === void 0 ? LANGUAGES_GROUP.name : options.group;
  const hosts = [...options.defaultAppliesTo ?? []];
  return defineField({
    name: options.name ?? APPLY_NOTICE_FIELD,
    title: "Notice before an English-only application",
    type: "object",
    description: "Shown on pages in another language before a visitor follows a link to the hosts listed here. English pages never show it. Write the wording in English; its translation is legal text and waits for approval. Until the translated wording is approved, pages in that language hide these links.",
    options: { collapsible: true, collapsed: true },
    fields: [
      noTranslate(
        defineField({
          name: "enabled",
          title: "Show the notice",
          type: "boolean",
          initialValue: true,
          description: "On unless switched off. Off: links to these hosts are left alone in every language."
        })
      ),
      noTranslate(
        defineField({
          name: "appliesTo",
          title: "Applies to links to",
          type: "array",
          of: [{ type: "string" }],
          options: { layout: "tags" },
          ...hosts.length > 0 ? { initialValue: hosts } : {},
          description: `Host names, one per entry, such as apply.example.com. A leading *. covers every subdomain.${hosts.length > 0 ? ` Left empty: ${hosts.join(", ")}.` : ""}`
        })
      ),
      defineField({ name: "title", title: "Title", type: "string" }),
      legalText(
        defineField({
          name: "body",
          title: "Wording",
          type: "text",
          rows: 4,
          description: "What the visitor is told before continuing, for example that the application is in English only."
        })
      ),
      defineField({ name: "continueLabel", title: "Continue button", type: "string" }),
      defineField({ name: "cancelLabel", title: "Cancel button", type: "string" })
    ],
    ...group ? { group } : {}
  });
}

export { API_KEY_FIELD, APPLY_NOTICE_FIELD, ApiKeyInput, DEFAULT_APPROVE_ENDPOINT, DEFAULT_ENDPOINT, DEFAULT_LANGUAGE_ID, DEFAULT_REQUIRED_DEPENDENCY_TYPES, DEFAULT_REVIEWER_MODEL, DEFAULT_TRANSLATOR_MODEL, ENGINE_DOCUMENT_TYPES, ENGINE_FIELD, ENGINE_SETTINGS_FIELDS, GLOSSARY_FIELD, I18N_FIELD, I18N_HIDDEN_TYPES, I18N_MARKER, I18N_PLUGIN_NAME, JOB_ID_PREFIX, JOB_TYPE, JobOutcomeView, KEY_STORAGE_NOT_CONFIGURED, LANGUAGES_GROUP, LANGUAGE_FIELD, LEGAL_APPROVAL_ID_PREFIX, LEGAL_APPROVAL_TYPE, LEGAL_APPROVERS_FIELD, APPROVER_NOTICE as LEGAL_APPROVER_NOTICE, LEGAL_NOTE, MANIFEST_ID, MANIFEST_TYPE, MODELS, NON_TEXT_FIELD_NAME, RATES_AS_OF, SECRETS_ID, SECRETS_TYPE, STYLE_GUIDE_FIELD, TRANSLATION_BADGE_COLORS, TRANSLATION_META_ID_PREFIX, TRANSLATION_META_TYPE, TRANSLATION_STATUSES, apiKeyField, applyLegalValue, applyNoticeField, buildFieldManifest, buildLog, checkTranslationForPublish, collectLegalPaths, collectReferences, createJob, defineLanguages, dependencyReasons, diffSource, encryptSecret, engineField, ensureManifest, extractUnits, getSharedFields, getTranslatableMarker, glossaryField, i18nPlugin, isLegal, isLegalApprover, isTranslatable, isTranslationDocument, languageFieldKey, languageFilter, languagesField, legalApprovalId, legalApprovalType, legalApprovalsTool, legalApproversField, legalBlock, legalPathSegments, legalRecordField, legalSourceHash, legalText, legalUnitsOf, matchesApplyHost, noTranslate, normaliseLegalText, occurrenceKey, parseLegalValue, planDependencies, planLegalRegistry, planStaleTranslations, publicKeyFingerprint, publishTranslationAction, publishWithStaleCheck, readEnabledLanguages, readEngineSettings, readGlossary, readLegalApprovers, readStyleGuide, reportField, reportFields, resolveApplyNotice, resubmitLegalUnit, sourceHashes, sourceHashesField, staleSinceField, staleToast, startJob, statusAfterRun, styleGuideField, summarise as summariseTranslations, toSlug, translatable, translateAction, translationBadge, translationId, translationJobType, translationManifestType, translationMetaId, translationMetaType, translationSecretsType, translationStatusLabel, translationStatusList, translationsStructure, translationsTool, unitText, useLegalApprovers, watchJob };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map