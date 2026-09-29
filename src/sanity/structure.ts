import type { ListItemBuilder, StructureBuilder } from "sanity/structure";
import { DEFAULT_LANGUAGE_ID, defineLanguages, type LanguagesInput } from "../core/languages";
import { localeFilter } from "../core/translations";

/**
 * GROQ clause for a desk list that should show one language only. Use it in
 * the list's filter together with the type clause, because `.filter()` on a
 * document type list replaces the default `_type == $type` filter:
 *
 * `S.documentTypeList("page").filter(\`_type == $type && ${languageFilter("en")}\`)`
 *
 * For the default language the clause also matches documents with no
 * `language` field, so existing content stays listed.
 */
export function languageFilter(languageId: string, defaultId: string = DEFAULT_LANGUAGE_ID): string {
  return localeFilter(languageId, defaultId);
}

export interface TranslationsStructureOptions {
  /** The languages the site can offer. Every language but the default gets a list. */
  languages: LanguagesInput;
  /** The document types wrapped with `translatable()`, in the order to list them. */
  types: readonly string[];
  /** Titles per type for the list items. Defaults to the type name. */
  titles?: Readonly<Record<string, string>>;
  /** Title of the section. Defaults to "Translations". */
  title?: string;
}

/**
 * A desk section "Translations" with one child per non-default language,
 * each listing the translatable types filtered to that language. Every
 * translation's preview subtitle starts with its status (see `translatable()`),
 * so the lists read as a review queue.
 *
 * Add it to the items of the root list:
 *
 * `S.list().title("Content").items([ ..., translationsStructure(S, { languages, types }) ])`
 */
export function translationsStructure(S: StructureBuilder, options: TranslationsStructureOptions): ListItemBuilder {
  const config = defineLanguages(options.languages);
  const defaultId = config.defaultLanguage.id;
  const title = options.title ?? "Translations";
  const others = config.languages.filter((l) => l.id !== defaultId);

  const typeTitle = (type: string) => options.titles?.[type] ?? type;

  return S.listItem()
    .id("i18n-translations")
    .title(title)
    .child(
      S.list()
        .id("i18n-translations-list")
        .title(title)
        .items(
          others.map((lang) =>
            S.listItem()
              .id(`i18n-translations-${lang.id}`)
              .title(lang.nativeTitle ? `${lang.title} (${lang.nativeTitle})` : lang.title)
              .child(
                S.list()
                  .id(`i18n-translations-${lang.id}-types`)
                  .title(`${lang.title} translations`)
                  .items(
                    options.types.map((type) =>
                      S.listItem()
                        .id(`i18n-translations-${lang.id}-${type}`)
                        .title(typeTitle(type))
                        .schemaType(type)
                        .child(
                          S.documentTypeList(type)
                            .title(`${typeTitle(type)} (${lang.title})`)
                            .filter(`_type == $type && ${localeFilter(lang.id, defaultId)}`)
                            .params({ type }),
                        ),
                    ),
                  ),
              ),
          ),
        ),
    );
}
