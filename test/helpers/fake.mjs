// A fake Anthropic client with the three methods the engine uses. It
// "translates" by passing every text through `transform`, and answers a
// review request with the issues it was given.

const FIXED = new Set(["_key", "_type", "style", "listItem", "level", "marks", "markDefs"]);

export function mapText(value, transform, key) {
  if (typeof value === "string") return FIXED.has(key) ? value : transform(value);
  if (Array.isArray(value)) return FIXED.has(key) ? value : value.map((item) => mapText(item, transform, undefined));
  if (value && typeof value === "object") {
    if (FIXED.has(key)) return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapText(v, transform, k)]));
  }
  return value;
}

export function createFakeAnthropic(options = {}) {
  const transform = options.transform ?? ((s) => `[es] ${s}`);
  const calls = [];
  const errors = [...(options.errors ?? [])];
  let translateCount = 0;

  const answer = (params) => {
    const firstUser = params.messages.find((m) => m.role === "user");
    const request = JSON.parse(firstUser.content);
    const isRetry = params.messages.length > 1;
    let body;
    if (request.task === "translate") {
      translateCount++;
      const custom = options.onTranslate?.({ request, params, isRetry, count: translateCount });
      body = custom ?? { translated: mapText(request.translate, transform, undefined), ...(request.slug ? { slug: options.slug ?? "prestamos-convencionales" } : {}) };
    } else {
      const custom = options.onReview?.({ request, params });
      body = custom ?? { issues: options.issues ?? [] };
    }
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return {
      content: [{ type: "text", text }],
      stop_reason: options.stopReason ?? "end_turn",
      model: options.servedBy ?? params.model,
      usage: { input_tokens: Math.ceil(JSON.stringify(params).length / 4), output_tokens: Math.ceil(text.length / 4), cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
  };

  const stream = (endpoint) => (params, requestOptions) => ({
    async finalMessage() {
      calls.push({ endpoint, params, requestOptions });
      const next = errors.shift();
      if (next) throw next;
      return answer(params);
    },
  });

  return {
    calls,
    messages: {
      stream: stream("messages"),
      countTokens: async (params) => {
        calls.push({ endpoint: "countTokens", params });
        return { input_tokens: Math.ceil((JSON.stringify(params.system).length + JSON.stringify(params.messages).length) / 4) };
      },
    },
    beta: { messages: { stream: stream("beta") } },
  };
}

// ── A tiny JSONMatch for the patch operations the package uses ──────────
// Paths: `a.b`, `a[_key == "k"].b`, `a[-1]`, `i18n.status`. Enough for the
// engine's own patches; not a general implementation.

function parseSegments(path) {
  const segments = [];
  const re = /\[_key\s*==\s*"([^"]+)"\]|\[(-?\d+)\]|([^.[\]]+)/g;
  let m;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) segments.push({ key: m[1] });
    else if (m[2] !== undefined) segments.push(Number(m[2]));
    else segments.push(m[3]);
  }
  return segments;
}

function stepInto(current, segment, create) {
  if (typeof segment === "string") {
    if (current[segment] === undefined && create) current[segment] = {};
    return current[segment];
  }
  if (!Array.isArray(current)) return undefined;
  if (typeof segment === "number") return current[segment < 0 ? current.length + segment : segment];
  return current.find((item) => item && item._key === segment.key);
}

function setPath(doc, path, value) {
  const segments = parseSegments(path);
  let current = doc;
  for (const segment of segments.slice(0, -1)) current = stepInto(current, segment, true);
  const last = segments[segments.length - 1];
  if (typeof last === "string") current[last] = value;
  else {
    const index = typeof last === "number" ? last : current.findIndex((item) => item && item._key === last.key);
    if (index >= 0) current[index] = value;
  }
}

function unsetPath(doc, path) {
  const segments = parseSegments(path);
  let current = doc;
  for (const segment of segments.slice(0, -1)) {
    current = stepInto(current, segment, false);
    if (current === undefined) return;
  }
  const last = segments[segments.length - 1];
  if (typeof last === "string") delete current[last];
  else if (Array.isArray(current)) {
    const index = typeof last === "number" ? last : current.findIndex((item) => item && item._key === last.key);
    if (index >= 0) current.splice(index, 1);
  }
}

