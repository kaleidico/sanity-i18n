import { test } from "node:test";
import assert from "node:assert/strict";
import { createI18nMiddleware, isExcludedPath } from "../dist/next/middleware/index.js";
import { resolveLocaleRoute } from "../dist/next/index.js";

const languages = [{ id: "es", title: "Spanish", nativeTitle: "Español" }];

function request(path, origin = "https://example.com") {
  const url = new URL(path, origin);
  return {
    nextUrl: {
      pathname: url.pathname,
      clone: () => new URL(url.toString()),
    },
    url: url.toString(),
  };
}

function describe(response) {
  if (!response) return { kind: "pass" };
  const status = response.status;
  const location = response.headers.get("location");
  const rewrite = response.headers.get("x-middleware-rewrite");
  if (location) return { kind: "redirect", status, to: new URL(location).pathname };
  if (rewrite) return { kind: "rewrite", to: new URL(rewrite).pathname };
  return { kind: "next", status };
}

test("default-language requests are rewritten under the hidden prefix", () => {
  const mw = createI18nMiddleware({ languages });
  assert.deepEqual(describe(mw(request("/"))), { kind: "rewrite", to: "/en" });
  assert.deepEqual(describe(mw(request("/conventional-loans"))), { kind: "rewrite", to: "/en/conventional-loans" });
  assert.deepEqual(describe(mw(request("/blog/some-post?x=1"))), { kind: "rewrite", to: "/en/blog/some-post" });
});

test("a direct request to the default prefix redirects 308 to the bare path", () => {
  const mw = createI18nMiddleware({ languages });
  assert.deepEqual(describe(mw(request("/en"))), { kind: "redirect", status: 308, to: "/" });
  assert.deepEqual(describe(mw(request("/en/"))), { kind: "redirect", status: 308, to: "/" });
  assert.deepEqual(describe(mw(request("/en/about"))), { kind: "redirect", status: 308, to: "/about" });
  // A path that merely starts with the letters is not the prefix.
  assert.deepEqual(describe(mw(request("/english-tips"))), { kind: "rewrite", to: "/en/english-tips" });
});

test("other enabled languages pass through untouched", () => {
  const mw = createI18nMiddleware({ languages });
  assert.deepEqual(describe(mw(request("/es"))), { kind: "pass" });
  assert.deepEqual(describe(mw(request("/es/prestamos-convencionales"))), { kind: "pass" });
  // A language that is not enabled is treated as an ordinary path.
  assert.deepEqual(describe(mw(request("/fr/bonjour"))), { kind: "rewrite", to: "/en/fr/bonjour" });
});

test("api, _next, studio, files and custom exclusions are left alone", () => {
  const mw = createI18nMiddleware({ languages, exclude: ["/preview", /^\/internal-/] });
  for (const path of [
    "/api/revalidate",
    "/_next/static/chunk.js",
    "/studio",
    "/studio/desk",
    "/sitemap.xml",
    "/robots.txt",
    "/feed.xml",
    "/llms.txt",
    "/favicon.ico",
    "/fonts/soleil-regular.woff2",
    "/preview",
    "/preview/page",
    "/internal-tools",
  ]) {
    assert.deepEqual(describe(mw(request(path))), { kind: "pass" }, path);
  }
  assert.equal(isExcludedPath("/apiary"), false);
  assert.equal(isExcludedPath("/studios"), false);
});

test("languages can be a plain list of ids or resolved per request", async () => {
  const sync = createI18nMiddleware({ languages: ["es"] });
  assert.deepEqual(describe(sync(request("/es"))), { kind: "pass" });

  let enabled = ["en"];
  const dynamic = createI18nMiddleware({ languages: () => Promise.resolve(enabled) });
  assert.deepEqual(describe(await dynamic(request("/es"))), { kind: "rewrite", to: "/en/es" });
  enabled = ["en", "es"];
  assert.deepEqual(describe(await dynamic(request("/es"))), { kind: "pass" });
});

test("a different default language moves the root", () => {
  const mw = createI18nMiddleware({
    languages: [{ id: "es", title: "Spanish", default: true }, { id: "en", title: "English" }],
  });
  assert.deepEqual(describe(mw(request("/hola"))), { kind: "rewrite", to: "/es/hola" });
  assert.deepEqual(describe(mw(request("/es/hola"))), { kind: "redirect", status: 308, to: "/hola" });
  assert.deepEqual(describe(mw(request("/en/hello"))), { kind: "pass" });
});

test("resolveLocaleRoute is the pure decision behind the middleware", () => {
  const options = { ids: ["en", "es"], defaultId: "en" };
  assert.deepEqual(resolveLocaleRoute("/", options), { kind: "rewrite", pathname: "/en" });
  assert.deepEqual(resolveLocaleRoute("/about", options), { kind: "rewrite", pathname: "/en/about" });
  assert.deepEqual(resolveLocaleRoute("/en/about", options), { kind: "redirect", pathname: "/about", status: 308 });
  assert.deepEqual(resolveLocaleRoute("/es/acerca", options), { kind: "pass" });
  assert.deepEqual(resolveLocaleRoute("/api/x", options), { kind: "pass" });
});
