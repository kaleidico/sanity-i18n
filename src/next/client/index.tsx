"use client";
/**
 * @kaleidico/sanity-i18n/next/client
 *
 * The one client component in the kit: a small, dismissible strip that
 * suggests the visitor's own language when the browser prefers a language the
 * site has and the page is in the default language. It never redirects.
 */
import { useEffect, useState } from "react";
import type { Language } from "../../core/languages";

export interface LanguageSuggestionLabels {
  /** The message, in the suggested language: "Este sitio está disponible en español." */
  text: string;
  /** The link text, in the suggested language: "Ver en español". */
  link: string;
  /** The close button's accessible name, in the suggested language: "Cerrar". */
  dismiss: string;
}

export interface LanguageSuggestionProps {
  /** The language of the page being rendered. */
  current: string;
  /** The language served at the root. The strip only shows on pages in this language. */
  defaultId: string;
  /** The languages switched on. Only non-default ones can be suggested. */
  languages: readonly Language[];
  /** Where each language's version of this page is (or its home page): `{ es: "/es/sobre-nosotros" }`. */
  links: Record<string, string | null | undefined>;
  /** Labels per suggested language. A language without labels is never suggested. */
  labels: Record<string, LanguageSuggestionLabels>;
  /** Days a dismissal is remembered. Defaults to 30. */
  days?: number;
  /** `localStorage` key. Defaults to `i18n-suggestion-dismissed`. */
  storageKey?: string;
  className?: string;
  textClassName?: string;
  linkClassName?: string;
  dismissClassName?: string;
  /** Rendered inside the close button. Defaults to a multiplication sign. */
  dismissIcon?: React.ReactNode;
}

const DEFAULT_KEY = "i18n-suggestion-dismissed";
const DAY = 24 * 60 * 60 * 1000;

/** The first enabled non-default language the browser prefers, matched on the primary subtag. */
export function pickSuggestedLanguage(
  preferred: readonly string[],
  languages: readonly Language[],
  defaultId: string,
): Language | undefined {
  const candidates = languages.filter((l) => l.id !== defaultId);
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split("-")[0];
    const exact = candidates.find((l) => l.id.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const byPrimary = candidates.find((l) => l.id.toLowerCase().split("-")[0] === primary);
    if (byPrimary) return byPrimary;
    // The visitor's first preference is a language the site has only as the
    // default: no suggestion, whatever comes later in the list.
    if (primary === defaultId.toLowerCase().split("-")[0]) return undefined;
  }
  return undefined;
}

function readDismissed(key: string, days: number): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < days * DAY;
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage may be unavailable; the strip simply shows again next visit.
  }
}

export function LanguageSuggestion(props: LanguageSuggestionProps) {
  const { current, defaultId, languages, links, labels, days = 30, storageKey = DEFAULT_KEY } = props;
  const [suggested, setSuggested] = useState<Language | null>(null);

  useEffect(() => {
    if (current !== defaultId) return;
    if (readDismissed(storageKey, days)) return;
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
    const pick = pickSuggestedLanguage(preferred, languages, defaultId);
    if (!pick || !labels[pick.id] || !links[pick.id]) return;
    setSuggested(pick);
  }, [current, defaultId, languages, links, labels, days, storageKey]);

  if (!suggested) return null;
  const text = labels[suggested.id];
  const href = links[suggested.id] as string;

  const dismiss = () => {
    writeDismissed(storageKey);
    setSuggested(null);
  };

  return (
    <div role="region" aria-label={text.link} lang={suggested.id} data-i18n-suggestion className={props.className}>
      <p className={props.textClassName}>
        {text.text}{" "}
        <a href={href} hrefLang={suggested.id} lang={suggested.id} className={props.linkClassName}>
          {text.link}
        </a>
      </p>
      <button type="button" onClick={dismiss} aria-label={text.dismiss} className={props.dismissClassName}>
        {props.dismissIcon ?? "×"}
      </button>
    </div>
  );
}
