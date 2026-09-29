/**
 * The language switcher. A plain server-renderable `nav` with one link per
 * language other than the current one, each carrying `lang` and `hrefLang`
 * and showing the language's own name (Español, not Spanish). A link goes to
 * the same page in that language when a translation is live, else to that
 * language's home page. Renders nothing when there is only one language.
 *
 * Styling is the host's: pass `className` for the nav and `linkClassName`
 * for each link, or target `[data-i18n-switcher]` and its `a` elements.
 */
import type { ReactNode } from "react";
import type { Language } from "../core/languages";

export interface LanguageSwitcherProps {
  /** The language of the page being rendered. */
  current: string;
  /** The languages switched on, in display order. */
  languages: readonly Language[];
  /** The same page in other languages, keyed by language id: `{ es: "/es/sobre-nosotros" }`. */
  links?: Record<string, string | null | undefined>;
  /** Each language's home page, used when `links` has no entry for it: `{ en: "/", es: "/es" }`. */
  homeHrefs: Record<string, string>;
  /** `nav` label in the current language, e.g. "Language" or "Idioma". */
  labels: { ariaLabel: string };
  /** Also list the current language, as text with `aria-current`. Off by default. */
  showCurrent?: boolean;
  className?: string;
  listClassName?: string;
  itemClassName?: string;
  linkClassName?: string;
  currentClassName?: string;
  /** Rendered before each language name, for an icon or a flag glyph. */
  prefix?: ReactNode;
}

export function switcherHref(
  id: string,
  links: LanguageSwitcherProps["links"],
  homeHrefs: Record<string, string>,
): string | undefined {
  const link = links?.[id];
  if (typeof link === "string" && link !== "") return link;
  return homeHrefs[id];
}

export function LanguageSwitcher(props: LanguageSwitcherProps) {
  const {
    current,
    languages,
    links,
    homeHrefs,
    labels,
    showCurrent = false,
    className,
    listClassName,
    itemClassName,
    linkClassName,
    currentClassName,
    prefix,
  } = props;

  const items = languages
    .filter((l) => showCurrent || l.id !== current)
    .map((l) => ({ language: l, href: l.id === current ? undefined : switcherHref(l.id, links, homeHrefs) }))
    .filter((item) => item.language.id === current || item.href);

  if (languages.length < 2 || items.length === 0) return null;

  return (
    <nav aria-label={labels.ariaLabel} data-i18n-switcher className={className}>
      <ul className={listClassName}>
        {items.map(({ language, href }) => {
          const name = language.nativeTitle ?? language.title;
          const isCurrent = language.id === current;
          return (
            <li key={language.id} className={itemClassName}>
              {isCurrent || !href ? (
                <span lang={language.id} aria-current="true" className={currentClassName}>
                  {prefix}
                  {name}
                </span>
              ) : (
                <a href={href} lang={language.id} hrefLang={language.id} className={linkClassName}>
                  {prefix}
                  {name}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
