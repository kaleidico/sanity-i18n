import type { DocumentBadgeComponent, DocumentBadgeDescription } from "sanity";
import { DEFAULT_LANGUAGE_ID } from "../core/languages";
import {
  I18N_FIELD,
  LANGUAGE_FIELD,
  translationStatusLabel,
  type TranslationLabels,
  type TranslationStatus,
} from "../core/translations";

export interface TranslationBadgeOptions {
  /** The default language id. Defaults to `en`. */
  defaultId?: string;
  /** Host overrides for the status titles. */
  labels?: TranslationLabels;
}

/**
 * Badge colour per status. Sanity offers four colours; the draft state uses
 * none so it reads as the neutral grey badge.
 */
export const TRANSLATION_BADGE_COLORS: Record<TranslationStatus, DocumentBadgeDescription["color"] | undefined> = {
  draft: undefined,
  needs_update: "danger",
  awaiting_approval: "warning",
  approved: "success",
};

/**
 * A document badge showing the language in upper case plus, on a
 * translation, the status label: `ES · Awaiting approval`. Default-language
 * documents show just the language. Documents without a `language` field
 * (created before the package was installed) show nothing.
 */
export function translationBadge(options: TranslationBadgeOptions = {}): DocumentBadgeComponent {
  const defaultId = options.defaultId ?? DEFAULT_LANGUAGE_ID;
  const labels = options.labels;

  const TranslationBadge: DocumentBadgeComponent = (props) => {
    const doc = (props.draft ?? props.published) as Record<string, unknown> | null | undefined;
    const language = doc?.[LANGUAGE_FIELD];
    if (typeof language !== "string" || language === "") return null;

    if (language === defaultId) {
      return { label: language.toUpperCase(), title: "Source language" };
    }

    const i18n = doc?.[I18N_FIELD] as { status?: string } | undefined;
    const status = (i18n?.status ?? "draft") as TranslationStatus;
    const statusLabel = translationStatusLabel(status, labels);
    return {
      label: `${language.toUpperCase()} · ${statusLabel}`,
      title: `Translation status: ${statusLabel}`,
      color: TRANSLATION_BADGE_COLORS[status] ?? undefined,
    };
  };

  return TranslationBadge;
}
