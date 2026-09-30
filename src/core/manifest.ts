/**
 * The field manifest: a plain JSON description of which values in each
 * document type are text to translate. The Studio builds it from its
 * compiled schema and stores it in a private document; the server reads it
 * to build the translation payload, because the server never loads the
 * Studio schema.
 *
 * Text is decided by the schema, never guessed from a value alone:
 *
 * - `string` and `text` fields are text, unless they have an options list
 *   (a fixed choice), are a `url`, `email`, `date` or `datetime`, or carry a
 *   field name that marks them as plumbing (`href`, `ctaUrl`, `gtmId`, ...)
 * - arrays with a `block` member are Portable Text
 * - arrays of plain strings are a list of text
 * - images contribute their own custom fields (`alt`, `caption`) only
 * - references, slugs, files, numbers and booleans are never text
 * - `options.i18n.translate` on a field overrides the decision either way
 *
 * This module has no Sanity import. It reads the compiled schema by shape.
 */
import { DEFAULT_LANGUAGE_ID } from "./languages";
import { I18N_FIELD, LANGUAGE_FIELD } from "./translations";

export type ManifestNode =
  | { kind: "text"; legal?: boolean }
  | { kind: "list"; legal?: boolean }
  | { kind: "portableText"; members: Record<string, ManifestNode>; legal?: boolean }
  | { kind: "object"; fields: Record<string, ManifestNode>; legal?: boolean }
  | { kind: "array"; members: Record<string, ManifestNode>; legal?: boolean }
  | { kind: "ref"; type: string; legal?: boolean };

export interface ManifestDocumentType {
  fields: Record<string, ManifestNode>;
  /** Fields read from the source document on a translation; never translated. */
  sharedFields: string[];
  /** The slug field, translated separately into a URL-safe slug. */
  slugField: string | null;
}

export interface FieldManifest {
  version: 1;
  defaultLanguage: string;
  documents: Record<string, ManifestDocumentType>;
  /** Named object types, stored once and pointed at with `{ kind: "ref" }`. */
  types: Record<string, ManifestNode>;
}

