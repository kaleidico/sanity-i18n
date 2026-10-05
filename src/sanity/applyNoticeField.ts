import { defineField } from "sanity";
import type { FieldDefinition } from "sanity";
import { APPLY_NOTICE_FIELD } from "../core/applyNotice";
import { LANGUAGES_GROUP } from "./languagesField";
import { legalText, noTranslate } from "./legal";

export interface ApplyNoticeFieldOptions {
  /** Name of the field. Defaults to `i18nApplyNotice`. */
  name?: string;
  /** Field group. Defaults to `languages`. Pass `false` to leave the field ungrouped. */
  group?: string | false;
  /** The hosts the notice applies to when the list is left empty, e.g. `["apply.example.com"]`. Shown as the starting value. */
  defaultAppliesTo?: readonly string[];
}

/**
 * The notice a visitor on a translated page sees before following a link to
 * something that exists in the default language only, such as an online
 * application. An object for Site Settings:
 *
 * - `enabled` and `appliesTo` are read from the default-language settings
 *   document and are never translated
 * - `title`, `body`, `continueLabel` and `cancelLabel` are written in the
 *   default language as the source and translated like any other text; the
 *   body is legal text, so its translation waits in the approval queue
 *
 * Do NOT list this field in `sharedFields`: each language carries its own
 * wording. Default-language pages never show the notice, whatever is typed
 * here.
 */
export function applyNoticeField(options: ApplyNoticeFieldOptions = {}): FieldDefinition {
  const group = options.group === undefined ? LANGUAGES_GROUP.name : options.group;
  const hosts = [...(options.defaultAppliesTo ?? [])];
  return defineField({
    name: options.name ?? APPLY_NOTICE_FIELD,
    title: "Notice before an English-only application",
    type: "object",
    description:
      "Shown on pages in another language before a visitor follows a link to the hosts listed here. English pages never show it. Write the wording in English; its translation is legal text and waits for approval. Until the translated wording is approved, pages in that language hide these links.",
    options: { collapsible: true, collapsed: true },
    fields: [
      noTranslate(
        defineField({
          name: "enabled",
          title: "Show the notice",
          type: "boolean",
          initialValue: true,
          description: "On unless switched off. Off: links to these hosts are left alone in every language.",
        }),
      ),
      noTranslate(
        defineField({
          name: "appliesTo",
          title: "Applies to links to",
          type: "array",
          of: [{ type: "string" }],
          options: { layout: "tags" },
          ...(hosts.length > 0 ? { initialValue: hosts } : {}),
          description: `Host names, one per entry, such as apply.example.com. A leading *. covers every subdomain.${hosts.length > 0 ? ` Left empty: ${hosts.join(", ")}.` : ""}`,
        }),
      ),
      defineField({ name: "title", title: "Title", type: "string" }),
      legalText(
        defineField({
          name: "body",
          title: "Wording",
          type: "text",
          rows: 4,
          description: "What the visitor is told before continuing, for example that the application is in English only.",
        }),
      ),
      defineField({ name: "continueLabel", title: "Continue button", type: "string" }),
      defineField({ name: "cancelLabel", title: "Cancel button", type: "string" }),
    ],
    ...(group ? { group } : {}),
  });
}
