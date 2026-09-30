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

/** An in-memory stand-in for the dataset, with the four calls the engine makes. */
export function memorySanity(documents = []) {
  const store = new Map(documents.map((d) => [d._id, { _rev: "r0", ...d }]));
  let revision = 0;
  const mutations = [];
  return {
    store,
    mutations,
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
    async mutate(list) {
      for (const mutation of list) {
        mutations.push(mutation);
        if (mutation.createOrReplace) store.set(mutation.createOrReplace._id, { ...mutation.createOrReplace, _rev: `r${++revision}` });
        else if (mutation.delete) store.delete(mutation.delete.id);
        else if (mutation.patch) {
          const doc = store.get(mutation.patch.id);
          if (!doc) throw Object.assign(new Error("not found"), { details: ["Sanity answered 404"] });
          if (mutation.patch.ifRevisionID && mutation.patch.ifRevisionID !== doc._rev) {
            const { EngineError } = await import("../../dist/engine/index.js");
            throw new EngineError("dataset", { details: ["Sanity answered 409"] });
          }
          store.set(doc._id, { ...doc, ...mutation.patch.set, _rev: `r${++revision}` });
        }
      }
    },
  };
}
