# @kaleidico/sanity-i18n

Multi-language content for Sanity and Next.js sites. One package, three parts:

1. **Sanity plugin** (`@kaleidico/sanity-i18n/sanity`): a "Languages" tab in Site Settings with a switch per language, and the schema and Studio tooling for linked translations.
2. **Next.js kit** (`@kaleidico/sanity-i18n/next`): locale routing under a prefix such as `/es`, hreflang and canonical tags, sitemap alternates, a language switcher and a UI dictionary.
3. **Translation engine** (`@kaleidico/sanity-i18n/engine`, server only): translates documents with the client's own Anthropic API key, applying a glossary, a style guide, exact-match checks and a reviewer pass.

Version 0.3.0 ships the Sanity plugin (the Languages tab and the document-level content model: a document per language, linked to the source, with shared fields, per-language slugs, a status per document and legal marks) and the Next.js kit (locale routing, hreflang and canonical tags, Open Graph locales, sitemap alternates, the language switcher, the suggestion strip and the UI dictionary). The engine is still a stub that throws a clear error when called.

## Requirements

- Node 20 or newer
- `sanity` 5
- `react` 18 or 19
- `next` 15 or 16 (optional, only for the Next.js kit)

## Install

Until the package is on npm, install it from the release tag on GitHub. Each tag carries the built `dist/` folder.

```bash
npm install github:kaleidico/sanity-i18n#v0.3.0
```

Once published:

```bash
npm install @kaleidico/sanity-i18n
```

## Set up a Sanity + Next.js site

Three small edits, all in the Studio side of the site.

### 1. Define the languages once

Create a file the schema and the Studio config can both import, for example `src/sanity/languages.ts`:

```ts
import { defineLanguages } from "@kaleidico/sanity-i18n/sanity";

export const languages = defineLanguages([
  { id: "es", title: "Spanish", nativeTitle: "Español" },
]);
```

English (`en`) is the default language and is added for you when it is not listed. To use another default, list it with `default: true`.

### 2. Add the Languages tab to Site Settings

In the Site Settings document type (often `settings.ts`), add the group and the field:

```ts
import { defineField, defineType } from "sanity";
import { LANGUAGES_GROUP, languagesField } from "@kaleidico/sanity-i18n/sanity";
import { languages } from "./languages";

export const settings = defineType({
  name: "settings",
  title: "Site Settings",
  type: "document",
  groups: [
    { name: "branding", title: "Branding", default: true },
    // ...your other groups
    LANGUAGES_GROUP,
  ],
  fields: [
    // ...your other fields
    languagesField({ languages }),
  ],
});
```

The field is an object named `languages` with one boolean per language. The default language is always on and read only. Every other language starts off.

### 3. Add the plugin to the Studio config

In `sanity.config.ts`:

```ts
import { defineConfig } from "sanity";
import { i18nPlugin } from "@kaleidico/sanity-i18n/sanity";
import { languages } from "./src/sanity/languages";

export default defineConfig({
  // ...
  plugins: [
    // ...your other plugins
    i18nPlugin({ languages, translatableTypes: ["page", "blogPost"] }),
  ],
});
```

`translatableTypes` lists the document types you wrap in the next section. It can start empty and grow as you wrap types.

### Reading the switches from the front end

`readEnabledLanguages()` is a pure function that takes the settings document (or any object with a `languages` field) and returns the enabled languages, default first, in the order you configured them.

```ts
import { readEnabledLanguages } from "@kaleidico/sanity-i18n/next";
import { languages } from "@/sanity/languages";

const settings = await client.fetch(`*[_type == "settings"][0]{ languages }`);
const enabled = readEnabledLanguages(settings, languages);
// [{ id: "en", ... }, { id: "es", ... }] when Spanish is switched on
```

## Content model

Each language is its own document. A Spanish page is a `page` document with `language: "es"` and a link to the English page it was translated from. It has its own slug and its own SEO; fields that are the same in every language (photos, phone numbers, NMLS numbers, references) are read from the English document and are read only on the translation.

### Wrap a document type

```ts
import { defineField, defineType } from "sanity";
import { translatable } from "@kaleidico/sanity-i18n/sanity";
import { languages } from "../../languages";

export const loanOfficer = translatable(
  defineType({
    name: "loanOfficer",
    type: "document",
    fields: [
      defineField({ name: "name", type: "string" }),
      defineField({ name: "slug", type: "slug", options: { source: "name" } }),
      defineField({ name: "photo", type: "image" }),
      defineField({ name: "nmls", type: "string" }),
      defineField({ name: "bio", type: "text" }),
      defineField({ name: "seo", type: "seo" }),
    ],
  }),
  {
    languages,
    sharedFields: ["photo", "nmls"],
    labels: { awaiting_approval: "Awaiting NOVA approval" },
  },
);
```

