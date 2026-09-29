import { NextResponse } from 'next/server.js';

// src/next/middleware/index.ts

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

// src/next/middleware/index.ts
function respond(request, ids, defaultId, exclude) {
  const route = resolveLocaleRoute(request.nextUrl.pathname, { ids, defaultId, exclude });
  if (route.kind === "pass") return void 0;
  const url = request.nextUrl.clone();
  url.pathname = route.pathname;
  return route.kind === "redirect" ? NextResponse.redirect(url, route.status) : NextResponse.rewrite(url);
}
function createI18nMiddleware(options) {
  const exclude = options.exclude ?? [];
  if (typeof options.languages === "function") {
    const resolve = options.languages;
    return async (request) => {
      const { ids: ids2, defaultId: defaultId2 } = resolveLanguageIds(await resolve(), options.defaultId);
      return respond(request, ids2, defaultId2, exclude);
    };
  }
  const { ids, defaultId } = resolveLanguageIds(options.languages, options.defaultId);
  return (request) => respond(request, ids, defaultId, exclude);
}

export { createI18nMiddleware, isExcludedPath, resolveLanguageIds, resolveLocaleRoute };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map