function insertAt(doc, spec) {
  const [position, path] = spec.after ? ["after", spec.after] : spec.before ? ["before", spec.before] : ["replace", spec.replace];
  const segments = parseSegments(path);
  let current = doc;
  for (const segment of segments.slice(0, -1)) current = stepInto(current, segment, true);
  const last = segments[segments.length - 1];
  if (typeof last !== "number") throw new Error(`memorySanity: insert only supports an index, got ${path}`);
  const list = current;
  if (!Array.isArray(list)) throw new Error(`memorySanity: insert target is not a list: ${path}`);
  let index = last < 0 ? list.length + last : last;
  if (position === "after") index += 1;
  if (list.length === 0) index = 0;
  list.splice(index, position === "replace" ? 1 : 0, ...spec.items);
}

export function applyPatch(doc, patch) {
  if (patch.setIfMissing) for (const [path, value] of Object.entries(patch.setIfMissing)) {
    const segments = parseSegments(path);
    let current = doc;
    for (const segment of segments.slice(0, -1)) current = stepInto(current, segment, true);
    const last = segments[segments.length - 1];
    if (current[last] === undefined) current[last] = value;
  }
  if (patch.set) for (const [path, value] of Object.entries(patch.set)) setPath(doc, path, JSON.parse(JSON.stringify(value)));
  if (patch.unset) for (const path of patch.unset) unsetPath(doc, path);
  if (patch.insert) insertAt(doc, patch.insert);
}

/** An in-memory stand-in for the dataset, with the calls the engine makes. */
export function memorySanity(documents = [], options = {}) {
  const store = new Map(documents.map((d) => [d._id, { _rev: "r0", ...d }]));
  let revision = 0;
  const mutations = [];
  const authors = new Map(Object.entries(options.authors ?? {}));
  return {
    store,
    mutations,
    authors,
    async fetch(query, params = {}) {
      if (query.includes("string::startsWith")) {
        return [...store.values()]
          .filter((d) => d._type === params.type && d.language === params.lang && ![params.id, params.draft].includes(d._id))
          .map((d) => d.slug?.current)
          .filter((s) => typeof s === "string" && s.startsWith(params.slug));
      }
      if (query.includes("finishedAt <")) return [];
      if (query.includes("_type == $type")) {
        return [...store.values()].find((d) => d._type === params.type && !d._id.startsWith("drafts.") && (!d.language || d.language === params.lang)) ?? null;
      }
      throw new Error(`memorySanity: unexpected query ${query}`);
    },
    async getDocument(id) {
      const doc = store.get(id);
      return doc ? JSON.parse(JSON.stringify(doc)) : null;
    },
    async getDocuments(ids) {
      return ids.map((id) => store.get(id)).filter(Boolean).map((d) => JSON.parse(JSON.stringify(d)));
    },
    async documentAuthor(id) {
      if (!store.has(id)) throw Object.assign(new Error("not found"), { details: ["Sanity answered 404"] });
      return authors.get(id) ?? null;
    },
    async mutate(list) {
      for (const mutation of list) {
        mutations.push(mutation);
        if (mutation.createOrReplace) store.set(mutation.createOrReplace._id, { ...JSON.parse(JSON.stringify(mutation.createOrReplace)), _rev: `r${++revision}` });
        else if (mutation.create) {
          if (store.has(mutation.create._id)) throw Object.assign(new Error("exists"), { details: ["Sanity answered 409"] });
          store.set(mutation.create._id, { ...JSON.parse(JSON.stringify(mutation.create)), _rev: `r${++revision}` });
        } else if (mutation.createIfNotExists) {
          if (!store.has(mutation.createIfNotExists._id)) store.set(mutation.createIfNotExists._id, { ...JSON.parse(JSON.stringify(mutation.createIfNotExists)), _rev: `r${++revision}` });
        } else if (mutation.delete) store.delete(mutation.delete.id);
        else if (mutation.patch) {
          const doc = store.get(mutation.patch.id);
          if (!doc) throw Object.assign(new Error("not found"), { details: ["Sanity answered 404"] });
          if (mutation.patch.ifRevisionID && mutation.patch.ifRevisionID !== doc._rev) {
            const { EngineError } = await import("../../dist/engine/index.js");
            throw new EngineError("dataset", { details: ["Sanity answered 409"] });
          }
          const next = JSON.parse(JSON.stringify(doc));
          applyPatch(next, mutation.patch);
          next._rev = `r${++revision}`;
          store.set(doc._id, next);
        }
      }
    },
  };
}
