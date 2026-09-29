# @kaleidico/sanity-i18n

Multi-language content for Sanity and Next.js sites. One package, three parts:

1. **Sanity plugin** (`@kaleidico/sanity-i18n/sanity`): a "Languages" tab in Site Settings with a switch per language, and the schema and Studio tooling for linked translations.
2. **Next.js kit** (`@kaleidico/sanity-i18n/next`): locale routing under a prefix such as `/es`, hreflang and canonical tags, sitemap alternates, a language switcher and a UI dictionary.
3. **Translation engine** (`@kaleidico/sanity-i18n/engine`, server only): translates documents with the client's own Anthropic API key, applying a glossary, a style guide, exact-match checks and a reviewer pass.

Version 0.1.0 ships the package skeleton and the first part of the Sanity plugin: the Languages tab. The Next.js kit and the engine are stubs that throw a clear error when called, so a site can wire the imports today and fill them in as the parts land.

## Requirements

- Node 20 or newer
- `sanity` 5
- `react` 18 or 19
- `next` 15 or 16 (optional, only for the Next.js kit)

## Install

Until the package is on npm, install it from the release tag on GitHub. Each tag carries the built `dist/` folder.

```bash
npm install github:kaleidico/sanity-i18n#v0.1.0
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
    i18nPlugin({ languages }),
  ],
});
```

### Reading the switches from the front end

`readEnabledLanguages()` is a pure function that takes the settings document (or any object with a `languages` field) and returns the enabled languages, default first, in the order you configured them.

```ts
import { readEnabledLanguages } from "@kaleidico/sanity-i18n/next";
import { languages } from "@/sanity/languages";

const settings = await client.fetch(`*[_type == "settings"][0]{ languages }`);
const enabled = readEnabledLanguages(settings, languages);
// [{ id: "en", ... }, { id: "es", ... }] when Spanish is switched on
```

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
| `i18nPlugin({ languages })` | The Studio plugin, named `kaleidico-i18n`. |
| `readEnabledLanguages(settingsDoc, languages, { fieldName? })` | Enabled languages from a settings document, default first. |
| `languageFieldKey(id)` | The field name a language id is stored under (`pt-BR` becomes `pt_BR`). |
| `translationMetaType`, `TRANSLATION_META_TYPE` | The `i18n.translationMeta` document type the plugin registers. |
| `TRANSLATION_STATUSES`, `TranslationStatus` | The four translation states: draft, needs-update, awaiting-approval, approved. |
| `Language`, `LanguagesConfig`, `LanguagesInput` | Types. |

`@kaleidico/sanity-i18n/next`

| Export | What it is |
| --- | --- |
| `defineLanguages`, `readEnabledLanguages`, `languageFieldKey`, types | Re-exported from the shared core, no Sanity import. |
| `defineI18nRoutes(config)` | Stub. Throws until part 3. |

`@kaleidico/sanity-i18n/engine` (server only, throws if imported in a browser)

| Export | What it is |
| --- | --- |
| `translateDocument(input)` | Stub. Throws until part 4. |

## Roadmap

- **Part 2, linked translations:** a document per language linked to the English source, translated slugs, a per-document status (Draft, Needs update, Awaiting approval, Approved) and a legal flag that requires a person's approval.
- **Part 3, Next.js kit:** locale routing under `/es`, hreflang and canonical tags, sitemap alternates, a language switcher and a UI dictionary.
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
