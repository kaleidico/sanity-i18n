# @kaleidico/sanity-i18n

Multi-language content for Sanity and Next.js sites. One package, three parts:

1. **Sanity plugin** (`@kaleidico/sanity-i18n/sanity`): a "Languages" tab in Site Settings with a switch per language, and the schema and Studio tooling for linked translations.
2. **Next.js kit** (`@kaleidico/sanity-i18n/next`): locale routing under a prefix such as `/es`, hreflang and canonical tags, sitemap alternates, a language switcher and a UI dictionary.
3. **Translation engine** (`@kaleidico/sanity-i18n/engine`, server only): translates documents with the client's own Anthropic API key, applying a glossary, a style guide, exact-match checks and a reviewer pass, and publishes under a review rule: marketing copy goes live when both checks pass, legal text waits for a named approver.

Version 0.5.0 ships all three: the Sanity plugin (the Languages tab and the document-level content model: a document per language, linked to the source, with shared fields, per-language slugs, a status per document and legal marks), the Next.js kit (locale routing, hreflang and canonical tags, Open Graph locales, sitemap alternates, the language switcher, the suggestion strip and the UI dictionary) and the translation engine (whole-document translation, glossary and style guide, two checks, change tracking, a cost estimate, and the review and approval workflow: a legal approval registry, the approval queue, the publish rule and re-locking when the English changes).

## Requirements

- Node 20 or newer
- `sanity` 5 (with `@sanity/ui` and `@sanity/icons`, which it already brings)
- `react` 18 or 19
- `next` 15 or 16 (optional, only for the Next.js kit)

## Install

Until the package is on npm, install it from the release tag on GitHub. Each tag carries the built `dist/` folder.

```bash
npm install github:kaleidico/sanity-i18n#v0.5.0
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
    structureTool({ structure: deskStructure }),
    // ...your other plugins
    i18nPlugin({ languages, translatableTypes: ["page", "blogPost"] }),
  ],
});
```

`translatableTypes` lists the document types you wrap in the next section. It can start empty and grow as you wrap types.

List `i18nPlugin()` after `structureTool()`. Sanity hands each plugin the actions the plugins before it registered, and the translation engine wraps the structure tool's Publish action; listed first, it would find no Publish action to wrap and its own "Translate to ..." action would become the main button.

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
- `i18n` ("Translation", collapsible, hidden on default-language documents): `source` (weak reference to the source document), `status` (`draft`, `needs_update`, `awaiting_approval`, `approved`), `sourceHash` (hidden), `translatedAt`, `approvedAt`, `approvedBy` (read only, filled by the engine or the approval workflow), and the hidden `sourceHashes`, `report`, `legal` (how the legal text on the translation stands), `staleSince` (set when the English moved) and `publishedAt`.

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

The mark is `options.i18n.legal = true`, and the description gains "(legal text: needs approval before it goes live in another language)". `isLegal(fieldOrType)` reads it back; `collectLegalPaths(documentType, { types })` lists every legal path in a document type (`footerDisclaimer`, `legalLinks[].label`, `fields[consentField].consentText`, `blocks[disclosureBlock]`, `blocks[formBlock].fields[consentField].consentText`), following arrays to any depth, the same as the engine's field manifest. What happens to legal text after translation is under "Review and approval".

### The metadata document

`i18n.translationMeta` links one source document to every language it exists in: `sourceType` and `translations[]`, one entry per language (`_key` is the language id) with a weak reference to that language's document and, when the English moved after that translation was made, `staleSince` (also set at the top level). Its id is deterministic, `translationMetaId(sourceId)` = `i18n-meta-<sourceId>`, so there is never more than one per source (no period in the id: Sanity hides dotted ids from public reads, and the site reads without a token). Both directions resolve in GROQ: a translation's `i18n.source` points at the source, the metadata document lists all languages. The plugin registers the type once `translatableTypes` is set; it is hidden from search and should not be listed in the desk.

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

## Translation engine