`translatable()` returns a new definition with, at the top:

- `language` (string, read only, starts as the default language). Pass `hideLanguageOnDefault: true` to hide it on default-language documents.
- `i18n` ("Translation", collapsible, hidden on default-language documents): `source` (weak reference to the source document), `status` (`draft`, `needs_update`, `awaiting_approval`, `approved`), `sourceHash` (hidden), `translatedAt`, `approvedAt`, `approvedBy` (read only, filled by the approval workflow).

And on the existing fields:

- every `sharedFields` entry is read only on a translation, with the note "Shared with the English document; edit it there". The front end reads them from the source with `sharedProjection()`.
- the slug field (`slugField`, default `slug`) is unique within its language, so `/es/sobre-nosotros` and `/about` never collide with each other's language.
- a translation's preview subtitle starts with its language and status, `ES · Awaiting approval`, so any list doubles as a review queue.

`labels` overrides the status titles; pass the same `labels` to `i18nPlugin()` so the badge matches.

`getSharedFields(typeDef)` reads the shared field names back from a wrapped definition, for the engine and the GROQ helpers.

### Mark legal text

Disclaimers, disclosures, consent language, NMLS and Equal Housing lines need a person's approval before they go live in another language. Mark the field or the block type:

```ts
import { legalText, legalBlock } from "@kaleidico/sanity-i18n/sanity";

legalText(defineField({ name: "footerDisclaimer", type: "text" }));
legalBlock(defineType({ name: "disclosureBlock", type: "object", fields: [...] }));
```

The mark is `options.i18n.legal = true`, and the description gains "(legal text: needs approval before it goes live in another language)". `isLegal(fieldOrType)` reads it back; `collectLegalPaths(documentType, { types })` lists every legal path in a document type (`footerDisclaimer`, `legalLinks[].label`, `fields[consentField].consentText`, `blocks[disclosureBlock]`), one level deep into arrays.

### The metadata document

`i18n.translationMeta` links one source document to every language it exists in: `sourceType` and `translations[]`, one entry per language (`_key` is the language id) with a weak reference to that language's document. Its id is deterministic, `translationMetaId(sourceId)` = `i18n.meta.<sourceId>`, so there is never more than one per source. Both directions resolve in GROQ: a translation's `i18n.source` points at the source, the metadata document lists all languages. The plugin registers the type once `translatableTypes` is set; it is hidden from search and should not be listed in the desk.

### Desk

```ts
import { translationsStructure, languageFilter } from "@kaleidico/sanity-i18n/sanity";
import { languages } from "./languages";

export const deskStructure = (S: StructureBuilder) =>
  S.list().title("Content").items([
    S.listItem().title("Pages").child(
      S.documentTypeList("page").title("Pages").filter(`_type == $type && ${languageFilter("en")}`),
    ),
    S.divider(),
    translationsStructure(S, {
      languages,
      types: ["page", "blogPost"],
      titles: { page: "Pages", blogPost: "Blog Posts" },
    }),
  ]);
```

`languageFilter("en")` keeps the existing English lists English: it matches `language == "en"` and documents that have no `language` field yet, so nothing you already have disappears. `translationsStructure()` adds a "Translations" section with a list per non-default language, each listing the translatable types in that language.

### Reading translations from Next.js

`@kaleidico/sanity-i18n/next` has no Sanity import and gives you GROQ as strings:

```ts
import { localeFilter, sharedProjection, translationLinks } from "@kaleidico/sanity-i18n/next";

const query = `*[_type == "loanOfficer" && ${localeFilter(lang)} && slug.current == $slug][0]{
  ...,
  ${sharedProjection(["photo", "nmls"])},
  ${translationLinks()}
}`;
```

- `localeFilter("es")` is `language == "es"`; for the default language it is `(language == "en" || !defined(language))`, so existing documents still match.
- `sharedProjection(["photo"])` is `"photo": coalesce(photo, i18n.source->photo)`.
- `translationLinks()` adds `language` and `translations: [{ language, slug }]` for the switcher and hreflang tags, from either side of the link.

## Next.js kit

The site keeps English at the root and every other language under a prefix with its own slugs: `/conventional-loans` and `/es/prestamos-convencionales`. Only approved translations get a URL; a Spanish URL never falls back to English text.

### Routes

Move the public routes under a `[lang]` segment (`src/app/[lang]/...`) whose layout is the root layout and sets `<html lang={lang}>`. `generateStaticParams` on `[lang]` returns the enabled languages. Every route reads `params.lang`, filters its query with `localeFilter(lang)` (plus `i18n.status == "approved"` for non-default languages) and calls `notFound()` when nothing matches.

### Middleware

