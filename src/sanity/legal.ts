import type { SchemaTypeDefinition } from "sanity";

/**
 * Legal marking. A field or block type marked legal carries text that a
 * person must approve before it goes live in another language: disclaimers,
 * disclosures, consent language, NMLS and Equal Housing lines.
 *
 * The mark lives in `options.i18n.legal` so it survives schema compilation
 * and can be read from the definition, the compiled schema type and the
 * field on a compiled object type alike.
 */

export const LEGAL_NOTE = "(legal text: needs approval before it goes live in another language)";

/**
 * Anything with an optional `options` and `description`: a field definition,
 * an array member or a type definition. Kept loose on purpose so Sanity's
 * own option types (`StringOptions`, `TextOptions`, ...) are accepted as is.
 */
interface WithOptions {
  options?: unknown;
  description?: unknown;
}

interface I18nOptions {
  i18n?: { legal?: boolean; translate?: boolean };
  [key: string]: unknown;
}

function withLegalMark<T extends WithOptions>(def: T): T {
  const description =
    typeof def.description === "string" && def.description.trim() !== ""
      ? `${def.description} ${LEGAL_NOTE}`
      : LEGAL_NOTE;
  const options = (def.options ?? {}) as I18nOptions;
  return {
    ...def,
    description,
    options: {
      ...options,
      i18n: { ...(options.i18n ?? {}), legal: true },
    },
  } as T;
}

/** Mark a field definition as legal text. Returns a new definition; the input is not changed. */
export function legalText<T extends WithOptions>(fieldDef: T): T {
  return withLegalMark(fieldDef);
}

/** Mark an object or block type definition as legal text. Returns a new definition; the input is not changed. */
export function legalBlock<T extends WithOptions>(blockTypeDef: T): T {
  return withLegalMark(blockTypeDef);
}

/**
 * Mark a field as never translated: a machine name, a stored value, an id.
 * The translation engine leaves it exactly as it is in the source. Returns a
 * new definition; the input is not changed.
 *
 * The engine already skips URLs, fixed choices, references, slugs and fields
 * whose name marks them as plumbing (`href`, `ctaUrl`, `gtmId`). Use this for
 * a plain string field it cannot tell apart from copy, such as a form
 * field's `name`. The opposite, `options: { i18n: { translate: true } }`,
 * forces a field to be translated.
 */
export function noTranslate<T extends WithOptions>(fieldDef: T): T {
  const options = (fieldDef.options ?? {}) as I18nOptions;
  return {
    ...fieldDef,
    options: { ...options, i18n: { ...(options.i18n ?? {}), translate: false } },
  } as T;
}

/** True when a field, member or schema type carries the legal mark. */
export function isLegal(schemaTypeOrField: unknown): boolean {
  if (!schemaTypeOrField || typeof schemaTypeOrField !== "object") return false;
  const options = (schemaTypeOrField as WithOptions).options as I18nOptions | undefined;
  return options?.i18n?.legal === true;
}

export interface CollectLegalPathsOptions {
  /**
   * Named types the document's arrays may reference (`of: [{ type: "consentBlock" }]`).
   * Without them only inline members and fields can be inspected.
   */
  types?: readonly SchemaTypeDefinition[];
}

interface LooseField {
  name?: string;
  type?: string;
  fields?: LooseField[];
  of?: LooseField[];
  options?: Record<string, unknown>;
}

/**
 * The paths of every legal field in a document type, as strings:
 *
 * - `footerDisclaimer` for a legal field
 * - `contact.consentLine` for a legal field inside an object field
 * - `legalLinks[].label` for a legal field inside an inline array member
 * - `fields[consentField].consentText` for a legal field inside a named array member
 * - `blocks[disclosureBlock]` for a whole array member type marked with `legalBlock`
 * - `blocks[formBlock].fields[consentField].consentText` for a legal field in
 *   an array inside an array member
 *
 * Arrays are followed to any depth, the same as the translation engine's
 * field manifest, so this list is exactly what the engine treats as legal. A
 * named type that refers to itself is followed once.
 */
export function collectLegalPaths(
  documentTypeDef: SchemaTypeDefinition | { fields?: unknown[] },
  options: CollectLegalPathsOptions = {},
): string[] {
  const registry = new Map<string, LooseField>();
  for (const t of options.types ?? []) {
    if (t && typeof t.name === "string") registry.set(t.name, t as unknown as LooseField);
  }
  const out: string[] = [];
  walkFields(((documentTypeDef as LooseField).fields ?? []) as LooseField[], "", registry, out, new Set());
  return out;
}

function resolve(member: LooseField, registry: Map<string, LooseField>): LooseField {
  // An inline member has its own fields. A named member (`{ type: "x" }`)
  // resolves through the registry when the type is known there.
  if (member.fields || !member.type) return member;
  const named = registry.get(member.type);
  return named ? { ...named, ...member, options: { ...(named.options ?? {}), ...(member.options ?? {}) } } : member;
}

function walkFields(
  fields: LooseField[],
  prefix: string,
  registry: Map<string, LooseField>,
  out: string[],
  visiting: Set<string>,
): void {
  for (const field of fields) {
    if (!field || typeof field.name !== "string") continue;
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const resolved = resolve(field, registry);

    if (isLegal(field) || (resolved !== field && isLegal(resolved))) {
      out.push(path);
      continue;
    }

    if (Array.isArray(resolved.fields)) {
      walkNamed(resolved, field, () => walkFields(resolved.fields as LooseField[], path, registry, out, visiting), visiting);
      continue;
    }

    if (Array.isArray(resolved.of)) {
      for (const member of resolved.of) {
        if (!member || typeof member !== "object") continue;
        const memberResolved = resolve(member, registry);
        const memberName =
          typeof member.name === "string"
            ? member.name
            : typeof member.type === "string" && member.type !== "object"
              ? member.type
              : "";
        const memberPath = `${path}[${memberName}]`;
        if (isLegal(member) || (memberResolved !== member && isLegal(memberResolved))) {
          out.push(memberPath);
          continue;
        }
        if (Array.isArray(memberResolved.fields)) {
          walkNamed(memberResolved, member, () => walkFields(memberResolved.fields as LooseField[], memberPath, registry, out, visiting), visiting);
        }
      }
    }
  }
}

/** Follow into a named type once per branch, so a type that refers to itself does not recurse for ever. */
function walkNamed(resolved: LooseField, original: LooseField, walk: () => void, visiting: Set<string>): void {
  const name = resolved !== original && typeof original.type === "string" ? original.type : undefined;
  if (name && visiting.has(name)) return;
  if (name) visiting.add(name);
  walk();
  if (name) visiting.delete(name);
}
