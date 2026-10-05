import Anthropic from '@anthropic-ai/sdk';

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
function modelInfo(id) {
  return MODELS.find((m) => m.id === id);
}
function costOf(usage, modelId) {
  const model = modelInfo(modelId);
  if (!model) return 0;
  const dollars = (usage.inputTokens * model.inputPerMTok + usage.outputTokens * model.outputPerMTok + (usage.cacheReadTokens ?? 0) * model.cacheReadPerMTok + (usage.cacheWriteTokens ?? 0) * model.cacheWritePerMTok) / 1e6;
  return Math.round(dollars * 1e6) / 1e6;
}
var CHARS_PER_TOKEN = 3;
var TRANSLATION_OUTPUT_FACTOR = 1.6;
var REVIEW_INPUT_FACTOR = 2.3;
var REVIEW_OUTPUT_TOKENS = 1500;

// src/core/engineModel.ts
var SECRETS_ID = "i18n.secrets";
var MANIFEST_ID = "i18n.manifest";
var JOB_TYPE = "i18n.job";
var JOB_ID_PREFIX = "i18n.job.";
var GLOSSARY_FIELD = "i18nGlossary";
var STYLE_GUIDE_FIELD = "i18nStyleGuide";
var ENGINE_FIELD = "i18nEngine";
var LEGAL_APPROVERS_FIELD = "i18nLegalApprovers";
var DEFAULT_STYLE_GUIDE = { market: "es-US", register: "usted", audience: "", notes: "" };
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
async function sha256Bytes(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function publicKeyFingerprint(publicKey) {
  return (await sha256Bytes(fromBase64(publicKey))).slice(0, 16);
}

// src/engine/errors.ts
var KEY_STORAGE_NOT_CONFIGURED = "Translation key storage is not configured on this server yet.";
var MESSAGES = {
  bad_request: "The request did not name a translation job.",
  job_not_found: "That translation job does not exist.",
  job_not_pending: "That translation job has already been started.",
  source_missing: "The English document has not been published yet. Publish it, then translate it.",
  source_not_default_language: "Only a document in the default language can be translated.",
  language_unknown: "That language is not set up for this site.",
  language_not_enabled: "That language is switched off in Site Settings. Switch it on under Languages first.",
  type_not_translatable: "This kind of document is not set up for translation.",
  manifest_missing: "The server does not have the list of translatable fields yet. Open the Studio once and try again.",
  key_storage_not_configured: `${KEY_STORAGE_NOT_CONFIGURED} Ask your developer to add the two I18N keys to the hosting environment.`,
  missing_key: "No Anthropic API key has been saved. Add it in Site Settings under Languages.",
  key_unreadable: "The saved API key cannot be read by this server. Enter the key again in Site Settings under Languages.",
  key_rejected: "Anthropic did not accept the API key. Check that the key is correct and still active, then save it again in Site Settings.",
  billing: "Anthropic reported a billing problem on the account that owns this API key. Check the account's billing, then try again.",
  rate_limited: "Anthropic is limiting how fast this API key can be used right now. Wait a few minutes and try again.",
  service_unavailable: "Anthropic's service is busy or unavailable right now. Try again in a few minutes.",
  network: "The server could not reach Anthropic. Try again in a moment.",
  timeout: "The translation took longer than the server allows. Try again; if it keeps happening the document may be too large for one run.",
  model_unavailable: "The chosen model is not available to this API key. Choose another model in Site Settings under Languages.",
  request_rejected: "Anthropic did not accept the request.",
  document_too_large: "This document is too large to translate in one run.",
  structure_mismatch: "The translation came back with a different structure from the English, even after a second attempt. Nothing was saved.",
  check_failed: "A number, link or other exact value in the translation does not match the English. Nothing was saved.",
  declined: "The model declined to translate this document. Nothing was saved.",
  dataset: "The server could not read or write the content. Check the site's Sanity token.",
  wrong_route: "That job belongs to another route.",
  unit_not_found: "That piece of legal text is not in the approval queue.",
  unit_not_pending: "That piece of legal text is not waiting for a decision.",
  comment_required: "A comment is needed to send legal text back, so the editor knows what to change.",
  not_an_approver: "Only a listed legal approver can approve or send back legal text. The list is in Site Settings under Languages.",
  approver_unverified: "The approver could not be verified, so nothing was changed. Try again in a moment.",
  unexpected: "Something unexpected went wrong. Nothing was saved."
};
var EngineError = class extends Error {
  code;
  /** Extra detail that is safe to show: a list of paths, a model id. Never a key or document content. */
  details;
  constructor(code, options = {}) {
    super(options.message ?? MESSAGES[code]);
    this.name = "EngineError";
    this.code = code;
    this.details = options.details ?? [];
  }
};
function asEngineError(error) {
  if (error instanceof EngineError) return error;
  return new EngineError("unexpected");
}

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

// src/core/manifest.ts
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
function blockHrefs(block) {
  return (block.markDefs ?? []).map((def) => def.href).filter((href) => typeof href === "string");
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
function anchors(source) {
  const out = {};
  if (isObject(source)) {
    if (typeof source._key === "string") out._key = source._key;
    if (typeof source._type === "string") out._type = source._type;
  }
  return out;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function buildPayload(doc, units) {
  const root = {};
  for (const unit of units) {
    let source = doc;
    let out = root;
    const last = unit.segments.length - 1;
    unit.segments.forEach((segment, i) => {
      const isLast = i === last;
      if (typeof segment === "string") {
        const sourceChild2 = isObject(source) ? source[segment] : void 0;
        const target = out;
        if (isLast) {
          target[segment] = clone(unit.value);
        } else {
          if (target[segment] === void 0) {
            if (Array.isArray(sourceChild2)) {
              const unkeyed = sourceChild2.some((m) => !(isObject(m) && typeof m._key === "string" && m._key !== ""));
              target[segment] = unkeyed ? sourceChild2.map((m) => anchors(m)) : [];
            } else {
              target[segment] = anchors(sourceChild2);
            }
          }
          out = target[segment];
        }
        source = sourceChild2;
        return;
      }
      const sourceArray = Array.isArray(source) ? source : [];
      const targetArray = out;
      if (typeof segment === "number") {
        if (isLast) targetArray[segment] = clone(unit.value);
        else out = targetArray[segment];
        source = sourceArray[segment];
        return;
      }
      const sourceChild = sourceArray.find((m) => isObject(m) && m._key === segment._key);
      let existing = targetArray.find((m) => isObject(m) && m._key === segment._key);
      if (isLast) {
        if (!existing) targetArray.push(clone(unit.value));
      } else {
        if (!existing) {
          existing = anchors(sourceChild);
          targetArray.push(existing);
        }
        out = existing;
      }
      source = sourceChild;
    });
  }
  return root;
}
var MAX_ERRORS = 25;
function validateStructure(sent, received) {
  const errors = [];
  const add = (message) => {
    if (errors.length < MAX_ERRORS) errors.push(message);
  };
  const where = (path) => path === "" ? "the top level" : path;
  const compare = (a, b, path, key) => {
    if (errors.length >= MAX_ERRORS) return;
    if (typeof a === "string") {
      if (typeof b !== "string") return add(`${where(path)}: expected text, got ${b === null ? "null" : Array.isArray(b) ? "a list" : typeof b}`);
      if (key === "_key" || key === "_type") {
        if (a !== b) add(`${where(path)}: ${key} must stay ${JSON.stringify(a)}, got ${JSON.stringify(b)}`);
        return;
      }
      if (a.trim() !== "" && b.trim() === "") add(`${where(path)}: the translation is empty`);
      return;
    }
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return add(`${where(path)}: expected a list`);
      if (a.length !== b.length) return add(`${where(path)}: expected ${a.length} item(s), got ${b.length}`);
      a.forEach((item, i) => {
        const label = isObject(item) && typeof item._key === "string" ? `[_key==${JSON.stringify(item._key)}]` : `[${i}]`;
        compare(item, b[i], `${path}${label}`, void 0);
      });
      return;
    }
    if (isObject(a)) {
      if (!isObject(b)) return add(`${where(path)}: expected an object`);
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      for (const k of aKeys) if (!(k in b)) add(`${where(path)}: "${k}" is missing`);
      for (const k of bKeys) if (!(k in a)) add(`${where(path)}: "${k}" was added`);
      if (a._type === "block" && Array.isArray(a.children)) {
        for (const fixed of ["_key", "_type", "style", "listItem", "level", "markDefs"]) {
          if (fixed in a && fixed in b && stableStringify(a[fixed]) !== stableStringify(b[fixed])) {
            add(`${where(path)}: ${fixed} must not change`);
          }
        }
        const aChildren = a.children;
        const bChildren = Array.isArray(b.children) ? b.children : null;
        if (!bChildren) return add(`${where(path)}.children: expected a list`);
        if (aChildren.length !== bChildren.length) {
          return add(`${where(path)}.children: expected ${aChildren.length} span(s), got ${bChildren.length}`);
        }
        aChildren.forEach((child, i) => {
          const ac = isObject(child) ? child : {};
          const bc = bChildren[i];
          const childPath = `${path}.children[${i}]`;
          if (!isObject(bc)) return add(`${childPath}: expected an object`);
          for (const k of Object.keys(ac)) if (!(k in bc)) add(`${childPath}: "${k}" is missing`);
          for (const k of Object.keys(bc)) if (!(k in ac)) add(`${childPath}: "${k}" was added`);
          for (const fixed of ["_key", "_type", "marks"]) {
            if (fixed in ac && fixed in bc && stableStringify(ac[fixed]) !== stableStringify(bc[fixed])) {
              add(`${childPath}: ${fixed} must not change`);
            }
          }
          if (typeof ac.text === "string") {
            if (typeof bc.text !== "string") add(`${childPath}.text: expected text`);
          }
        });
        if (aChildren.some((c) => isObject(c) && typeof c.text === "string" && c.text.trim() !== "")) {
          const translated = bChildren.map((c) => isObject(c) && typeof c.text === "string" ? c.text : "").join("");
          if (translated.trim() === "") add(`${where(path)}: the translation is empty`);
        }
        return;
      }
      for (const k of aKeys) if (k in b) compare(a[k], b[k], path ? `${path}.${k}` : k, k);
      return;
    }
    if (a !== b) add(`${where(path)}: value must stay ${JSON.stringify(a)}`);
  };
  compare(sent, received, "", void 0);
  return errors;
}
function keepEdgeWhitespace(source, translated) {
  const lead = /^\s*/.exec(source)?.[0] ?? "";
  const trail = /\s*$/.exec(source)?.[0] ?? "";
  if (source.trim() === "") return translated;
  return lead + translated.trim() + trail;
}
function readUnit(payload, unit) {
  const value = getAtPath(payload, unit.segments);
  if (unit.kind === "text") return typeof value === "string" ? value : void 0;
  if (unit.kind === "list") {
    return Array.isArray(value) && value.length === unit.value.length && value.every((v) => typeof v === "string") ? value : void 0;
  }
  return isBlock(value) ? pruneBlock(value) : void 0;
}
function applyUnits(target, entries) {
  const missing = [];
  for (const { unit, value } of entries) {
    if (unit.kind === "text" || unit.kind === "list") {
      if (!setAtPath(target, unit.segments, clone(value))) missing.push(unit.path);
      continue;
    }
    const block = getAtPath(target, unit.segments);
    const translated = value;
    const source = unit.value;
    if (!isBlock(block)) {
      missing.push(unit.path);
      continue;
    }
    block.children.forEach((child, i) => {
      if (!isObject(child) || child._type !== "span") return;
      const from = translated.children.find((c) => c._key !== void 0 && c._key === child._key) ?? translated.children[i];
      const original = source.children.find((c) => c._key !== void 0 && c._key === child._key) ?? source.children[i];
      if (from && typeof from.text === "string") {
        child.text = keepEdgeWhitespace(typeof original?.text === "string" ? original.text : "", from.text);
      }
    });
  }
  return missing;
}
function unitPairs(unit, translated) {
  if (unit.kind === "text") return [{ path: unit.path, source: unit.value, translated }];
  if (unit.kind === "list") {
    const source2 = unit.value;
    const target2 = translated;
    return source2.map((s, i) => ({ path: `${unit.path}[${i}]`, source: s, translated: target2[i] ?? "" }));
  }
  const source = unit.value;
  const target = translated;
  return [
    {
      path: unit.path,
      source: blockText(source),
      translated: blockText(target),
      sourceHrefs: blockHrefs(source),
      translatedHrefs: blockHrefs(target)
    }
  ];
}
function unitCharacters(units) {
  let total = 0;
  for (const unit of units) {
    if (unit.kind === "text") total += unit.value.length;
    else if (unit.kind === "list") total += unit.value.reduce((n, s) => n + s.length, 0);
    else total += blockText(unit.value).length;
  }
  return total;
}
function unitStrings(units) {
  let total = 0;
  for (const unit of units) {
    if (unit.kind === "text") total += 1;
    else if (unit.kind === "list") total += unit.value.length;
    else total += unit.value.children.filter((c) => typeof c.text === "string" && c.text !== "").length;
  }
  return total;
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
function sourceFingerprint(entries) {
  return sha256Hex(
    entries.map((e) => `${e.path}
${e.hash}`).sort().join("\n")
  );
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
function normaliseLegalText(text2) {
  return text2.replace(/\s+/g, " ").trim();
}
function legalSourceHash(text2) {
  return sha256Hex(normaliseLegalText(text2));
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
function historyPatch(id, decision2) {
  return [
    { patch: { id, setIfMissing: { history: [] } } },
    { patch: { id, insert: { after: "history[-1]", items: [decision2] } } }
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
      const decision2 = {
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
        history: [decision2],
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
      const decision2 = {
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
        ...historyPatch(id, decision2),
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
function legalPathSegments(path) {
  return parsePath(path);
}

// src/engine/retry.ts
var defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function backoffDelay(attempt, baseDelayMs, maxDelayMs, random) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(exponential / 2 + exponential / 2 * random);
}
async function withRetry(run, options) {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1e3;
  const maxDelayMs = options.maxDelayMs ?? 3e4;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(attempt);
    } catch (error) {
      if (attempt >= maxRetries || options.signal?.aborted || !options.isRetryable(error)) throw error;
      const asked = options.retryAfterMs?.(error);
      const delayMs = asked !== void 0 && asked >= 0 ? Math.min(asked, 6e4) : backoffDelay(attempt, baseDelayMs, maxDelayMs, random());
      options.onRetry?.({ attempt: attempt + 1, delayMs });
      await sleep(delayMs);
    }
  }
}
function createLimiter(concurrency) {
  const limit = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const waiting = [];
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  return async (task) => {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

// src/engine/anthropic.ts
function createAnthropicClient(apiKey, options = {}) {
  return new Anthropic({ apiKey, maxRetries: 0, timeout: options.timeoutMs ?? 24e4 });
}
var MAX_TOKENS = 64e3;
var FALLBACK_BETA = "server-side-fallback-2026-07-01";
function apiMessage(error) {
  const message = error?.message;
  return typeof message === "string" && message !== "" ? [message.slice(0, 300)] : [];
}
function statusOf(error) {
  const status = error?.status;
  return typeof status === "number" ? status : void 0;
}
function isRetryable(error) {
  if (error instanceof Anthropic.APIUserAbortError) return false;
  if (error instanceof Anthropic.RateLimitError) return true;
  if (error instanceof Anthropic.InternalServerError) return true;
  if (error instanceof Anthropic.APIConnectionError) return true;
  const status = statusOf(error);
  return status === 429 || status !== void 0 && status >= 500;
}
function retryAfterMs(error) {
  const headers = error?.headers;
  if (!headers || typeof headers.get !== "function") return void 0;
  const value = headers.get("retry-after");
  if (value === null || value === "") return void 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1e3) : void 0;
}
function toEngineError(error, model) {
  if (error instanceof EngineError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new EngineError("timeout");
  if (error instanceof Anthropic.AuthenticationError) return new EngineError("key_rejected");
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new EngineError("key_rejected", {
      message: "Anthropic did not allow this API key to make the request. Check the key's permissions in the Anthropic Console."
    });
  }
  if (error instanceof Anthropic.NotFoundError) return new EngineError("model_unavailable", { details: [model] });
  if (error instanceof Anthropic.RateLimitError) return new EngineError("rate_limited");
  if (error instanceof Anthropic.BadRequestError) return new EngineError("request_rejected", { details: [model, ...apiMessage(error)] });
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new EngineError("timeout");
  if (error instanceof Anthropic.APIConnectionError) return new EngineError("network");
  if (error instanceof Anthropic.InternalServerError) return new EngineError("service_unavailable");
  const status = statusOf(error);
  if (status === 401 || status === 403) return new EngineError("key_rejected");
  if (status === 402) return new EngineError("billing");
  if (status === 404) return new EngineError("model_unavailable", { details: [model] });
  if (status === 413) return new EngineError("document_too_large");
  if (status === 429) return new EngineError("rate_limited");
  if (status === 400 || status === 422) return new EngineError("request_rejected", { details: [model, ...apiMessage(error)] });
  if (status !== void 0 && status >= 500) return new EngineError("service_unavailable");
  if (error?.name === "AbortError") return new EngineError("timeout");
  return new EngineError("unexpected");
}
function buildParams(call) {
  const info = modelInfo(call.model);
  const outputConfig = {};
  if (call.effort && info?.effort) outputConfig.effort = call.effort;
  if (call.jsonSchema) outputConfig.format = { type: "json_schema", schema: call.jsonSchema };
  return {
    model: call.model,
    max_tokens: Math.min(MAX_TOKENS, info?.maxOutputTokens ?? MAX_TOKENS),
    // The system prompt is the same for every request of a run, so it is
    // cached; a prompt below the model's minimum simply is not.
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: call.messages,
    ...Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}
  };
}
function readAnswer(message, call) {
  if (message.stop_reason === "refusal") throw new EngineError("declined");
  if (message.stop_reason === "max_tokens") throw new EngineError("document_too_large");
  const content = Array.isArray(message.content) ? message.content : [];
  const text2 = content.map((block) => {
    const b = block;
    return b?.type === "text" && typeof b.text === "string" ? b.text : "";
  }).join("");
  return {
    text: text2,
    content,
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage?.cache_creation_input_tokens ?? 0
    },
    servedBy: typeof message.model === "string" && message.model !== "" ? message.model : call.model
  };
}
async function callModel(client, call, policy = {}) {
  const params = buildParams(call);
  const requestOptions = {};
  if (policy.signal) requestOptions.signal = policy.signal;
  if (policy.timeoutMs) requestOptions.timeout = policy.timeoutMs;
  const send = (withFallback) => withFallback ? client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" }, requestOptions).finalMessage() : client.messages.stream(params, requestOptions).finalMessage();
  const useFallback = modelInfo(call.model)?.fallbacks === true;
  try {
    const message = await withRetry(
      async () => {
        if (!useFallback) return send(false);
        try {
          return await send(true);
        } catch (error) {
          if (error instanceof Anthropic.BadRequestError || statusOf(error) === 400) return send(false);
          throw error;
        }
      },
      { ...policy.retry, isRetryable, retryAfterMs, signal: policy.signal }
    );
    return readAnswer(message, call);
  } catch (error) {
    throw toEngineError(error, call.model);
  }
}
async function countTokens(client, call, policy = {}) {
  try {
    const result = await withRetry(
      () => client.messages.countTokens(
        { model: call.model, system: call.system, messages: call.messages },
        policy.signal ? { signal: policy.signal } : void 0
      ),
      { ...policy.retry, isRetryable, retryAfterMs, signal: policy.signal }
    );
    return result.input_tokens;
  } catch (error) {
    throw toEngineError(error, call.model);
  }
}
function parseJsonObject(text2) {
  const start = text2.indexOf("{");
  const end = text2.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text2.slice(start, end + 1));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// src/core/check.ts
var URL = /(?:https?:\/\/|www\.)[^\s<>"'“”‘’]+/gi;
var EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
var PLACEHOLDER = /\{\{\s*[^{}]+?\s*\}\}|\{[A-Za-z_][\w.]*\}|%\d+\$[sd]|%[sd](?![A-Za-z])|\[\[[^[\]]+\]\]/g;
var NMLS = /NMLS(?:\s*(?:ID|No\.?|Number|N[úu]m\.?|N[úu]mero|n\.\s?º|#))?\s*[:#]?\s*#?\s*(\d(?:[\d-]*\d)?)/gi;
var PHONE = /(?<![\d.,])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d])/g;
var NUMBER_BODY = String.raw`\d(?:[\d.,]*\d)?`;
var CURRENCY = new RegExp(
  String.raw`(?:US\s?)?\$\s?${NUMBER_BODY}|${NUMBER_BODY}\s?(?:USD\b|US\$(?!\s?\d)|\$(?!\s?\d)|dollars?\b|d[óo]lares?\b)`,
  "gi"
);
var PERCENT = new RegExp(String.raw`${NUMBER_BODY}\s?(?:%|percent\b|por\s+ciento\b|pct\b)`, "gi");
var NUMBER = new RegExp(NUMBER_BODY, "g");
var NUMBER_IN = new RegExp(NUMBER_BODY);
var US_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
var EU_NUMBER = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
function canonical(plain) {
  let [whole, fraction = ""] = plain.split(".");
  whole = whole.replace(/^0+(?=\d)/, "");
  fraction = fraction.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
function readNumber(raw) {
  const us = US_NUMBER.test(raw) ? canonical(raw.replace(/,/g, "")) : null;
  const eu = EU_NUMBER.test(raw) ? canonical(raw.replace(/\./g, "").replace(",", ".")) : null;
  return { us, eu };
}
function numericToken(category, raw, index) {
  const body = NUMBER_IN.exec(raw)?.[0] ?? raw;
  const { us, eu } = readNumber(body);
  const token = { category, raw: raw.trim(), value: us ?? eu ?? body, index };
  if (eu !== null && eu !== token.value) token.alt = eu;
  return token;
}
function extractTokens(text2) {
  const tokens = [];
  let working = text2;
  const take = (pattern, make) => {
    pattern.lastIndex = 0;
    let match;
    const found = [];
    while ((match = pattern.exec(working)) !== null) {
      if (match[0] === "") {
        pattern.lastIndex++;
        continue;
      }
      const token = make(match);
      if (token) {
        tokens.push(token);
        found.push({ start: match.index, length: token.raw.length });
        pattern.lastIndex = match.index + Math.max(token.raw.length, 1);
      }
    }
    for (const { start, length } of found) {
      working = working.slice(0, start) + " ".repeat(length) + working.slice(start + length);
    }
  };
  take(URL, (m) => {
    const raw = m[0].replace(/[.,;:!?)\]}»]+$/, "");
    return { category: "url", raw, value: raw, index: m.index };
  });
  take(EMAIL, (m) => ({ category: "email", raw: m[0], value: m[0].toLowerCase(), index: m.index }));
  take(PLACEHOLDER, (m) => ({ category: "placeholder", raw: m[0], value: m[0].replace(/\s+/g, ""), index: m.index }));
  take(NMLS, (m) => ({ category: "nmls", raw: m[0], value: m[1].replace(/\D/g, ""), index: m.index }));
  take(PHONE, (m) => {
    const digits = m[0].replace(/\D/g, "");
    return { category: "phone", raw: m[0], value: digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits, index: m.index };
  });
  take(CURRENCY, (m) => numericToken("currency", m[0], m.index));
  take(PERCENT, (m) => numericToken("percentage", m[0], m.index));
  take(NUMBER, (m) => numericToken("number", m[0], m.index));
  return tokens.sort((a, b) => a.index - b.index);
}
function numericBody(raw) {
  return NUMBER_IN.exec(raw)?.[0] ?? raw;
}
var LABEL = {
  number: "number",
  percentage: "percentage",
  currency: "dollar amount",
  nmls: "NMLS number",
  phone: "phone number",
  email: "email address",
  url: "URL",
  href: "link target",
  pipe: "pipe character",
  placeholder: "placeholder",
  linebreak: "line break",
  order: "order of values"
};
function count(text2, needle) {
  return text2.split(needle).length - 1;
}
function comparePair(pair) {
  const failures = [];
  const warnings = [];
  const finding = (category, source, translated, note) => ({
    path: pair.path,
    category,
    source,
    translated,
    note
  });
  const sourceTokens = extractTokens(pair.source);
  const targetTokens = extractTokens(pair.translated);
  const open = sourceTokens.map((token) => ({ token, used: false }));
  const leftover = [];
  const matchedOrder = [];
  targetTokens.forEach((target, targetIndex) => {
    const findSource = (value) => value === void 0 ? -1 : open.findIndex((s) => !s.used && s.token.category === target.category && s.token.value === value);
    let at = findSource(target.value);
    let reformatted = false;
    if (at === -1 && target.alt !== void 0) {
      at = findSource(target.alt);
      reformatted = at !== -1;
    }
    if (at === -1) {
      leftover.push(target);
      return;
    }
    const source = open[at].token;
    open[at].used = true;
    matchedOrder.push({ source: at, target: targetIndex });
    const numeric = target.category === "number" || target.category === "percentage" || target.category === "currency";
    if (numeric && (reformatted || numericBody(source.raw) !== numericBody(target.raw))) {
      warnings.push(
        finding(target.category, source.raw, target.raw, `Same ${LABEL[target.category]}, written in a different format. The site keeps the US format.`)
      );
    } else if (target.category === "phone" && source.raw.replace(/\s+/g, "") !== target.raw.replace(/\s+/g, "")) {
      warnings.push(finding("phone", source.raw, target.raw, "Same phone number, written with different punctuation."));
    } else if ((target.category === "url" || target.category === "email" || target.category === "placeholder") && source.raw !== target.raw) {
      warnings.push(finding(target.category, source.raw, target.raw, `Same ${LABEL[target.category]}, written with different capitals or spacing.`));
    }
  });
  for (const s of open) {
    if (s.used || s.token.category !== "nmls") continue;
    const at = leftover.findIndex((t) => t.category === "number" && t.raw.replace(/\D/g, "") === s.token.value);
    if (at !== -1) {
      s.used = true;
      warnings.push(finding("nmls", s.token.raw, leftover[at].raw, "Same NMLS number, with the label written differently."));
      leftover.splice(at, 1);
    }
  }
  const missing = open.filter((s) => !s.used).map((s) => s.token);
  for (const source of missing) {
    const at = leftover.findIndex((t) => t.category === source.category);
    if (at !== -1) {
      const target = leftover.splice(at, 1)[0];
      failures.push(finding(source.category, source.raw, target.raw, `The ${LABEL[source.category]} changed.`));
    } else {
      failures.push(finding(source.category, source.raw, "", `The ${LABEL[source.category]} is missing from the translation.`));
    }
  }
  for (const target of leftover) {
    failures.push(finding(target.category, "", target.raw, `The translation has a ${LABEL[target.category]} that is not in the English.`));
  }
  if (failures.length === 0) {
    const bySource = [...matchedOrder].sort((a, b) => a.target - b.target).map((m) => m.source);
    if (bySource.some((value, i) => i > 0 && value < bySource[i - 1])) {
      warnings.push(finding("order", "", "", "The values are all there but appear in a different order."));
    }
  }
  const sourcePipes = count(pair.source, "|");
  const targetPipes = count(pair.translated, "|");
  if (sourcePipes !== targetPipes) {
    failures.push(finding("pipe", String(sourcePipes), String(targetPipes), "The number of pipe characters changed."));
  }
  const sourceBreaks = count(pair.source, "\n");
  const targetBreaks = count(pair.translated, "\n");
  if (sourceBreaks !== targetBreaks) {
    warnings.push(finding("linebreak", String(sourceBreaks), String(targetBreaks), "The number of line breaks changed."));
  }
  if (pair.sourceHrefs || pair.translatedHrefs) {
    const a = pair.sourceHrefs ?? [];
    const b = pair.translatedHrefs ?? [];
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] !== b[i]) failures.push(finding("href", a[i] ?? "", b[i] ?? "", "A link target changed."));
    }
  }
  return { failures, warnings };
}
function checkExactMatch(pairs) {
  const failures = [];
  const warnings = [];
  for (const pair of pairs) {
    const result = comparePair(pair);
    failures.push(...result.failures);
    warnings.push(...result.warnings);
  }
  return { passed: failures.length === 0, checked: pairs.length, failures, warnings };
}

// src/engine/prompts.ts
function registerLine(styleGuide, targetId) {
  if (!targetId.startsWith("es")) return "";
  return styleGuide.register === "tu" ? "- Register: address the reader as t\xFA, consistently, in every string. Never switch to usted." : "- Register: address the reader as usted, consistently, in every string. Never switch to t\xFA.";
}
function styleSection(ctx) {
  const lines = [`- Market: ${ctx.styleGuide.market}. Use the vocabulary, spelling and conventions readers in that market expect.`];
  const register = registerLine(ctx.styleGuide, ctx.targetLanguage.id);
  if (register) lines.push(register);
  if (ctx.styleGuide.audience) lines.push(`- Audience: ${ctx.styleGuide.audience}`);
  if (ctx.styleGuide.notes) lines.push(`- Notes from the site: ${ctx.styleGuide.notes}`);
  return lines.join("\n");
}
function glossarySection(glossary) {
  const parts = [];
  if (glossary.doNotTranslate.length > 0) {
    parts.push(
      "Never translate these. Keep each one exactly as written, capitals included:\n" + glossary.doNotTranslate.map((term) => `- ${term}`).join("\n")
    );
  }
  if (glossary.terms.length > 0) {
    parts.push(
      "Fixed terms. Whenever the term on the left appears, use the term on the right, changing only what grammar requires (number, gender, capital at the start of a sentence):\n" + glossary.terms.map((t) => `- ${t.source} => ${t.target}${t.note ? ` (${t.note})` : ""}`).join("\n")
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : "The site has not set a glossary.";
}
function translatorSystemPrompt(ctx) {
  const target = ctx.targetLanguage.title;
  const source = ctx.sourceLanguage.title;
  return `You are a professional translator of consumer mortgage and home lending content. You translate a US lender's website from ${source} into ${target}. The people who read your work are deciding on the largest loan of their lives, and the lender is answerable to regulators for every sentence, so accuracy comes before elegance and nothing may be invented.

# How to translate

- Read the whole document first. Headings, body copy, buttons, image descriptions and search-engine fields belong to one page and must agree with each other in terminology and tone. Translate the document as a whole, never one string at a time.
- Write what a careful native copywriter in the target market would write: natural, plain and clear. Translate the meaning, not the words. Avoid literal renderings of English idioms and avoid false friends.
- Use the mortgage terms borrowers in the target market actually hear from a loan officer. Where the site's glossary fixes a term, the glossary wins.
- Short strings are usually interface text: buttons, links, menu items, labels. Keep them short and translate them by what they do on the page.
- For search-engine fields (meta titles and descriptions) keep a similar length and keep the main keyword natural.
- Image descriptions (alt text) describe the picture for someone who cannot see it. Translate them as descriptions.

# Style guide

${styleSection(ctx)}

# Glossary

${glossarySection(ctx.glossary)}

# Rules that are never broken

1. Keep every number, rate, percentage, dollar amount, term length, date figure, NMLS number, phone number, email address and URL exactly as it is in the source: the same digits, the same separators, the same symbols, in US format (1,234.50 and 6.5%). Do not convert, round, reformat or spell out a number, and do not turn a written number into digits.
2. Keep every placeholder token exactly, such as {{name}}, {name} or %s. Keep every pipe character (|) and every line break where it is.
3. Do not add a sentence, a claim, a condition or a disclaimer, and do not drop one. Every string stays one string that says what the source says.
4. Translate legal, regulatory and disclosure text faithfully. Do not soften it, strengthen it, summarise it or explain it. Where an official or established ${target} form of a regulatory phrase exists, use it.
5. Do not translate brand names, product or program names, or anything on the do-not-translate list.
6. If something in the source is unclear, translate it as literally as the target language allows rather than guessing at an intent.

# What you receive and what you return

You receive one JSON object. Its "translate" member holds the text to translate, laid out in the document's own structure. Return one JSON object with a "translated" member that has exactly the same structure.

- The same keys, the same lists with the same number of items in the same order, and the same "_key" and "_type" values. Change only the text.
- A Portable Text block is an object with "_type": "block". Translate the "text" of each child. Keep the same number of children in the same order, each with its "_key", "_type" and "marks" unchanged, and keep "markDefs", "style", "listItem" and "level" unchanged. When ${target} word order differs, move the words between the children so the bold, italic or linked words are the ones that correspond to the source. Keep a space at the edge of a child where the source has one, so words do not run together.
- "context", when present, is there to help you understand and must not be returned. "outline" lists the parts of the document. "before" and "after" are the text next to the part you are translating. "source" is the whole source document. "existingTranslation" is the current translation of the parts that are not changing: match its terminology and tone so the page reads as one piece.
- "slug", when present, is the page's address. Return a "slug" member with a ${target} version: lower case words joined by hyphens, no accents, short, using the words a person would search for.

Answer with the JSON object only: no code fence, no commentary before or after.`;
}
function reviewerSystemPrompt(ctx) {
  const target = ctx.targetLanguage.title;
  const source = ctx.sourceLanguage.title;
  return `You are a senior bilingual reviewer of consumer mortgage and home lending content. A US lender's website has been translated from ${source} into ${target}, and you are the second pair of eyes before a person decides whether it can be published. You did not write the translation. Compare each source string with its translation and report real problems only.

# What to look for

- meaning: the translation says something different from the source, including a condition, a limit or an obligation that came out weaker, stronger or reversed.
- omission: something in the source is missing from the translation.
- addition: the translation says something the source does not.
- tone: the register or voice does not follow the style guide, or switches part way.
- terminology: a glossary term was not used, something on the do-not-translate list was translated, or a mortgage term is wrong or misleading for the market.
- legal: legal, regulatory or disclosure wording was softened, strengthened, summarised or otherwise changed in substance.

# How serious

- high: a borrower would be told something different about rates, costs, eligibility, obligations or rights; legal or disclosure wording changed in substance; a claim was added or left out.
- medium: a clear error or an awkward, confusing sentence that does not mislead.
- low: a small improvement in wording.

Natural rephrasing, a different word order and a different sentence length are not problems. Do not report a string that is fine, and do not report the same problem twice.

# Style guide

${styleSection(ctx)}

# Glossary

${glossarySection(ctx.glossary)}

# What you receive and what you return

You receive one JSON object with "items": a list of { "path", "source", "translation" }. "legalPaths" lists the paths that are legal text; hold those to the strictest standard.

Return one JSON object: { "issues": [ { "path", "severity", "category", "note" } ] }.

- "path" is copied exactly from the item the issue is in.
- "severity" is high, medium or low. "category" is meaning, omission, addition, tone, terminology or legal.
- "note" is one or two sentences in English for a person who may not read ${target}: quote the words in question and say what is wrong.
- When there is nothing to report, return { "issues": [] }.

Answer with the JSON object only.`;
}
var REVIEW_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          category: { type: "string", enum: ["meaning", "omission", "addition", "tone", "terminology", "legal"] },
          note: { type: "string" }
        },
        required: ["path", "severity", "category", "note"],
        additionalProperties: false
      }
    }
  },
  required: ["issues"],
  additionalProperties: false
};