```ts
// src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createI18nMiddleware } from "@kaleidico/sanity-i18n/next/middleware";
import { languages } from "@/sanity/languages";

const i18n = createI18nMiddleware({ languages, exclude: ["/preview"] });

export function middleware(request: NextRequest) {
  return i18n(request) ?? NextResponse.next();
}
```

A default-language request (`/about`) is rewritten to `/en/about`, so the public URL never changes. A direct request to `/en/about` is redirected (308) to `/about`, so there is one English URL. `/es/...` passes through. `/api`, `/_next`, `/studio`, any path with a file extension and anything in `exclude` are left alone. Pass `languages` as a function to resolve the enabled languages per request from a cached settings fetch; the middleware is then async. `resolveLocaleRoute()` in `/next` is the pure decision behind it, for tests.

### Metadata

```ts
import { buildAlternates, openGraphLocale, inLanguage } from "@kaleidico/sanity-i18n/next";

export async function generateMetadata({ params }) {
  const { lang } = await params;
  const page = await getPage(lang, slug);
  const translations = Object.fromEntries(
    page.translations.filter((t) => t.language === "en" || t.status === "approved").map((t) => [t.language, `/${t.slug}`]),
  );
  return {
    alternates: buildAlternates({ siteUrl, lang, path: `/${page.slug}`, translations }),
    openGraph: { ...openGraphLocale(lang, Object.keys(translations)) },
  };
}
```

`buildAlternates()` returns a self-referencing canonical in the page's own language and an hreflang entry per language the page exists in, plus `x-default` pointing at the default-language URL. Every language's page passes the same set, so the tags are reciprocal. `openGraphLocale("es", ["en", "es"])` gives `{ locale: "es_US", alternateLocale: ["en_US"] }`; `inLanguage("es")` gives `es-US` for JSON-LD; `localePath("es", "/about")` gives `/es/about`.

### Switcher and suggestion strip

`LanguageSwitcher` is a plain server-renderable `nav`: one link per other language, each with `lang` and `hrefLang` and the language's own name, to the same page in that language when a translation is live, else to that language's home. It renders nothing with one language, so a site with every other language switched off is unchanged.

```tsx
<LanguageSwitcher current={lang} languages={enabled} links={{ es: "/es/prestamos-convencionales" }} homeHrefs={{ en: "/", es: "/es" }} labels={{ ariaLabel: t(lang, "language") }} />
```

`LanguageSuggestion` (from `@kaleidico/sanity-i18n/next/client`) is a small dismissible strip that shows on a default-language page when the browser prefers an enabled language ("Ver en español"). It never redirects, remembers a dismissal in `localStorage` for 30 days, and renders nothing when no other language is enabled.

### UI dictionary

```ts
import { createDictionary } from "@kaleidico/sanity-i18n/next";

export const dictionary = createDictionary({
  en: { readMore: "Read more", minRead: "{minutes} min read" },
  es: { readMore: "Leer más", minRead: "{minutes} min de lectura" },
});
export const t = dictionary.t; // t("es", "minRead", { minutes: 4 })
```

Every language must define every key; a missing one fails at startup rather than falling back to English on a live page. Dates and money go through `Intl.DateTimeFormat(languageTag(lang))` and `Intl.NumberFormat(languageTag(lang), { style: "currency", currency: "USD" })`.

## What switching a language on does, and does not do

Switching a language on in Site Settings **publishes nothing by itself**. It tells the site that the language exists, so the later parts of this package can offer it: a translation can be started for a page, the routing can reserve the `/es` prefix, and the switcher can list it. A page in that language only appears on the live site once it has been translated and its translation is approved.

Switching a language off hides it everywhere. Existing translations are kept, not deleted, so switching it back on restores them.

The default language cannot be switched off. Every translation is made from it.

## API

`@kaleidico/sanity-i18n/sanity`