The engine translates a whole document at a time, in context, with the site owner's own Anthropic API key. It runs on the server only. Every translation is saved as a draft with a report of what was done and what both checks found; a translation that passes both checks and has no legal text waiting is published on its own when automatic publishing is on (see "Review and approval").

### Set up

**1. Generate the site's key pair.** The API key is stored encrypted with a key pair that belongs to the site. Run once per site:

```bash
npx sanity-i18n-generate-keys
```

It prints two lines. Add both to `.env.local` and to the hosting environment, then redeploy:

| Variable | Where it is read | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_I18N_PUBLIC_KEY` | the Studio (browser) and the server | The public key. It can only encrypt, so it is safe in the browser. |
| `I18N_PRIVATE_KEY` | the server only | The private key. Whoever has it can read the saved API key, so treat it like a password. Never give it a `NEXT_PUBLIC_` name. |

Until both are set, the key field in Site Settings says "Translation key storage is not configured on this server yet" instead of offering an input, and a translation job fails with the same words. Nothing else is affected.

**2. Add the settings fields.** In the Site Settings type, in the Languages group:

```ts
import { apiKeyField, engineField, glossaryField, styleGuideField, ENGINE_SETTINGS_FIELDS } from "@kaleidico/sanity-i18n/sanity";

fields: [
  // ...
  languagesField({ languages }),
  glossaryField(),
  styleGuideField(),
  engineField(),
  apiKeyField({ publicKey: process.env.NEXT_PUBLIC_I18N_PUBLIC_KEY }),
],
// and, when Site Settings itself is translatable, in its sharedFields:
sharedFields: [...yourSharedFields, ...ENGINE_SETTINGS_FIELDS],
```

- `glossaryField()`: a do-not-translate list and fixed term pairs with a note each.
- `styleGuideField()`: market (default `es-US`), register (`usted` or `tu`), audience and notes.
- `engineField()`: the translator model and the reviewer model, chosen from the Claude models in the package's rate table, and the "Publish marketing pages automatically" switch (on by default).
- `legalApproversField()`: the emails of the people who may approve legal text (see "Review and approval").
- `apiKeyField()`: the Anthropic API key. It stores nothing in Site Settings. What is typed is encrypted in the browser with the public key (RSA-OAEP, 4096 bits, SHA-256) and only the ciphertext, the last four characters and a timestamp are written, to a private document. After that the field shows "Key saved, ending in ...abcd" with Replace and Remove. The key is never displayed, returned or logged again.

**3. Mount the route.** In a Next.js app:

```ts
// src/app/api/i18n/translate/route.ts
import { createTranslateRoute } from "@kaleidico/sanity-i18n/engine/route";
import { languages } from "@/i18n/languages";

export const maxDuration = 300;