// src/engine/review.ts
var SEVERITIES = ["high", "medium", "low"];
var CATEGORIES = ["meaning", "omission", "addition", "tone", "terminology", "legal"];
var DEFAULT_REVIEW_CHARS_PER_REQUEST = 4e4;
function parseReviewerResponse(text2, knownPaths) {
  const parsed = parseJsonObject(text2);
  if (!parsed || !Array.isArray(parsed.issues)) return { ok: false, issues: [] };
  const issues = [];
  for (const raw of parsed.issues) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw;
    const note = typeof r.note === "string" ? r.note.trim() : "";
    if (note === "") continue;
    const path = typeof r.path === "string" ? r.path.trim() : "";
    const severityRaw = typeof r.severity === "string" ? r.severity.toLowerCase().trim() : "";
    const categoryRaw = typeof r.category === "string" ? r.category.toLowerCase().trim() : "";
    const severity = SEVERITIES.includes(severityRaw) ? severityRaw : "medium";
    const category = CATEGORIES.includes(categoryRaw) ? categoryRaw : "meaning";
    issues.push({
      // An issue about a path that was not in the request is kept, marked, so a person still sees it.
      path: knownPaths && path !== "" && !knownPaths.has(path) ? `${path} (path not recognised)` : path,
      severity,
      category,
      note: note.slice(0, 1e3)
    });
  }
  return { ok: true, issues };
}
function reviewerRequest(prompt, pairs, legalPaths) {
  const paths = new Set(pairs.map((p) => p.path));
  return JSON.stringify({
    task: "review",
    sourceLanguage: prompt.sourceLanguage.id,
    targetLanguage: prompt.targetLanguage.id,
    legalPaths: legalPaths.filter((p) => paths.has(p) || [...paths].some((known) => known.startsWith(p))),
    items: pairs.map((p) => ({ path: p.path, source: p.source, translation: p.translated }))
  });
}
async function reviewTranslation(input) {
  const usage = { model: input.model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  if (input.pairs.length === 0) return { passed: true, issues: [], usage, servedBy: [], readable: true };
  const max = input.maxCharsPerRequest ?? DEFAULT_REVIEW_CHARS_PER_REQUEST;
  const chunks = [];
  let current = [];
  let size = 0;
  for (const pair of input.pairs) {
    const length = pair.source.length + pair.translated.length;
    if (current.length > 0 && size + length > max) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(pair);
    size += length;
  }
  if (current.length > 0) chunks.push(current);
  const system = reviewerSystemPrompt(input.prompt);
  const issues = [];
  const servedBy = /* @__PURE__ */ new Set();
  let readable = true;
  const limit = createLimiter(input.concurrency ?? 2);
  await Promise.all(
    chunks.map(
      (chunk) => limit(async () => {
        const answer = await callModel(
          input.client,
          {
            model: input.model,
            system,
            messages: [{ role: "user", content: reviewerRequest(input.prompt, chunk, input.legalPaths) }],
            effort: input.effort,
            jsonSchema: REVIEW_SCHEMA
          },
          input.policy
        );
        usage.requests++;
        usage.inputTokens += answer.usage.inputTokens;
        usage.outputTokens += answer.usage.outputTokens;
        usage.cacheReadTokens += answer.usage.cacheReadTokens;
        usage.cacheWriteTokens += answer.usage.cacheWriteTokens;
        servedBy.add(answer.servedBy);
        const result = parseReviewerResponse(answer.text, new Set(chunk.map((p) => p.path)));
        if (!result.ok) readable = false;
        issues.push(...result.issues);
      })
    )
  );
  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { passed: readable && !issues.some((i) => i.severity === "high"), issues, usage, servedBy: [...servedBy], readable };
}

// src/engine/translate.ts
var DEFAULT_MAX_CHARS_PER_REQUEST = 24e3;
var HARD_MAX_CHARS_PER_REQUEST = 16e4;
var NEIGHBOUR_CHARS = 600;
function unitText2(unit) {
  if (unit.kind === "text") return unit.value;
  if (unit.kind === "list") return unit.value.join(" / ");
  return blockText(unit.value);
}
function chunkUnits(document2, units, maxChars) {
  const pieces = [];
  for (const unit of units) {
    const last = pieces[pieces.length - 1];
    if (last && last[0].piece === unit.piece) last.push(unit);
    else pieces.push([unit]);
  }
  const chunks = [];
  let current = [];
  let currentSize = 0;
  for (const piece of pieces) {
    const size = JSON.stringify(buildPayload(document2, piece)).length;
    if (size > HARD_MAX_CHARS_PER_REQUEST) throw new EngineError("document_too_large", { details: [piece[0].piece] });
    if (current.length > 0 && currentSize + size > maxChars) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(...piece);
    currentSize += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
function outline(document2, units) {
  const lines = [];
  const seen = /* @__PURE__ */ new Set();
  for (const unit of units) {
    if (seen.has(unit.piece)) continue;
    seen.add(unit.piece);
    const first = unitText2(unit).replace(/\s+/g, " ").trim().slice(0, 80);
    lines.push(`${unit.piece}: ${first}`);
  }
  return lines;
}
function withValues(units, values) {
  return units.filter((u) => values.has(u.path)).map((u) => ({ ...u, value: values.get(u.path) }));
}
async function translateUnits(input) {
  const usage = { model: input.model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const values = /* @__PURE__ */ new Map();
  const servedBy = /* @__PURE__ */ new Set();
  let structureRetries = 0;
  let slug = null;
  if (input.units.length === 0) return { values, slug, usage, servedBy: [], structureRetries, requests: 0 };
  const chunks = chunkUnits(input.document, input.units, input.maxCharsPerRequest ?? DEFAULT_MAX_CHARS_PER_REQUEST);
  const system = translatorSystemPrompt(input.prompt);
  const partial = input.units.length < input.allUnits.length;
  const typeName = typeof input.document._type === "string" ? input.document._type : "";
  const sharedContext = {};
  if (chunks.length > 1) sharedContext.outline = outline(input.document, input.allUnits);
  if (partial) {
    sharedContext.source = buildPayload(input.document, input.allUnits);
    if (input.existing && input.existing.size > 0) {
      sharedContext.existingTranslation = buildPayload(input.document, withValues(input.allUnits, input.existing));
    }
  }
  const runChunk = async (chunk, index) => {
    const payload = buildPayload(input.document, chunk);
    const context = { ...sharedContext };
    if (chunks.length > 1) {
      const before = chunks[index - 1]?.map(unitText2).join("\n").slice(-NEIGHBOUR_CHARS);
      const after = chunks[index + 1]?.map(unitText2).join("\n").slice(0, NEIGHBOUR_CHARS);
      if (before) context.before = before;
      if (after) context.after = after;
    }
    const request = {
      task: "translate",
      sourceLanguage: input.prompt.sourceLanguage.id,
      targetLanguage: input.prompt.targetLanguage.id,
      documentType: typeName
    };
    const wantsSlug = index === 0 && typeof input.slug === "string" && input.slug !== "";
    if (wantsSlug) request.slug = input.slug;
    if (Object.keys(context).length > 0) request.context = context;
    request.translate = payload;
    const messages = [{ role: "user", content: JSON.stringify(request) }];
    let translated;
    let errors = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await callModel(input.client, { model: input.model, system, messages, effort: input.effort }, input.policy);
      usage.requests++;
      usage.inputTokens += answer.usage.inputTokens;
      usage.outputTokens += answer.usage.outputTokens;
      usage.cacheReadTokens += answer.usage.cacheReadTokens;
      usage.cacheWriteTokens += answer.usage.cacheWriteTokens;
      servedBy.add(answer.servedBy);
      const parsed = parseJsonObject(answer.text);
      translated = parsed?.translated;
      errors = parsed ? validateStructure(payload, translated) : ["The answer was not a JSON object."];
      if (errors.length === 0) {
        if (wantsSlug && typeof parsed?.slug === "string") slug = toSlug(parsed.slug) || null;
        break;
      }
      if (attempt === 0) {
        structureRetries++;
        messages.push({ role: "assistant", content: answer.content });
        messages.push({
          role: "user",
          content: 'Your answer does not have the same structure as "translate". Return the complete JSON object again with these corrected, and nothing else changed in structure:\n' + errors.map((e) => `- ${e}`).join("\n")
        });
      }
    }
    if (errors.length > 0) throw new EngineError("structure_mismatch", { details: errors });
    for (const unit of chunk) {
      const value = readUnit(translated, unit);
      if (value === void 0) throw new EngineError("structure_mismatch", { details: [`${unit.path}: missing from the answer`] });
      values.set(unit.path, value);
    }
  };
  const limit = createLimiter(input.concurrency ?? 2);
  await Promise.all(chunks.map((chunk, index) => limit(() => runChunk(chunk, index))));
  return { values, slug, usage, servedBy: [...servedBy], structureRetries, requests: usage.requests };
}
function translatorRequestPreview(prompt, document2, units, slug) {
  const request = {
    task: "translate",
    sourceLanguage: prompt.sourceLanguage.id,
    targetLanguage: prompt.targetLanguage.id,
    documentType: typeof document2._type === "string" ? document2._type : ""
  };
  if (slug) request.slug = slug;
  request.translate = buildPayload(document2, units);
  return { system: translatorSystemPrompt(prompt), user: JSON.stringify(request) };
}

// src/engine/document.ts
var SYSTEM_FIELDS2 = ["_id", "_rev", "_createdAt", "_updatedAt", "_system", "_originalId"];
function emptyUsage(model) {
  return { model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
function slugOf(doc, field) {
  if (!doc || !field) return null;
  const current = doc[field]?.current;
  return typeof current === "string" && current !== "" ? current : null;
}
async function translateDocument(input) {
  const now = input.now ?? (() => /* @__PURE__ */ new Date());
  const startedAt = now().toISOString();
  const source = input.document;
  const typeName = typeof source._type === "string" ? source._type : "";
  const documentType = input.manifest.documents[typeName];
  if (!documentType) throw new EngineError("type_not_translatable", { details: [typeName] });
  const sourceId = String(source._id ?? "").replace(/^drafts\./, "");
  const targetId = translationId(sourceId, input.language.id);
  const existing = input.existingTranslation ?? null;
  const allUnits = extractUnits(source, input.manifest, typeName);
  const hashes = sourceHashes(source, input.manifest, allUnits);
  const hasStoredHashes = Array.isArray(existing?.[I18N_FIELD]?.sourceHashes);
  const mode = input.mode === "changes" && existing && hasStoredHashes ? "changes" : "full";
  const diff = mode === "changes" ? diffSource(source, existing, input.manifest) : null;
  const reused = /* @__PURE__ */ new Map();
  let toTranslate = [...allUnits];
  if (diff && existing) {
    const stale = /* @__PURE__ */ new Set([...diff.changed, ...diff.added]);
    toTranslate = [];
    for (const unit of allUnits) {
      const current = stale.has(unit.path) ? void 0 : readUnit(existing, unit);
      if (current === void 0) toTranslate.push(unit);
      else reused.set(unit.path, current);
    }
  }
  const prompt = { sourceLanguage: input.sourceLanguage, targetLanguage: input.language, glossary: input.glossary, styleGuide: input.styleGuide };
  const sourceSlug = slugOf(source, documentType.slugField);
  const existingSlug = slugOf(existing, documentType.slugField);
  const legalPaths = allUnits.filter((u) => u.legal).map((u) => u.path);
  const report = {
    mode,
    language: input.language.id,
    sourceId,
    translationId: targetId,
    startedAt,
    finishedAt: startedAt,
    translatorModel: input.models.translatorModel,
    reviewerModel: input.models.reviewerModel,
    servedBy: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ratesAsOf: RATES_AS_OF,
    usage: [],
    unitsTotal: allUnits.length,
    unitsTranslated: toTranslate.length,
    unitsReused: reused.size,
    translatedPaths: toTranslate.map((u) => u.path),
    structureRetries: 0,
    check1Passed: true,
    check1Checked: 0,
    check1Failures: [],
    check1Warnings: [],
    reviewPassed: true,
    reviewIssues: [],
    legalPaths,
    sourceSlug,
    proposedSlug: existingSlug,
    held: false,
    holdReasons: [],
    saved: false
  };
  if (diff?.upToDate && toTranslate.length === 0) {
    report.finishedAt = now().toISOString();
    return { translation: null, report, diff, upToDate: true };
  }
  let translatorUsage = emptyUsage(input.models.translatorModel);
  let reviewerUsage = emptyUsage(input.models.reviewerModel);
  const translated = /* @__PURE__ */ new Map();
  let check = { passed: true, checked: 0, failures: [], warnings: [] };
  let issues = [];
  let reviewPassed = true;
  let reviewReadable = true;
  let proposedSlug = existingSlug;
  if (toTranslate.length > 0) {
    const client = await input.client();
    await input.onProgress?.("Translating");
    const result = await translateUnits({
      client,
      model: input.models.translatorModel,
      effort: input.effort?.translator ?? "medium",
      prompt,
      document: source,
      units: toTranslate,
      allUnits,
      existing: reused,
      // A translation that already has an address keeps it, so a live URL never moves.
      slug: existingSlug ? null : sourceSlug,
      maxCharsPerRequest: input.maxCharsPerRequest,
      concurrency: input.concurrency,
      policy: input.policy
    });
    translatorUsage = result.usage;
    report.structureRetries = result.structureRetries;
    for (const [path, value] of result.values) translated.set(path, value);
    if (!existingSlug) proposedSlug = result.slug;
    await input.onProgress?.("Checking numbers, links and other exact values");
    const pairs = toTranslate.flatMap((unit) => unitPairs(unit, translated.get(unit.path)));
    check = checkExactMatch(pairs);
    if (check.passed) {
      await input.onProgress?.("Reviewing the translation");
      const review = await reviewTranslation({
        client,
        model: input.models.reviewerModel,
        effort: input.effort?.reviewer ?? "high",
        prompt,
        pairs,
        legalPaths,
        concurrency: input.concurrency,
        policy: input.policy
      });
      reviewerUsage = review.usage;
      issues = review.issues;
      reviewPassed = review.passed;
      reviewReadable = review.readable;
      report.servedBy = [.../* @__PURE__ */ new Set([...result.servedBy, ...review.servedBy])];
    } else {
      report.servedBy = result.servedBy;
    }
  }
  report.usage = [translatorUsage, reviewerUsage].filter((u) => u.requests > 0);
  report.inputTokens = report.usage.reduce((n, u) => n + u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens, 0);
  report.outputTokens = report.usage.reduce((n, u) => n + u.outputTokens, 0);
  report.costUsd = Math.round(report.usage.reduce((n, u) => n + costOf(u, u.model), 0) * 1e6) / 1e6;
  report.check1Passed = check.passed;
  report.check1Checked = check.checked;
  report.check1Failures = check.failures;
  report.check1Warnings = check.warnings;
  report.reviewPassed = check.passed ? reviewPassed : false;
  report.reviewIssues = issues;
  report.proposedSlug = proposedSlug;
  if (!check.passed) {
    report.held = true;
    report.holdReasons.push(
      `${check.failures.length} exact value(s) in the translation do not match the English. Nothing was saved, and the reviewer was not run.`
    );
    report.finishedAt = now().toISOString();
    return { translation: null, report, diff, upToDate: false };
  }
  if (!reviewReadable) {
    report.held = true;
    report.holdReasons.push("The reviewer's answer could not be read, so the translation has not been reviewed.");
  }
  const high = issues.filter((i) => i.severity === "high").length;
  if (high > 0) {
    report.held = true;
    report.holdReasons.push(`The reviewer raised ${high} high severity issue(s) that a person needs to look at.`);
  }
  const translation = JSON.parse(JSON.stringify(source));
  for (const field of SYSTEM_FIELDS2) delete translation[field];
  for (const field of documentType.sharedFields) delete translation[field];
  const entries = allUnits.map((unit) => ({ unit, value: translated.get(unit.path) ?? reused.get(unit.path) })).filter((entry) => entry.value !== void 0);
  const missing = applyUnits(translation, entries);
  if (missing.length > 0) throw new EngineError("structure_mismatch", { details: missing.map((p) => `${p}: could not be written`) });
  if (documentType.slugField) {
    if (proposedSlug) translation[documentType.slugField] = { _type: "slug", current: proposedSlug };
    else delete translation[documentType.slugField];
  }
  report.finishedAt = now().toISOString();
  translation[LANGUAGE_FIELD] = input.language.id;
  translation[I18N_FIELD] = {
    source: { _type: "reference", _ref: sourceId, _weak: true },
    status: "draft",
    sourceHash: sourceFingerprint(hashes),
    sourceHashes: hashes,
    translatedAt: report.finishedAt,
    report: reportForStorage(report)
  };
  return { translation, report, diff, upToDate: false };
}
function keyed(items) {
  return items.map((item, i) => ({ _key: `k${i}`, ...item }));
}
function reportForStorage(report) {
  return {
    ...report,
    usage: keyed(report.usage),
    check1Failures: keyed(report.check1Failures),
    check1Warnings: keyed(report.check1Warnings),
    reviewIssues: keyed(report.reviewIssues)
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
  const language = "";
  return dependencies.filter((d) => d.blocking).map(
    (d) => d.status === "missing" ? `It embeds the ${d.type} ${d.id}, which has no ${language}translation yet. Translate and approve that ${d.type} first.` : d.status === "unpublished" ? `It embeds the ${d.type} ${d.id}, whose ${language}translation is still a draft. Approve and publish that ${d.type} first.` : `It embeds the ${d.type} ${d.id}, whose ${language}translation is not approved and live yet (${d.status.replace(/_/g, " ")}). Approve and publish that ${d.type} first.`
  );
}

// src/engine/dependencies.ts
async function loadDependencies(sanity, document2, language, manifest, requiredTypes) {
  const ids = collectReferences(document2);
  if (ids.length === 0) return [];
  const referencedDocs = await sanity.getDocuments(ids);
  const referenced = new Map(referencedDocs.map((d) => [String(d._id), d]));
  const translatable = referencedDocs.filter((d) => manifest.documents[String(d._type ?? "")]);
  const translationIds = translatable.map((d) => translationId(String(d._id), language));
  const found = translationIds.length > 0 ? await sanity.getDocuments([...translationIds, ...translationIds.map((id) => `drafts.${id}`)]) : [];
  const translations = new Map(found.filter((d) => !String(d._id).startsWith("drafts.")).map((d) => [String(d._id), d]));
  const drafts = new Set(found.filter((d) => String(d._id).startsWith("drafts.")).map((d) => String(d._id).slice("drafts.".length)));
  return planDependencies({ document: document2, language, manifest, referenced, translations, drafts, requiredTypes });
}

// src/engine/estimate.ts
function tokensFromCharacters(characters) {
  return Math.ceil(characters / CHARS_PER_TOKEN);
}
async function estimateCost(input) {
  const translatorModel = input.models?.translatorModel || DEFAULT_TRANSLATOR_MODEL;
  const reviewerModel = input.models?.reviewerModel || DEFAULT_REVIEWER_MODEL;
  const prompt = {
    sourceLanguage: input.sourceLanguage ?? { id: input.manifest.defaultLanguage, title: "English" },
    targetLanguage: input.language,
    glossary: input.glossary ?? { doNotTranslate: [], terms: [] },
    styleGuide: input.styleGuide ?? DEFAULT_STYLE_GUIDE
  };
  const translatorSystem = translatorSystemPrompt(prompt);
  const reviewerSystem = reviewerSystemPrompt(prompt);
  const figures = [];
  for (const document2 of input.documents) {
    const units = extractUnits(document2, input.manifest);
    if (units.length === 0) continue;
    const slugField = input.manifest.documents[String(document2._type)]?.slugField;
    const slug = slugField ? document2[slugField]?.current : void 0;
    const preview = translatorRequestPreview(prompt, document2, units, slug);
    const pairs = units.flatMap((unit) => unitPairs(unit, unit.value));
    figures.push({
      strings: unitStrings(units),
      characters: unitCharacters(units),
      translatorUser: preview.user,
      reviewerUser: reviewerRequest(prompt, pairs.map((p) => ({ ...p, translated: "" })), [])
    });
  }
  const documents = figures.length;
  const strings = figures.reduce((n, f) => n + f.strings, 0);
  const characters = figures.reduce((n, f) => n + f.characters, 0);
  const translatorUserTokens = figures.map((f) => tokensFromCharacters(f.translatorUser.length));
  const reviewerUserTokens = figures.map((f) => tokensFromCharacters(f.reviewerUser.length));
  let translatorSystemTokens = tokensFromCharacters(translatorSystem.length);
  let reviewerSystemTokens = tokensFromCharacters(reviewerSystem.length);
  let method = "characters";
  let counted = 0;
  if (input.countTokens && documents > 0) {
    const count2 = input.countTokens;
    const sampleSize = Math.max(1, input.sampleSize ?? 20);
    const sample = documents <= sampleSize ? figures.map((_, i) => i) : Array.from({ length: sampleSize }, (_, i) => Math.floor(i * documents / sampleSize));
    const limit = createLimiter(input.concurrency ?? 4);
    const [tSystem, rSystem] = await Promise.all([
      limit(() => count2({ model: translatorModel, system: translatorSystem, user: "." })),
      limit(() => count2({ model: reviewerModel, system: reviewerSystem, user: "." }))
    ]);
    translatorSystemTokens = tSystem;
    reviewerSystemTokens = rSystem;
    let sampledCharsT = 0;
    let sampledTokensT = 0;
    let sampledCharsR = 0;
    let sampledTokensR = 0;
    await Promise.all(
      sample.map(
        (index) => limit(async () => {
          const f = figures[index];
          const [t, r] = await Promise.all([
            count2({ model: translatorModel, system: translatorSystem, user: f.translatorUser }),
            count2({ model: reviewerModel, system: reviewerSystem, user: f.reviewerUser })
          ]);
          translatorUserTokens[index] = Math.max(0, t - tSystem);
          reviewerUserTokens[index] = Math.max(0, r - rSystem);
          sampledCharsT += f.translatorUser.length;
          sampledTokensT += translatorUserTokens[index];
          sampledCharsR += f.reviewerUser.length;
          sampledTokensR += reviewerUserTokens[index];
        })
      )
    );
    counted = sample.length;
    method = counted === documents ? "counted" : "sampled";
    if (method === "sampled") {
      const inSample = new Set(sample);
      const ratioT = sampledCharsT > 0 ? sampledTokensT / sampledCharsT : 1 / CHARS_PER_TOKEN;
      const ratioR = sampledCharsR > 0 ? sampledTokensR / sampledCharsR : 1 / CHARS_PER_TOKEN;
      figures.forEach((f, i) => {
        if (inSample.has(i)) return;
        translatorUserTokens[i] = Math.ceil(f.translatorUser.length * ratioT);
        reviewerUserTokens[i] = Math.ceil(f.reviewerUser.length * ratioR);
      });
    }
  }
  let translatorInput = 0;
  let translatorOutput = 0;
  let reviewerInput = 0;
  let reviewerOutput = 0;
  for (let i = 0; i < documents; i++) {
    translatorInput += translatorSystemTokens + translatorUserTokens[i];
    translatorOutput += Math.ceil(translatorUserTokens[i] * TRANSLATION_OUTPUT_FACTOR);
    reviewerInput += reviewerSystemTokens + Math.ceil(reviewerUserTokens[i] * REVIEW_INPUT_FACTOR);
    reviewerOutput += REVIEW_OUTPUT_TOKENS;
  }
  const costUsd = costOf({ inputTokens: translatorInput, outputTokens: translatorOutput }, translatorModel) + costOf({ inputTokens: reviewerInput, outputTokens: reviewerOutput }, reviewerModel);
  const note = method === "counted" ? "Input tokens were counted by Anthropic for every document. Output is estimated." : method === "sampled" ? `Input tokens were counted by Anthropic for a sample of ${counted} document(s) and scaled to the rest. Output is estimated.` : `No API key was available, so tokens are estimated at ${CHARS_PER_TOKEN} characters per token. Save a key for a counted figure.`;
  return {
    documents,
    strings,
    characters,
    inputTokens: translatorInput + reviewerInput,
    outputTokens: translatorOutput + reviewerOutput,
    costUsd: Math.round(costUsd * 1e4) / 1e4,
    translatorModel,
    reviewerModel,
    ratesAsOf: RATES_AS_OF,
    method,
    counted,
    note
  };
}

// src/engine/legal.ts
var SYSTEM_FIELDS3 = ["_rev", "_createdAt", "_updatedAt", "_system", "_originalId"];
function publishedId(id) {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}
async function readStoredManifest(sanity) {
  const stored = await sanity.getDocument(MANIFEST_ID);
  if (typeof stored?.manifest !== "string") return null;
  try {
    const parsed = JSON.parse(stored.manifest);
    return parsed && typeof parsed === "object" && parsed.documents ? parsed : null;
  } catch {
    return null;
  }
}
async function loadEntries(sanity, ids) {
  const unique = [...new Set(ids)];
  const docs = unique.length > 0 ? await sanity.getDocuments(unique) : [];
  return new Map(docs.filter((d) => d._type === LEGAL_APPROVAL_TYPE).map((d) => [String(d._id), d]));
}
function legalRecordOf(doc) {
  const legal = doc[I18N_FIELD]?.legal;
  if (!legal || typeof legal !== "object") return null;
  const record = legal;
  return { pending: record.pending ?? 0, approved: record.approved ?? 0, paths: Array.isArray(record.paths) ? record.paths : [] };
}
async function publishTranslation(sanity, draftId, options = {}) {
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  if (!draftId.startsWith("drafts.")) return { published: false, reason: "Only a draft can be published." };
  const draft = await sanity.getDocument(draftId);
  if (!draft) return { published: false, reason: "There is no draft to publish." };
  const manifest = options.manifest === void 0 ? await readStoredManifest(sanity) : options.manifest;
  if (!manifest) return { published: false, reason: "The server does not have the list of translatable fields yet. Open the Studio once and try again." };
  const record = legalRecordOf(draft);
  const entries = await loadEntries(sanity, (record?.paths ?? []).map((p) => p.unitId));
  const check = checkTranslationForPublish(draft, manifest, entries);
  const language = String(draft[LANGUAGE_FIELD] ?? "");
  const dependencies = language ? await loadDependencies(sanity, draft, language, manifest, options.requiredDependencyTypes) : [];
  const reasons = [...check.reasons, ...dependencyReasons(dependencies)];
  if (reasons.length > 0) return { published: false, reason: reasons.join(" "), dependencies };
  const id = publishedId(draftId);
  const published = JSON.parse(JSON.stringify(draft));
  for (const field of SYSTEM_FIELDS3) delete published[field];
  published._id = id;
  const i18n = { ...published[I18N_FIELD] ?? {} };
  delete i18n.staleSince;
  i18n.publishedAt = now().toISOString();
  published[I18N_FIELD] = i18n;
  await sanity.mutate([{ createOrReplace: published }, { delete: { id: draftId } }]);
  const dependentsPublished = [];
  if (options.publishDependents) {
    const sourceRef = draft[I18N_FIELD]?.source?._ref;
    if (sourceRef) {
      let waiting = [];
      try {
        waiting = await sanity.fetch(
          `*[_id in path("drafts.**") && ${LANGUAGE_FIELD} == $language && ${I18N_FIELD}.status == "approved" && references($source)]._id`,
          { language, source: sourceRef }
        );
      } catch {
      }
      for (const waitingId of waiting ?? []) {
        if (waitingId === draftId) continue;
        const result = await publishTranslation(sanity, waitingId, { ...options, manifest, publishDependents: false });
        if (result.published && result.id) dependentsPublished.push(result.id);
      }
    }
  }
  return { published: true, id, dependencies, dependentsPublished };
}
async function loadUnit(sanity, unitId) {
  const entry = await sanity.getDocument(unitId);
  if (!entry || entry._type !== LEGAL_APPROVAL_TYPE) throw new EngineError("unit_not_found");
  if (entry.status !== "pending" && entry.status !== "sent_back") throw new EngineError("unit_not_pending");
  return entry;
}
function decision(status, entry, by, at, comment) {
  return {
    _key: sha256Hex(`${at}
${status}
${entry._id}
${by.email ?? by.id ?? ""}`).slice(0, 12),
    status,
    decidedBy: by,
    decidedAt: at,
    sourceHash: entry.sourceHash,
    ...comment ? { comment } : {}
  };
}
function decisionPatch(entry, status, by, at, comment) {
  const set = { status, decidedBy: by, decidedAt: at, updatedAt: at };
  if (comment) set.comment = comment;
  return [
    { patch: { id: entry._id, set, unset: comment ? ["supersededBy"] : ["supersededBy", "comment"] } },
    { patch: { id: entry._id, setIfMissing: { history: [] } } },
    { patch: { id: entry._id, insert: { after: "history[-1]", items: [decision(status, entry, by, at, comment)] } } }
  ];
}
async function autoPublishSetting(input) {
  if (typeof input.autoPublish === "boolean") return input.autoPublish;
  const settings = await input.sanity.fetch(
    `*[_type == $type && (${LANGUAGE_FIELD} == $lang || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))][0]`,
    { type: input.settingsType ?? "settings", lang: "en" }
  );
  return readEngineSettings(settings, input.engineField ?? ENGINE_FIELD).autoPublishMarketing;
}
async function approveUnit(input) {
  const { sanity } = input;
  const now = (input.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  const entry = await loadUnit(sanity, input.unitId);
  const value = parseLegalValue(entry);
  const mutations = decisionPatch(entry, "approved", input.decidedBy, now, input.comment);
  const outcome = { unitId: entry._id, status: "approved", translations: [] };
  const becameApproved = [];
  const draftIds = [...new Set((entry.occurrences ?? []).map((o) => `drafts.${o.documentId}`))];
  const drafts = draftIds.length > 0 ? await sanity.getDocuments(draftIds) : [];
  for (const draft of drafts) {
    const draftId = String(draft._id);
    const record = legalRecordOf(draft);
    if (!record) continue;
    const mine = record.paths.filter((p) => p.unitId === entry._id);
    if (mine.length === 0) continue;
    const set = {};
    for (const path of mine) {
      if (value === null) continue;
      const segments = legalPathSegments(path.path);
      const copy = JSON.parse(JSON.stringify(draft));
      if (applyLegalValue(copy, segments, value)) set[path.path] = getAtPath(copy, segments);
    }
    const paths = record.paths.map((p) => p.unitId === entry._id ? { ...p, status: "approved" } : p);
    const pending = paths.filter((p) => p.status === "pending").length;
    const approved = paths.filter((p) => p.status === "approved").length;
    set[`${I18N_FIELD}.legal`] = { pending, approved, paths };
    const i18n = draft[I18N_FIELD] ?? {};
    const held = i18n.report?.held === true;
    let status = String(i18n.status ?? "draft");
    if (pending === 0 && !held && status !== "approved") {
      status = "approved";
      set[`${I18N_FIELD}.status`] = status;
      set[`${I18N_FIELD}.approvedAt`] = now;
      set[`${I18N_FIELD}.approvedBy`] = input.decidedBy.name || input.decidedBy.email || input.decidedBy.id || "Legal approver";
      becameApproved.push(draftId);
    }
    mutations.push({ patch: { id: draftId, set } });
    outcome.translations.push({ documentId: publishedId(draftId), status, published: false });
  }
  await sanity.mutate(mutations);
  if (becameApproved.length > 0 && await autoPublishSetting(input)) {
    const manifest = input.manifest === void 0 ? await readStoredManifest(sanity) : input.manifest;
    for (const draftId of becameApproved) {
      const result = await publishTranslation(sanity, draftId, { manifest, now: input.now, publishDependents: true, requiredDependencyTypes: input.requiredDependencyTypes });
      const row = outcome.translations.find((t) => t.documentId === publishedId(draftId));
      if (row) {
        row.published = result.published;
        if (result.reason) row.note = result.reason;
      }
    }
  }
  return outcome;
}
async function sendBackUnit(input) {
  const comment = (input.comment ?? "").trim();
  if (comment === "") throw new EngineError("comment_required");
  const entry = await loadUnit(input.sanity, input.unitId);
  const now = (input.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  await input.sanity.mutate(decisionPatch(entry, "sent_back", input.decidedBy, now, comment));
  return {
    unitId: entry._id,
    status: "sent_back",
    translations: [...new Set((entry.occurrences ?? []).map((o) => o.documentId))].map((documentId) => ({ documentId, status: "awaiting_approval", published: false }))
  };
}

// src/engine/sanityHttp.ts
function createSanityHttp(config) {
  const apiVersion = (config.apiVersion ?? "2024-01-01").replace(/^v/, "");
  const base = `https://${config.projectId}.api.sanity.io/v${apiVersion}/data`;
  const doFetch = config.fetch ?? globalThis.fetch;
  const request = async (path, init) => {
    if (!config.projectId || !config.dataset || !config.token) throw new EngineError("dataset");
    let response;
    try {
      response = await doFetch(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", ...init?.headers ?? {} }
      });
    } catch {
      throw new EngineError("dataset");
    }
    if (!response.ok) {
      throw new EngineError("dataset", {
        details: [`Sanity answered ${response.status}`]
      });
    }
    return await response.json();
  };
  return {
    async fetch(query, params = {}) {
      const body = await request(`/query/${config.dataset}?perspective=raw`, {
        method: "POST",
        body: JSON.stringify({ query, params })
      });
      return body.result;
    },
    async getDocument(id) {
      const body = await request(`/doc/${config.dataset}/${encodeURIComponent(id)}`);
      const documents = body.documents ?? [];
      return documents[0] ?? null;
    },
    async getDocuments(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        if (batch.length === 0) continue;
        const body = await request(`/doc/${config.dataset}/${batch.map(encodeURIComponent).join(",")}`);
        out.push(...body.documents ?? []);
      }
      return out;
    },
    async mutate(mutations) {
      await request(`/mutate/${config.dataset}?visibility=sync`, { method: "POST", body: JSON.stringify({ mutations }) });
    },
    async documentAuthor(id) {
      if (!config.projectId || !config.dataset || !config.token) throw new EngineError("dataset");
      let response;
      try {
        response = await doFetch(`${base}/history/${config.dataset}/transactions/${encodeURIComponent(id)}?excludeContent=true&limit=1`, {
          headers: { Authorization: `Bearer ${config.token}` }
        });
      } catch {
        throw new EngineError("dataset");
      }
      if (!response.ok) throw new EngineError("dataset", { details: [`Sanity answered ${response.status}`] });
      const text2 = await response.text();
      const first = text2.split("\n").find((line) => line.trim() !== "");
      if (!first) return null;
      try {
        const parsed = JSON.parse(first);
        return typeof parsed.author === "string" ? parsed.author : null;
      } catch {
        return null;
      }
    }
  };
}

// src/engine/secrets.ts
async function decryptSecret(privateKey, ciphertext) {
  const key = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    fromBase64(privateKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
  const plain = await globalThis.crypto.subtle.decrypt({ name: "RSA-OAEP" }, key, fromBase64(ciphertext));
  return new TextDecoder().decode(plain);
}
async function loadApiKey(sanity, options = {}) {
  const privateKey = options.privateKey ?? process.env.I18N_PRIVATE_KEY ?? "";
  if (privateKey.trim() === "") throw new EngineError("key_storage_not_configured");
  const document2 = await sanity.getDocument(SECRETS_ID);
  const stored = document2?.anthropicKey ?? null;
  if (!stored || typeof stored.ciphertext !== "string" || stored.ciphertext === "") throw new EngineError("missing_key");
  const publicKey = options.publicKey ?? process.env.NEXT_PUBLIC_I18N_PUBLIC_KEY ?? "";
  if (publicKey && stored.keyFingerprint) {
    let fingerprint = "";
    try {
      fingerprint = await publicKeyFingerprint(publicKey);
    } catch {
      fingerprint = "";
    }
    if (fingerprint && fingerprint !== stored.keyFingerprint) throw new EngineError("key_unreadable");
  }
  let plain = "";
  try {
    plain = await decryptSecret(privateKey, stored.ciphertext);
  } catch {
    throw new EngineError("key_unreadable");
  }
  if (plain.trim() === "") throw new EngineError("missing_key");
  return plain.trim();
}

// src/engine/job.ts
function isSanityLike(value) {
  return typeof value.getDocument === "function";
}
function resolveSanity(config) {
  return isSanityLike(config.sanity) ? config.sanity : createSanityHttp(config.sanity);
}
function publishedId2(id) {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}
async function loadManifest(config, sanity) {
  if (config.manifest) return config.manifest;
  const stored = await sanity.getDocument(MANIFEST_ID);
  if (typeof stored?.manifest === "string") {
    try {
      const parsed = JSON.parse(stored.manifest);
      if (parsed && typeof parsed === "object" && parsed.documents) return parsed;
    } catch {
    }
  }
  throw new EngineError("manifest_missing");
}
async function loadSettings(config, sanity, defaultId) {
  return sanity.fetch(
    `*[_type == $type && (${LANGUAGE_FIELD} == $lang || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))][0]`,
    { type: config.settings?.type ?? "settings", lang: defaultId }
  );
}
async function uniqueSlug(sanity, type, language, slugField, slug, ownId) {
  const taken = await sanity.fetch(
    `*[_type == $type && ${LANGUAGE_FIELD} == $lang && !(_id in [$id, $draft]) && string::startsWith(${slugField}.current, $slug)].${slugField}.current`,
    { type, lang: language, id: ownId, draft: `drafts.${ownId}`, slug }
  );
  const used = new Set(taken ?? []);
  if (!used.has(slug)) return slug;
  for (let n = 2; n < 1e3; n++) if (!used.has(`${slug}-${n}`)) return `${slug}-${n}`;
  return `${slug}-${Date.now()}`;
}
var weakRef = (id) => ({ _type: "reference", _ref: id, _weak: true });
async function metaMutation(sanity, sourceId, sourceType, defaultId, language, targetId) {
  const id = translationMetaId(sourceId);
  const existing = await sanity.getDocument(id);
  const before = Array.isArray(existing?.translations) ? existing.translations : [];
  const wanted = { [defaultId]: sourceId, [language]: targetId };
  const kept = before.filter((entry) => typeof entry?.language === "string" && !(entry.language in wanted));
  const translations = [
    { _key: defaultId, _type: "translation", language: defaultId, document: weakRef(sourceId) },
    ...kept,
    { _key: language, _type: "translation", language, document: weakRef(targetId) }
  ];
  const same = existing && existing.sourceType === sourceType && before.length === translations.length && Object.entries(wanted).every(
    ([lang, ref]) => before.some((entry) => entry.language === lang && entry.document?._ref === ref)
  );
  if (same) return null;
  return { createOrReplace: { _id: id, _type: TRANSLATION_META_TYPE, sourceType, translations } };
}
async function runTranslate(ctx) {
  const { config, sanity, job } = ctx;
  const languages = defineLanguages(config.languages);
  const defaultLanguage = languages.defaultLanguage;
  const target = languages.languages.find((l) => l.id === job.language);
  if (!target || target.id === defaultLanguage.id) throw new EngineError("language_unknown");
  const settings = await loadSettings(config, sanity, defaultLanguage.id);
  if (config.requireEnabledLanguage !== false) {
    const enabled = readEnabledLanguages(settings, languages, { fieldName: config.settings?.languagesField });
    if (!enabled.some((l) => l.id === target.id)) throw new EngineError("language_not_enabled");
  }
  const sourceId = publishedId2(String(job.sourceId ?? ""));
  if (sourceId === "") throw new EngineError("source_missing");
  const source = await sanity.getDocument(sourceId);
  if (!source) throw new EngineError("source_missing");
  const sourceLanguage = source[LANGUAGE_FIELD];
  if (typeof sourceLanguage === "string" && sourceLanguage !== "" && sourceLanguage !== defaultLanguage.id) {
    throw new EngineError("source_not_default_language");
  }
  const manifest = await loadManifest(config, sanity);
  const typeName = String(source._type ?? "");
  const documentType = manifest.documents[typeName];
  if (!documentType) throw new EngineError("type_not_translatable", { details: [typeName] });
  const targetId = translationId(sourceId, target.id);
  const found = await sanity.getDocuments([`drafts.${targetId}`, targetId]);
  const existing = found.find((d) => d._id === `drafts.${targetId}`) ?? found.find((d) => d._id === targetId) ?? null;
  const result = await translateDocument({
    document: source,
    language: target,
    sourceLanguage: defaultLanguage,
    manifest,
    glossary: readGlossary(settings, config.settings?.glossaryField ?? GLOSSARY_FIELD),
    styleGuide: readStyleGuide(settings, config.settings?.styleGuideField ?? STYLE_GUIDE_FIELD),
    models: readEngineSettings(settings, config.settings?.engineField ?? ENGINE_FIELD),
    client: ctx.clientFor,
    mode: job.mode === "changes" ? "changes" : "full",
    existingTranslation: existing,
    effort: config.effort,
    maxCharsPerRequest: config.maxCharsPerRequest,
    concurrency: config.concurrency ?? 2,
    policy: ctx.policy,
    onProgress: ctx.progress,
    now: config.now
  });
  const report = result.report;
  if (!result.translation) return { status: report.held ? "held" : "done", report };
  if (ctx.policy.signal?.aborted) throw new EngineError("timeout");
  await ctx.progress("Saving the draft");
  const translation = result.translation;
  if (documentType.slugField) {
    const current = translation[documentType.slugField]?.current;
    if (current) {
      const slug = await uniqueSlug(sanity, typeName, target.id, documentType.slugField, current, targetId);
      translation[documentType.slugField] = { _type: "slug", current: slug };
      report.proposedSlug = slug;
    }
  }
  report.saved = true;
  await ctx.progress("Checking legal text against the approval registry");
  const legalUnits = legalUnitsOf(source, manifest, typeName);
  const entryIds = legalUnits.map((u) => legalApprovalId(target.id, legalSourceHash(unitText(u.value))));
  const registryDocs = entryIds.length > 0 ? await sanity.getDocuments([...new Set(entryIds)]) : [];
  const entries = new Map(registryDocs.filter((d) => d._type === LEGAL_APPROVAL_TYPE).map((d) => [String(d._id), d]));
  const nowIso = (config.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  const plan = planLegalRegistry({
    language: target.id,
    documentId: targetId,
    documentType: typeName,
    units: legalUnits,
    translation,
    entries,
    now: nowIso,
    by: job.requestedBy ? { name: job.requestedBy } : void 0
  });
  const i18n = translation[I18N_FIELD];
  const status = statusAfterRun(report.held, plan.legal);
  i18n.legal = plan.legal;
  i18n.status = status;
  if (status === "approved") {
    i18n.approvedAt = nowIso;
    i18n.approvedBy = "Translation engine: both checks passed and no legal text is waiting";
  }
  report.status = status;
  report.legalPending = plan.legal.pending;
  report.legalApproved = plan.legal.approved;
  report.published = false;
  report.dependencies = await loadDependencies(sanity, translation, target.id, manifest, config.requiredDependencyTypes);
  i18n.report = reportForStorage(report);
  const mutations = [{ createOrReplace: { ...translation, _id: `drafts.${targetId}`, _type: typeName } }, ...plan.mutations];
  const meta = await metaMutation(sanity, sourceId, typeName, defaultLanguage.id, target.id, targetId);
  if (meta) mutations.push(meta);
  await sanity.mutate(mutations);
  const autoPublish = config.autoPublish ?? readEngineSettings(settings, config.settings?.engineField ?? ENGINE_FIELD).autoPublishMarketing;
  if (status === "approved" && autoPublish) {
    await ctx.progress("Publishing");
    const result2 = await publishTranslation(sanity, `drafts.${targetId}`, { manifest, now: config.now, publishDependents: true, requiredDependencyTypes: config.requiredDependencyTypes });
    report.published = result2.published;
    if (result2.dependentsPublished?.length) report.dependentsPublished = result2.dependentsPublished;
    if (!result2.published && result2.reason) report.publishNote = result2.reason;
    if (result2.published) {
      await sanity.mutate([{ patch: { id: targetId, set: { [`${I18N_FIELD}.report.published`]: true } } }]);
    }
  }
  return { status: report.held ? "held" : "done", report };
}
async function runApproval(ctx) {
  const { config, sanity, job } = ctx;
  const languages = defineLanguages(config.languages);
  const settings = await loadSettings(config, sanity, languages.defaultLanguage.id);
  const approvers = readLegalApprovers(settings, config.settings?.legalApproversField ?? LEGAL_APPROVERS_FIELD);
  const approver = job.approver ?? {};
  if (!isLegalApprover(approver.email, approvers)) throw new EngineError("not_an_approver");
  if (config.verifyJobAuthor !== false) {
    if (typeof sanity.documentAuthor !== "function" || !approver.id) throw new EngineError("approver_unverified");
    const author = await sanity.documentAuthor(job._id);
    if (!author || author !== approver.id) throw new EngineError("approver_unverified");
  }
  const unitId = String(job.unitId ?? "");
  if (unitId === "") throw new EngineError("unit_not_found");
  const decidedBy = { id: approver.id, name: approver.name, email: approver.email };
  const input = {
    sanity,
    unitId,
    decidedBy,
    comment: job.comment,
    autoPublish: config.autoPublish,
    settingsType: config.settings?.type,
    engineField: config.settings?.engineField,
    manifest: config.manifest,
    requiredDependencyTypes: config.requiredDependencyTypes,
    now: config.now
  };
  await ctx.progress(job.kind === "approve" ? "Approving" : "Sending back");
  return job.kind === "approve" ? approveUnit(input) : sendBackUnit(input);
}
async function runEstimate(ctx) {
  const { config, sanity, job } = ctx;
  const languages = defineLanguages(config.languages);
  const defaultLanguage = languages.defaultLanguage;
  const target = languages.languages.find((l) => l.id === job.language);
  if (!target || target.id === defaultLanguage.id) throw new EngineError("language_unknown");
  await ctx.progress("Reading the documents");
  const ids = [...new Set((job.sourceIds ?? []).map((id) => publishedId2(String(id))))].filter((id) => id !== "");
  const [settings, manifest, documents] = await Promise.all([
    loadSettings(config, sanity, defaultLanguage.id),
    loadManifest(config, sanity),
    sanity.getDocuments(ids)
  ]);
  const models = readEngineSettings(settings, config.settings?.engineField ?? ENGINE_FIELD);
  let counter;
  try {
    const client = await ctx.clientFor();
    counter = ({ model, system, user }) => countTokens(client, { model, system, messages: [{ role: "user", content: user }] }, ctx.policy);
  } catch (error) {
    const code = asEngineError(error).code;
    if (code !== "missing_key" && code !== "key_storage_not_configured" && code !== "key_unreadable") throw error;
  }
  await ctx.progress(counter ? "Counting tokens" : "Estimating from the length of the text");
  return estimateCost({
    documents,
    language: target,
    sourceLanguage: defaultLanguage,
    manifest,
    models,
    glossary: readGlossary(settings, config.settings?.glossaryField ?? GLOSSARY_FIELD),
    styleGuide: readStyleGuide(settings, config.settings?.styleGuideField ?? STYLE_GUIDE_FIELD),
    countTokens: counter
  });
}
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
async function pruneOldJobs(sanity, now) {
  try {
    const ids = await sanity.fetch(`*[_type == $type && defined(finishedAt) && finishedAt < $cutoff][0...100]._id`, {
      type: JOB_TYPE,
      cutoff: new Date(now.getTime() - THIRTY_DAYS_MS).toISOString()
    });
    if (ids && ids.length > 0) await sanity.mutate(ids.map((id) => ({ delete: { id } })));
  } catch {
  }
}
var TRANSLATE_JOB_KINDS = ["translate", "estimate"];
var APPROVAL_JOB_KINDS = ["approve", "send_back"];
async function runJob(config, id, allowedKinds = TRANSLATE_JOB_KINDS) {
  const now = config.now ?? (() => /* @__PURE__ */ new Date());
  const fail = (httpStatus, error) => ({
    httpStatus,
    ok: false,
    error: { code: error.code, message: error.message }
  });
  let sanity;
  let job;
  try {
    sanity = resolveSanity(config);
    job = await sanity.getDocument(id);
  } catch (error) {
    return fail(500, asEngineError(error));
  }
  if (!job || job._type !== JOB_TYPE) return fail(404, new EngineError("job_not_found"));
  if (!allowedKinds.includes(job.kind)) return fail(400, new EngineError("wrong_route"));
  if (job.status !== "pending") return fail(409, new EngineError("job_not_pending"));
  try {
    await sanity.mutate([
      { patch: { id, ...job._rev ? { ifRevisionID: job._rev } : {}, set: { status: "running", startedAt: now().toISOString(), progress: "Starting" } } }
    ]);
  } catch (error) {
    const engineError = asEngineError(error);
    return engineError.details.some((d) => d.includes("409")) ? fail(409, new EngineError("job_not_pending")) : fail(500, engineError);
  }
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new EngineError("timeout"));
    }, config.deadlineMs ?? 27e4);
  });
  const policy = { retry: config.retry, timeoutMs: config.requestTimeoutMs ?? 18e4, signal: controller.signal };
  const progress = async (text2) => {
    try {
      await sanity.mutate([{ patch: { id, set: { progress: text2 } } }]);
    } catch {
    }
  };
  let cachedClient;
  const clientFor = async () => {
    if (!cachedClient) {
      const apiKey = await loadApiKey(sanity, { privateKey: config.privateKey, publicKey: config.publicKey });
      cachedClient = config.anthropic ? config.anthropic(apiKey) : createAnthropicClient(apiKey, { timeoutMs: policy.timeoutMs });
    }
    return cachedClient;
  };
  const ctx = { config, sanity, job, policy, progress, clientFor };
  let outcome;
  let set;
  try {
    if (job.kind === "estimate") {
      const estimate = await Promise.race([runEstimate(ctx), deadline]);
      set = { status: "done", estimate, progress: "Finished" };
      outcome = { httpStatus: 200, ok: true, status: "done" };
    } else if (job.kind === "approve" || job.kind === "send_back") {
      const approval = await Promise.race([runApproval(ctx), deadline]);
      set = { status: "done", approval, progress: "Finished" };
      outcome = { httpStatus: 200, ok: true, status: "done" };
    } else {
      const { status, report } = await Promise.race([runTranslate(ctx), deadline]);
      set = { status, report: reportForStorage(report), progress: "Finished" };
      outcome = { httpStatus: 200, ok: true, status };
    }
  } catch (error) {
    const engineError = controller.signal.aborted ? new EngineError("timeout") : asEngineError(error);
    set = {
      status: "failed",
      progress: "Finished",
      error: { code: engineError.code, message: engineError.message, details: engineError.details.slice(0, 25) }
    };
    outcome = { httpStatus: 200, ok: false, status: "failed", error: { code: engineError.code, message: engineError.message } };
  } finally {
    clearTimeout(timer);
  }
  try {
    await sanity.mutate([{ patch: { id, set: { ...set, finishedAt: now().toISOString() } } }]);
  } catch (error) {
    return fail(500, asEngineError(error));
  }
  await pruneOldJobs(sanity, now());
  return outcome;
}

// src/engine/route.ts
function assertServer() {
  if (typeof window !== "undefined" || typeof document !== "undefined") {
    throw new Error(
      "@kaleidico/sanity-i18n/engine/route is server-only. Import it from a Route Handler, never from client code."
    );
  }
}
assertServer();
var JOB_ID = new RegExp(`^${JOB_ID_PREFIX.replace(/\./g, "\\.")}[A-Za-z0-9-]{8,64}$`);
function json(outcome) {
  const { httpStatus, ...body } = outcome;
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function createJobRoute(config, kinds) {
  return {
    async POST(request) {
      const refuse = () => {
        const error = new EngineError("bad_request");
        return json({ httpStatus: 400, ok: false, error: { code: error.code, message: error.message } });
      };
      let body;
      try {
        body = await request.json();
      } catch {
        return refuse();
      }
      const keys = body !== null && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
      const id = body?.jobId;
      if (keys.length !== 1 || typeof id !== "string" || !JOB_ID.test(id)) return refuse();
      return json(await runJob(config, id, kinds));
    }
  };
}
function createTranslateRoute(config) {
  return createJobRoute(config, TRANSLATE_JOB_KINDS);
}
function createApprovalRoute(config) {
  return createJobRoute(config, APPROVAL_JOB_KINDS);
}

export { createApprovalRoute, createTranslateRoute };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map