| Export | What it is |
| --- | --- |
| `defineLanguages(languages)` | Validates a list of languages and returns `{ languages, defaultLanguage }`, default first. |
| `languagesField({ languages, group?, fieldName? })` | The `languages` object field for Site Settings. |
| `LANGUAGES_GROUP` | `{ name: "languages", title: "Languages" }` for the settings groups. |
| `i18nPlugin({ languages, translatableTypes?, labels? })` | The Studio plugin, named `kaleidico-i18n`: registers the metadata type and the language and status badge. |
| `translatable(documentType, { languages?, sharedFields?, slugField?, hideLanguageOnDefault?, labels? })` | Wraps a document type for document-level translations. |
| `getSharedFields(typeDef)`, `getTranslatableMarker(typeDef)`, `isTranslatable(typeDef)` | Read back what `translatable()` recorded on a definition. |
| `isTranslationDocument(doc, defaultId?)` | True when a document's language is set and is not the default. |
| `legalText(field)`, `legalBlock(type)`, `isLegal(x)`, `collectLegalPaths(type, { types? })`, `LEGAL_NOTE` | Legal marking. |
| `translationMetaType({ translatableTypes })`, `TRANSLATION_META_TYPE`, `translationMetaId(sourceId)` | The `i18n.translationMeta` document type and its id scheme. |
| `translationBadge({ defaultId?, labels? })`, `TRANSLATION_BADGE_COLORS` | The document badge the plugin registers. |
| `translationsStructure(S, { languages, types, titles?, title? })`, `languageFilter(id, defaultId?)` | Desk helpers. |
| `TRANSLATION_STATUSES`, `translationStatusList(labels?)`, `translationStatusLabel(status, labels?)` | The four states: `draft`, `needs_update`, `awaiting_approval`, `approved`. |
| `readEnabledLanguages(settingsDoc, languages, { fieldName? })` | Enabled languages from a settings document, default first. |
| `languageFieldKey(id)` | The field name a language id is stored under (`pt-BR` becomes `pt_BR`). |
| `LANGUAGE_FIELD`, `I18N_FIELD` | `"language"` and `"i18n"`, the field names on a translatable document. |
| `Language`, `LanguagesConfig`, `LanguagesInput`, `TranslationStatus`, `TranslationLabels`, `TranslatableOptions` | Types. |

`@kaleidico/sanity-i18n/next`

| Export | What it is |
| --- | --- |
| `defineLanguages`, `readEnabledLanguages`, `languageFieldKey`, types | Re-exported from the shared core, no Sanity import. |
| `localeFilter(lang, defaultId?)` | GROQ clause matching one language (the default also matches documents without the field). |
| `sharedProjection(fields)` | GROQ projection entries reading shared fields from the source document. |
| `translationLinks({ slugField?, defaultId? })` | GROQ projection entries giving `language` and `translations: [{ language, slug, status }]`. |
| `translationMetaId(sourceId)`, `TRANSLATION_META_TYPE`, `TRANSLATION_STATUSES`, `translationStatusLabel` | Shared constants and helpers. |
| `resolveLocaleRoute(pathname, { ids, defaultId, exclude? })`, `resolveLanguageIds`, `isExcludedPath` | The pure routing decision (`pass`, `rewrite`, `redirect`). |
| `buildAlternates({ siteUrl, lang, defaultId?, path, translations? })` | `Metadata.alternates`: self canonical plus reciprocal hreflang with `x-default`. |
| `openGraphLocale(lang, others?)`, `inLanguage(lang)`, `languageTag(lang)`, `localePath(lang, path)`, `localeUrl(siteUrl, lang, path)` | Locale tags and per-language URLs. |
| `createDictionary({ en, es, ... })`, `interpolate` | The typed UI dictionary with `t(lang, key, vars?)`. |
| `LanguageSwitcher`, `switcherHref` | The server-renderable switcher. |

`@kaleidico/sanity-i18n/next/middleware`

| Export | What it is |
| --- | --- |
| `createI18nMiddleware({ languages, defaultId?, exclude? })` | `(request) => NextResponse \| undefined`: rewrite, redirect or pass. Async when `languages` is a function. |

`@kaleidico/sanity-i18n/next/client`

| Export | What it is |
| --- | --- |
| `LanguageSuggestion` | The client-side "Ver en español" strip. |
| `pickSuggestedLanguage(preferred, languages, defaultId)` | Which enabled language the browser's preference list points at. |

`@kaleidico/sanity-i18n/engine` (server only, throws if imported in a browser)

| Export | What it is |
| --- | --- |
| `translateDocument(input)` | Stub. Throws until part 4. |

## Roadmap

- **Part 2, linked translations:** shipped in 0.2.0 (see Content model). The approval workflow that fills `approvedAt` and `approvedBy` and re-locks legal text when the English changes lands with part 4.
- **Part 3, Next.js kit:** shipped in 0.3.0 (see Next.js kit).
- **Part 4, translation engine:** server-side translation with the client's own Anthropic API key, stored encrypted in Site Settings, with glossary, style guide, exact-match checks and a reviewer pass.

## Security

Every release runs `npm run check`, which scans the built `dist/` for anything that looks like an API key or a log line that would print one, and fails the build if it finds any. It also runs automatically before packing. The engine entry refuses to load in a browser so a site's key never reaches the client bundle.

## Development

```bash
npm install
npm run build      # tsup, ESM plus type declarations into dist/
npm test           # builds, then node:test against dist/
npm run check      # security scan of dist/
npm run typecheck  # tsc --noEmit
```

## Versioning and license

Semantic versioning. Breaking changes bump the major version, new parts bump the minor, fixes bump the patch. Until 1.0, minor versions may still change the API where a later part needs it.

MIT, copyright 2026 Kaleidico.