export const { POST } = createTranslateRoute({
  sanity: {
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
    token: process.env.SANITY_API_TOKEN!, // read and write
  },
  languages,
});
```

**4. The Studio plugin does the rest.** With `translatableTypes` set, `i18nPlugin()` (listed after `structureTool()`) adds a "Translate to <Language>" action to default-language documents, marks translations stale when the English is published, applies the publish rule to translations, and adds the "Translations" and "Legal approvals" tools. Pass `engine: { endpoint, approveEndpoint }` when the routes are mounted somewhere else, or `engine: false` to leave all of them out.

**5. Mark what is not copy.** The engine decides what is text from the schema, not from the value: `string` and `text` fields are text; fixed choices (`options.list`), URLs, emails, dates, numbers, booleans, references, slugs and files are not; images contribute only their own text fields such as `alt` and `caption`; plain strings named like plumbing (`href`, `ctaUrl`, `gtmId`, `icon`) are skipped. For a plain string the engine cannot tell apart from copy, such as a form field's machine `name`, wrap the field in `noTranslate()`. `options: { i18n: { translate: true } }` forces a field to be translated.

### Who may run a translation

The right to start a translation is the right to write to the dataset, and nothing else. The Studio creates a private job document with the editor's own session and then sends the server the job's id. The route accepts a job id and nothing more: it loads the job with its own token, refuses anything that is not a pending job, and claims it with a revision check so a job runs once. A caller who cannot write to the dataset cannot create a job, so has nothing to send.

The engine's own documents all have an id with a period in it (`i18n.secrets`, `i18n.manifest`, `i18n.job.<uuid>`). Sanity never returns such a document to a request without a token, so they are private even on a public dataset.

### How a run works

1. The Studio stores the field manifest (which fields are text, which are legal, which are shared) in `i18n.manifest` when its schema changed, so the server works from the schema the editor sees.
2. The server loads the published source document, the glossary, the style guide and the models from Site Settings, and decrypts the API key in memory.
3. It builds the payload: the document's own structure, reduced to its text. Objects keep `_key` and `_type`, Portable Text blocks keep their spans, marks and mark definitions, and shared fields, references, images, slugs, numbers and fixed choices are left out.
4. The whole document goes to the translator model in one request, with a mortgage-aware brief, the style guide, the glossary and the hard rules (numbers, rates, NMLS numbers, phones, emails, URLs, placeholders, pipes and line breaks stay exactly as they are; no sentence added or dropped; legal text translated faithfully). A document too large for one request is split along its top-level blocks, and each request carries the document's outline and the text on either side.
5. The answer must have exactly the same structure: same keys, same `_key`s, same marks and mark definitions, same list lengths, only text changed. If not, the model is asked once more with the differences listed. If it still differs, the run fails and nothing is saved.
6. Check 1 and check 2 run (below).
7. The legal text on the document is checked against the approval registry (below): approved wording is reused, new wording is queued.
8. The translation is written as a draft, `drafts.<sourceId>-<language>` (`drafts.settings-es`, `drafts.homepage-es` for singletons), with `language`, `i18n.source`, its status (`draft` when held, `awaiting_approval` with legal text waiting, else `approved`), `i18n.translatedAt`, a proposed translated slug, the per-unit source hashes in `i18n.sourceHashes`, the legal record in `i18n.legal` and the report in `i18n.report`. The metadata document `i18n-meta-<sourceId>` is created or updated. The job gets the same report.
9. An `approved` translation is published on the spot when "Publish marketing pages automatically" is on.

### The two checks

**Check 1, exact match.** A pure function, no model involved. For every pair of source and translated strings it extracts and compares numbers, percentages, dollar amounts, NMLS numbers, phone numbers, email addresses, URLs, link targets, pipe characters and placeholder tokens. A value that differs, is missing or was added is a failure: the document is held, nothing is saved, and the report lists the path with the English and the translated value. A value that is the same but written differently (1,234.50 against 1.234,50, a phone number with other punctuation, values in a different order) is a warning, because the site keeps the US format.

**Check 2, the reviewer.** A second, separate model call reads the source and the translation side by side and returns issues as `{ path, severity: high | medium | low, category: meaning | omission | addition | tone | terminology | legal, note }`. A high severity issue holds the document; the draft is still saved so a person can correct it, and `i18n.report.held` is true. Every issue is recorded. An answer that cannot be read also holds the document.

### Change tracking

The source is cut into units: a string field, a list of strings, or one Portable Text block. Each unit's SHA-256 is stored on the translation, plus one hash for everything that is not text (block order, images, links, fixed choices).

- `diffSource(sourceDoc, translationDoc, manifest)` returns `{ changed, added, removed, structureChanged, upToDate }`.
- Publishing a default-language document compares its translations with their stored hashes and marks the ones that differ on their draft: `needs_update`, or `awaiting_approval` when legal wording changed (see "Review and approval"). The published translation stays as it is. Translations made by hand have no hashes and are left alone.
- A job with `mode: "changes"` sends only the changed and new units to the model. The whole source document goes along for context, and the current translation of everything else is supplied as a fixed reference so the page still reads as one piece. The result is merged into a fresh copy of the source: changed units are new, the rest keep the existing translation (hand edits included), and whatever is not text follows the English. When only non-text parts changed, no model is called at all.

### Costs

Anthropic bills the account that owns the API key. The package only estimates and records.

- The rate table is `MODELS` in `src/core/pricing.ts`, dated by `RATES_AS_OF` (currently 2026-09-25): Claude Opus 5.5 $4 in and $20 out per million tokens, Claude Sonnet 5.5 $2 and $10, Claude Fable 5.1 $10 and $50, Claude Haiku 4.5 $1 and $5. To update it, change the rows and the date together.
- Before a bulk run the Translations tool shows tokens and dollars. `estimateCost({ documents, language, models, manifest })` counts input tokens with Anthropic's token counting endpoint when a key is saved (every document up to 20, a sample of 20 scaled to the rest above that) and falls back to 3 characters per token when there is none. Output is estimated: 1.6 times the payload's tokens for the translation, which covers the longer Spanish and the model's reasoning, and 1,500 tokens per reviewer answer; the reviewer's input is 2.3 times the items. These constants are next to the rate table.
- Every run records its real usage and cost in the report, per model.

### Reliability

Requests are streamed. Rate limits (429), overload (529), server errors and dropped connections are retried with exponential backoff, honouring `retry-after`; at most two requests run at once within a run; each request and each job has a time limit, and a job that runs out of time is closed as failed rather than left running. Every failure is stored on the job in plain words: no key saved, key storage not configured, key rejected, billing problem, rate limited, service unavailable, model not available, document too large, structure mismatch, check failed, request declined.

Where the model supports it, a request that Anthropic's safety systems decline is re-run on Anthropic's recommended substitute model within the same call, and the report's `servedBy` names the model that answered. A request that is declined outright fails the job with nothing saved.

## Review and approval

Review model: marketing copy may go live on its own once the two checks pass; legal and disclosure text needs a person's approval before it appears in another language, once per wording, and locks again when the English changes.

### The rule

| Situation | `i18n.status` on the draft | Published? |
| --- | --- | --- |
| Check 1 (exact match) fails | nothing is saved | no |
| The reviewer raises a high severity issue | `draft`, `report.held` | no |
| Both checks pass, legal text waiting | `awaiting_approval` | no |
| Both checks pass, no legal text waiting | `approved` | yes, when "Publish marketing pages automatically" is on (the default); otherwise it waits for Publish |
| An approver clears the last waiting unit | `approved` | yes, same switch |
| An approver sends a unit back | unchanged (`awaiting_approval`) | no |
| The English legal wording changes | draft `awaiting_approval`, `staleSince` set; the published translation is untouched | the live page keeps its last approved wording |
| Other English text changes | draft `needs_update`, `staleSince` set; the published translation is untouched | the live page is unchanged |

A translation can only be published, by the engine or by a person, when its status is `approved`, it is not held, no legal unit on it is waiting, and every legal path carries the approved wording word for word. `publishTranslation(sanity, draftId)` applies the rule on the server and refuses with a plain reason; the plugin wraps the Studio's Publish action on translations (`publishTranslationAction`) so the button is disabled with the same reason. Publishing is Sanity's own: the draft replaces the published document and is removed. A hand edit to approved legal text needs a new approval before the page can be published again.

The site reads only `i18n.status == "approved"` translations (`localeFilter` plus that clause, as in the Next.js kit), so a page with legal text waiting is held, never shown with English in its place.

### Legal units and the registry

A legal unit is one legal path's English text (a `legalText()` field, or anything inside a `legalBlock()`), identified by the SHA-256 of the text with whitespace collapsed. Its registry entry is the document `i18n.legalApproval` with id `i18n-legal-<language>-<first 12 hex of the hash>` (`legalApprovalId()`), carrying the English, the proposed or approved translation, its status (`pending`, `approved`, `sent_back`, `superseded`), who decided and when, the comment, every place it occurs (`occurrences[]`: document and path) and every decision ever made on it (`history[]`). The id has no period, so the site can read approvals without a token; the plugin registers the type and `I18N_HIDDEN_TYPES` keeps it out of desk lists.

One approval covers every occurrence of the same English in the same language. After a run the engine walks the document's legal units: an approved entry overwrites the translation with the approved wording, a pending entry overwrites it with the pending proposal (so every occurrence shows the approver the same words), a missing entry is created as pending with the run's translation as the proposal, and a sent back or superseded entry becomes pending again with the new proposal. The draft records the outcome in `i18n.legal` (`pending`, `approved`, `paths[]` with each unit's id and state). A disclaimer that appears on six pages is approved once and the other five follow.

### The approval queue

The "Legal approvals" Studio tool (`legalApprovalsTool`, registered by the plugin next to Translations) lists every pending unit per language, oldest first, with the English and the translation side by side, the documents and paths it appears in (as links) and its history. Two buttons: **Approve**, and **Send back** with a required comment.

- Approve records the decision, writes the approved wording into every occurrence's draft, recounts each draft's legal record, marks a draft with nothing left waiting `approved` (with `approvedAt` and `approvedBy`), and publishes it when automatic publishing is on.
- Send back records the comment and marks the unit `sent_back`; the drafts stay held. A sent back unit stays in the queue with the comment. An editor fixes the wording in the draft and presses **Resubmit with the draft's current wording** (or runs Translate again), which proposes it afresh.
- The **Log** tab lists every decision ever made: when, who, language, the English, the outcome and the comment.

### Re-locking when the English changes

When a default-language document is published, the plugin compares it with each translation's stored hashes (`planStaleTranslations`). For every legal unit whose English changed or is new, the registry entry for the old wording is marked `superseded` (with `supersededBy`, the new hash, and a history line), and the translation's draft is set to `awaiting_approval` with `i18n.staleSince`; a draft is created from the published translation when there is none. The published translation is never touched, so the live page keeps its last approved wording until the new one is translated (Translate, "Only what changed") and approved. A change to other text marks the draft `needs_update` the same way. The metadata document records `staleSince` too. The Translations tool counts stale drafts as work to do.

### Who may approve

Sanity's custom roles are not available on every plan, so the intended setup is Sanity's own **Editor** role plus a list of approvers:

1. Add `legalApproversField()` to Site Settings under the Languages group (it is in `ENGINE_SETTINGS_FIELDS`, so a translatable settings type shares it across languages).
2. Type the approvers' email addresses, exactly as they sign in to the Studio.
3. Mount the approval route next to the translation route:

```ts
// src/app/api/i18n/approve/route.ts
import { createApprovalRoute } from "@kaleidico/sanity-i18n/engine/route";
import { languages } from "@/i18n/languages";