/** The part of a compiled Sanity schema type this module reads. */
export interface CompiledTypeLike {
  name?: string;
  jsonType?: string;
  type?: CompiledTypeLike | null;
  fields?: readonly { name: string; type: CompiledTypeLike }[];
  of?: readonly CompiledTypeLike[];
  options?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** The part of a compiled Sanity schema this module reads. `useSchema()` and `createSchema()` both satisfy it. */
export interface CompiledSchemaLike {
  get(name: string): unknown;
}

const CORE_TYPES = new Set([
  "any",
  "array",
  "block",
  "boolean",
  "crossDatasetReference",
  "date",
  "datetime",
  "document",
  "email",
  "file",
  "geopoint",
  "globalDocumentReference",
  "image",
  "number",
  "object",
  "reference",
  "slug",
  "span",
  "string",
  "text",
  "url",
]);

const NEVER_TEXT_STRING_TYPES = ["url", "email", "date", "datetime"];
const NEVER_TEXT_OBJECT_TYPES = ["reference", "slug", "file", "geopoint", "crossDatasetReference", "globalDocumentReference"];
const IMAGE_SYSTEM_FIELDS = new Set(["asset", "media", "hotspot", "crop"]);

/**
 * Field names that hold plumbing rather than copy even though the field is a
 * plain string: links, ids, keys, icons, colours. A host that needs such a
 * field translated sets `options: { i18n: { translate: true } }` on it.
 */
export const NON_TEXT_FIELD_NAME =
  /^(?:href|url|uri|link|src|path|icon|color|colour|id|anchor|className|variant|.*(?:Href|Url|URL|Uri|Link|Src|Path|Id|ID|Key|Icon|Color|Colour|Class|Token|Code|Slug))$/;

function chainNames(type: CompiledTypeLike | null | undefined): string[] {
  const names: string[] = [];
  let current = type;
  let guard = 0;
  while (current && guard++ < 20) {
    if (typeof current.name === "string") names.push(current.name);
    current = current.type ?? null;
  }
  return names;
}

function extendsAny(type: CompiledTypeLike, bases: readonly string[]): boolean {
  const names = chainNames(type);
  return bases.some((base) => names.includes(base));
}

function i18nOption(type: CompiledTypeLike, key: "legal" | "translate"): boolean | undefined {
  let current: CompiledTypeLike | null | undefined = type;
  let guard = 0;
  while (current && guard++ < 20) {
    const i18n = (current.options as { i18n?: Record<string, unknown> } | null | undefined)?.i18n;
    if (i18n && typeof i18n[key] === "boolean") return i18n[key] as boolean;
    current = current.type ?? null;
  }
  return undefined;
}

function hasList(type: CompiledTypeLike): boolean {
  let current: CompiledTypeLike | null | undefined = type;
  let guard = 0;
  while (current && guard++ < 20) {
    const list = (current.options as { list?: unknown } | null | undefined)?.list;
    if (Array.isArray(list) && list.length > 0) return true;
    current = current.type ?? null;
  }
  return false;
}

/**
 * The name of the host-defined type a compiled type was declared with, if
 * any. Only the parents count: an inline object may carry a name of its own
 * without being a registered type.
 */
function namedType(type: CompiledTypeLike): string | undefined {
  return chainNames(type.type).find((name) => !CORE_TYPES.has(name) && !name.startsWith("sanity."));
}

interface TranslatableMarkerLike {
  sharedFields?: unknown;
  slugField?: unknown;
  defaultLanguage?: unknown;
}

export interface BuildFieldManifestOptions {
  /** The default language id. Defaults to the one recorded by `translatable()`, else `en`. */
  defaultLanguage?: string;
}

/**
 * Build the manifest for the given document types from a compiled schema.
 * Types the schema does not know are left out.
 */
export function buildFieldManifest(
  schema: CompiledSchemaLike,
  documentTypes: readonly string[],
  options: BuildFieldManifestOptions = {},
): FieldManifest {
  const types: Record<string, ManifestNode> = {};
  const building = new Set<string>();

  const withLegal = <T extends ManifestNode>(node: T, legal: boolean): T => (legal ? { ...node, legal: true } : node);

  function walkNamed(name: string): boolean {
    if (types[name]) return true;
    // A type that is still being built refers to itself further down: point at it.
    if (building.has(name)) return true;
    const compiled = schema.get(name) as CompiledTypeLike | undefined;
    if (!compiled) return false;
    building.add(name);
    const node = walkInline(compiled, undefined);
    building.delete(name);
    if (!node) return false;
    types[name] = node;
    return true;
  }

  function walk(type: CompiledTypeLike, fieldName: string | undefined): ManifestNode | null {
    const translate = i18nOption(type, "translate");
    if (translate === false) return null;
    const legal = i18nOption(type, "legal") === true;

    if (type.jsonType === "object" && !extendsAny(type, NEVER_TEXT_OBJECT_TYPES) && !extendsAny(type, ["image", "block"])) {
      const name = namedType(type);
      if (name && schema.get(name)) {
        return walkNamed(name) ? withLegal({ kind: "ref", type: name }, legal) : null;
      }
    }
    return walkInline(type, fieldName);
  }

  function walkInline(type: CompiledTypeLike, fieldName: string | undefined): ManifestNode | null {
    const translate = i18nOption(type, "translate");
    if (translate === false) return null;
    const legal = i18nOption(type, "legal") === true;

    switch (type.jsonType) {
      case "string": {
        if (translate !== true) {
          if (extendsAny(type, NEVER_TEXT_STRING_TYPES)) return null;
          if (hasList(type)) return null;
          if (fieldName && !extendsAny(type, ["text"]) && NON_TEXT_FIELD_NAME.test(fieldName)) return null;
        }
        return withLegal({ kind: "text" }, legal);
      }
      case "array": {
        if (hasList(type)) return null;
        const members = type.of ?? [];
        const isPortableText = members.some((m) => extendsAny(m, ["block"]));
        const objectMembers: Record<string, ManifestNode> = {};
        let stringMember = false;
        for (const member of members) {
          if (extendsAny(member, ["block"])) continue;
          if (member.jsonType === "string") {
            if (walkInline(member, fieldName)) stringMember = true;
            continue;
          }
          if (member.jsonType !== "object") continue;
          const node = walk(member, undefined);
          if (node) objectMembers[member.name ?? "object"] = node;
        }
        if (isPortableText) return withLegal({ kind: "portableText", members: objectMembers }, legal);
        if (Object.keys(objectMembers).length > 0) return withLegal({ kind: "array", members: objectMembers }, legal);
        if (stringMember) return withLegal({ kind: "list" }, legal);
        return null;
      }
      case "object": {
        if (extendsAny(type, NEVER_TEXT_OBJECT_TYPES)) return null;
        const isImage = extendsAny(type, ["image"]);
        const fields: Record<string, ManifestNode> = {};
        for (const field of type.fields ?? []) {
          if (isImage && IMAGE_SYSTEM_FIELDS.has(field.name)) continue;
          if (field.name.startsWith("_")) continue;
          const node = walk(field.type, field.name);
          if (node) fields[field.name] = node;
        }
        if (Object.keys(fields).length === 0) return null;
        return withLegal({ kind: "object", fields }, legal);
      }
      default:
        return null;
    }
  }

  const documents: Record<string, ManifestDocumentType> = {};
  let defaultLanguage = options.defaultLanguage;

  for (const typeName of documentTypes) {
    const compiled = schema.get(typeName) as CompiledTypeLike | undefined;
    if (!compiled) continue;
    const marker = (compiled.__i18n ?? {}) as TranslatableMarkerLike;
    const sharedFields = Array.isArray(marker.sharedFields) ? marker.sharedFields.map(String) : [];
    const slugField =
      typeof marker.slugField === "string"
        ? marker.slugField
        : (compiled.fields ?? []).find((f) => extendsAny(f.type, ["slug"]))?.name ?? null;
    if (!defaultLanguage && typeof marker.defaultLanguage === "string") defaultLanguage = marker.defaultLanguage;

    const fields: Record<string, ManifestNode> = {};
    for (const field of compiled.fields ?? []) {
      if (field.name === LANGUAGE_FIELD || field.name === I18N_FIELD) continue;
      if (field.name.startsWith("_")) continue;
      if (sharedFields.includes(field.name)) continue;
      if (slugField && field.name === slugField) continue;
      const node = walk(field.type, field.name);
      if (node) fields[field.name] = node;
    }
    const hasSlug = slugField !== null && (compiled.fields ?? []).some((f) => f.name === slugField);
    documents[typeName] = { fields, sharedFields, slugField: hasSlug ? slugField : null };
  }

  return { version: 1, defaultLanguage: defaultLanguage ?? DEFAULT_LANGUAGE_ID, documents, types };
}

/** Follow a `ref` node to the named type it points at. Returns null when the manifest does not have it. */
export function resolveManifestNode(manifest: FieldManifest, node: ManifestNode): { node: Exclude<ManifestNode, { kind: "ref" }>; legal: boolean } | null {
  let current: ManifestNode | undefined = node;
  let legal = node.legal === true;
  let guard = 0;
  while (current && current.kind === "ref" && guard++ < 10) {
    current = manifest.types[current.type];
    if (current?.legal) legal = true;
  }
  if (!current || current.kind === "ref") return null;
  return { node: current, legal };
}
