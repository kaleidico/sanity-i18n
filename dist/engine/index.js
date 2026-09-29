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

// src/engine/index.ts
function assertServer() {
  if (typeof window !== "undefined" || typeof document !== "undefined") {
    throw new Error(
      "@kaleidico/sanity-i18n/engine is server-only. Import it from a Route Handler, Server Action or server component, never from client code."
    );
  }
}
assertServer();
async function translateDocument(_input) {
  assertServer();
  throw new Error(
    "@kaleidico/sanity-i18n/engine: translateDocument() is not implemented until part 4 (translation engine)."
  );
}

export { defineLanguages, translateDocument };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map