export const { POST } = createApprovalRoute({
  sanity: { projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!, dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!, token: process.env.SANITY_API_TOKEN! },
  languages,
});
```

Everyone with the Editor role can see the queue and the log; the buttons appear only for a listed approver. A decision travels the same way as a translation: the Studio creates a private job (`i18n.job.<uuid>`, `kind: "approve"` or `"send_back"`, `unitId`, `comment`, and `approver`, the signed-in user's id, name and email) and sends the route its id. The route loads the job with the server token, checks that `approver.email` is on the list, checks with Sanity's history API that the job was created by the user whose id it names, and only then performs the writes with the server token and marks the job done, or refuses with a plain reason (`not_an_approver`, `approver_unverified`, `comment_required`, `unit_not_pending`). The translation route refuses approval jobs and the approval route refuses translation jobs (`wrong_route`).

What this does and does not guarantee: an editor who is not on the list cannot approve through the Studio, and a job that names an approver but was created by someone else is refused. The list is a workflow control on top of Sanity's Editor role, not a substitute for it: anyone who can write to the dataset directly with a token has the access the role gives them, whatever the list says. Keep tokens with write access with the people who could approve anyway.

To add an approver: open Site Settings, Languages, and add the email to "Legal approvers". To remove one, delete it. No redeploy is needed.

## What switching a language on does, and does not do

Switching a language on in Site Settings **publishes nothing by itself**. It tells the site that the language exists, so the rest of this package can offer it: a translation can be started for a page, the routing can reserve the `/es` prefix, and the switcher can list it. A page in that language only appears on the live site once it has been translated and its translation is approved, which the engine does on its own for a page without legal text when automatic publishing is on.

Switching a language off hides it everywhere. Existing translations are kept, not deleted, so switching it back on restores them.

The default language cannot be switched off. Every translation is made from it.

## API

`@kaleidico/sanity-i18n/sanity`

| Export | What it is |
| --- | --- |
| `defineLanguages(languages)` | Validates a list of languages and returns `{ languages, defaultLanguage }`, default first. |
| `languagesField({ languages, group?, fieldName? })` | The `languages` object field for Site Settings. |
| `LANGUAGES_GROUP` | `{ name: "languages", title: "Languages" }` for the settings groups. |
| `i18nPlugin({ languages, translatableTypes?, labels?, titles?, engine? })` | The Studio plugin, named `kaleidico-i18n`: registers the metadata type, the language and status badge and, unless `engine: false`, the translate action, the stale check on publish and the Translations tool. |
| `translatable(documentType, { languages?, sharedFields?, slugField?, hideLanguageOnDefault?, labels? })` | Wraps a document type for document-level translations. |
| `getSharedFields(typeDef)`, `getTranslatableMarker(typeDef)`, `isTranslatable(typeDef)` | Read back what `translatable()` recorded on a definition. |
| `isTranslationDocument(doc, defaultId?)` | True when a document's language is set and is not the default. |
| `legalText(field)`, `legalBlock(type)`, `isLegal(x)`, `collectLegalPaths(type, { types? })`, `LEGAL_NOTE` | Legal marking. Every legal unit of a translated document goes through the approval registry. |
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

`@kaleidico/sanity-i18n/sanity`, translation engine

| Export | What it is |
| --- | --- |
| `glossaryField()`, `styleGuideField()`, `engineField()`, `apiKeyField({ publicKey })`, `legalApproversField()` | The Site Settings fields. Options: `name`, `group`. `ENGINE_SETTINGS_FIELDS` lists their names for `sharedFields`. |
| `ApiKeyInput`, `KEY_STORAGE_NOT_CONFIGURED` | The key input component and the message it shows without a public key. |
| `translateAction(options)` | The "Translate to <Language>" document action. Registered by the plugin. |
| `publishWithStaleCheck(publishAction, { languages })` | Wraps the publish action on default-language documents to mark stale translations and re-lock changed legal text. Registered by the plugin. |
| `publishTranslationAction(publishAction, { languages, labels? })` | Wraps the publish action on translations with the publish rule. Registered by the plugin. |
| `translationsTool(options)` | The "Translations" Studio tool. Registered by the plugin. |
| `legalApprovalsTool(options)`, `resubmitLegalUnit(client, entry, by)`, `buildLog(entries)`, `LEGAL_APPROVER_NOTICE` | The "Legal approvals" Studio tool and its helpers. Registered by the plugin. |
| `legalApprovalType()`, `legalRecordField()`, `staleSinceField()` | The registry document type and the two hidden fields `translatable()` adds. |
| `LEGAL_APPROVAL_TYPE`, `legalApprovalId(language, hash)`, `legalSourceHash(text)`, `normaliseLegalText(text)`, `unitText(value)`, `legalUnitsOf(doc, manifest)`, `planLegalRegistry(input)`, `statusAfterRun(held, legal)`, `checkTranslationForPublish(doc, manifest, entries)`, `planStaleTranslations(input)`, `applyLegalValue(doc, segments, value)`, `parseLegalValue(entry)` | The registry model and the pure functions behind the queue, the publish rule and the stale check. The same functions are exported from `/engine`. |
| `readLegalApprovers(settings)`, `isLegalApprover(email, list)`, `LEGAL_APPROVERS_FIELD`, `useLegalApprovers(client, options)` | The approver list. |
| `noTranslate(field)` | Marks a field as never translated. |
| `buildFieldManifest(schema, types)`, `ensureManifest(client, schema, options)` | Build the field manifest from a compiled schema, and store it for the server. |
| `diffSource`, `extractUnits`, `sourceHashes` | Change tracking, the same functions the server uses. |
| `I18N_HIDDEN_TYPES` | The package's bookkeeping document types, to leave out of desk lists. |
| `MODELS`, `RATES_AS_OF` | The model and rate table. |

`@kaleidico/sanity-i18n/engine/route` (server only)

| Export | What it is |
| --- | --- |
| `createTranslateRoute({ sanity, languages, ... })` | Returns `{ POST }` for `translate` and `estimate` jobs. Options: `privateKey`, `publicKey`, `settings`, `manifest`, `requireEnabledLanguage`, `autoPublish`, `effort`, `maxCharsPerRequest`, `concurrency`, `requestTimeoutMs`, `deadlineMs`, `retry`, and `anthropic` to pass a client factory in tests. |
| `createApprovalRoute({ sanity, languages, ... })` | Returns `{ POST }` for `approve` and `send_back` jobs, with the same options plus `verifyJobAuthor` (default true). |

`@kaleidico/sanity-i18n/engine` (server only, throws if imported in a browser)

| Export | What it is |
| --- | --- |
| `runJob(config, jobId, allowedKinds?)` | What the routes do: claim a pending job, run it, write the result. |
| `publishTranslation(sanity, draftId, { manifest? })` | Publish a translation draft under the rule, or refuse with a plain reason. |
| `approveUnit(input)`, `sendBackUnit(input)` | The two decisions, as the approval route performs them. |
| `readLegalApprovers`, `isLegalApprover`, and the registry functions listed under `/sanity` | Shared with the Studio. |
| `translateDocument(input)` | One document: choose the units, translate, run both checks, build the draft. No dataset access. |
| `estimateCost({ documents, language, models, manifest, countTokens? })` | The cost estimate. |
| `extractUnits`, `buildPayload`, `validateStructure`, `applyUnits` | The payload: build it, check an answer against it, write it back. |
| `checkExactMatch(pairs)`, `comparePair`, `extractTokens`, `readNumber` | Check 1. |
| `reviewTranslation(input)`, `parseReviewerResponse(text)` | Check 2. |
| `sourceHashes`, `diffSource`, `structureHash` | Change tracking. |
| `decryptSecret`, `loadApiKey`, `encryptSecret`, `publicKeyFingerprint` | Key storage. |
| `callModel`, `countTokens`, `createAnthropicClient`, `withRetry`, `createLimiter`, `toEngineError`, `EngineError` | The Anthropic call, retries and errors in plain words. |
| `MODELS`, `RATES_AS_OF`, `costOf`, `modelInfo` | Models and rates. |
| `createSanityHttp({ projectId, dataset, token })` | The small `fetch`-based Sanity client the engine uses: query, read, mutate, and `documentAuthor(id)` from the history API. |

## Roadmap

- **Part 2, linked translations:** shipped in 0.2.0 (see Content model).
- **Part 3, Next.js kit:** shipped in 0.3.0 (see Next.js kit).
- **Part 4, translation engine:** shipped in 0.4.0 (see Translation engine).
- **Part 5, review workflow:** shipped in 0.5.0 (see Review and approval).

## Security

Every release runs `npm run check`, which scans the built `dist/` for anything that looks like an API key, for a log line that would print one, for any console call near code that handles or decrypts the key, and for any console call at all in the engine entries. It fails the build if it finds one, and it runs automatically before packing.

The engine entries refuse to load in a browser, and the Anthropic SDK is a dependency of those two entries only; the tests check that it is not imported by the Studio or the Next.js bundles. The API key is encrypted in the browser and can only be read with the private key in the server's environment. The engine holds the plaintext in memory for the length of a job and never logs it, the ciphertext, a prompt or a document's content.

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
