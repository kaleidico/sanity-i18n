/**
 * The translation payload: what is sent to the model and how its answer is
 * checked and written back. Pure functions over plain JSON, shared by the
 * Studio (change tracking) and the server (translation).
 *
 * A document is cut into units. A unit is the smallest thing that is
 * translated as one piece and hashed as one piece:
 *
 * - `text`: one string field
 * - `list`: an array of plain strings
 * - `block`: one Portable Text block, with its spans, marks and mark
 *   definitions, so a sentence is never split across requests
 *
 * The payload keeps the document's own shape: objects keep their `_key` and
 * `_type`, arrays keep their members in order, and everything that is not
 * text (references, images, numbers, fixed choices, shared fields, slugs) is
 * simply absent.
 */
import { resolveManifestNode, type FieldManifest, type ManifestNode } from "./manifest";
import { getAtPath, pathToString, setAtPath, type PathSegment } from "./paths";
import { sha256Hex, stableStringify } from "./sha256";
import { I18N_FIELD, LANGUAGE_FIELD } from "./translations";

export type UnitKind = "text" | "list" | "block";

export interface PrunedSpan {
  _key?: string;
  _type: string;
  marks?: string[];
  text?: string;
}

export interface PrunedBlock {
  _key?: string;
  _type: "block";
  style?: string;
  listItem?: string;
  level?: number;
  markDefs?: Record<string, unknown>[];
  children: PrunedSpan[];
}

export type UnitValue = string | string[] | PrunedBlock;

export interface TranslationUnit {
  /** The unit's path in the document, e.g. `blocks[_key=="k01"].heading`. */
  path: string;
  segments: PathSegment[];
  kind: UnitKind;
  /** The source value: a string, a list of strings, or a pruned Portable Text block. */
  value: UnitValue;
  /** True when the field, or anything above it, is marked legal. */
  legal: boolean;
  /** SHA-256 of the source value. */
  hash: string;
  /** The top-level part of the document this unit sits in, used to split large documents. */
  piece: string;
}

type Json = Record<string, unknown>;

const LETTER = /\p{L}/u;
const SINGLE_TOKEN_NON_TEXT = /^(?:https?:\/\/|mailto:|tel:|www\.|\/|#)\S*$/i;
const EMAIL_ONLY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when a string is copy a person would read: it has a letter and is not just a URL, path or email. */
export function isTranslatableValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (!LETTER.test(trimmed)) return false;
  if (SINGLE_TOKEN_NON_TEXT.test(trimmed)) return false;
  if (EMAIL_ONLY.test(trimmed)) return false;
  return true;
}

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBlock(value: unknown): value is Json & { children: unknown[] } {
  return isObject(value) && value._type === "block" && Array.isArray(value.children);
}

/** A Portable Text block reduced to what a translator needs and what must come back unchanged. */
export function pruneBlock(block: Json): PrunedBlock {
  const out = {} as PrunedBlock;
  if (typeof block._key === "string") out._key = block._key;
  out._type = "block";
  if (typeof block.style === "string") out.style = block.style;
  if (typeof block.listItem === "string") out.listItem = block.listItem;
  if (typeof block.level === "number") out.level = block.level;
  if (Array.isArray(block.markDefs) && block.markDefs.length > 0) {
    out.markDefs = JSON.parse(JSON.stringify(block.markDefs)) as Record<string, unknown>[];
  }
  out.children = (Array.isArray(block.children) ? block.children : []).map((child) => {
    const c = (isObject(child) ? child : {}) as Json;
    const span = {} as PrunedSpan;
    if (typeof c._key === "string") span._key = c._key;
    span._type = typeof c._type === "string" ? c._type : "span";
    if (span._type === "span") {
      span.marks = Array.isArray(c.marks) ? c.marks.map(String) : [];
      span.text = typeof c.text === "string" ? c.text : "";
    }
    return span;
  });
  return out;
}

/** The readable text of a pruned block: its spans joined in order. */
export function blockText(block: PrunedBlock): string {
  return block.children.map((c) => (typeof c.text === "string" ? c.text : "")).join("");
}

function blockHrefs(block: PrunedBlock): string[] {
  return (block.markDefs ?? [])
    .map((def) => def.href)
    .filter((href): href is string => typeof href === "string");
}

function memberSegment(item: unknown, index: number): PathSegment {
  return isObject(item) && typeof item._key === "string" && item._key !== "" ? { _key: item._key } : index;
}

function pieceOf(segments: readonly PathSegment[]): string {
  const head = segments.slice(0, typeof segments[1] === "string" || segments[1] === undefined ? 1 : 2);
  return pathToString(head);
}

/**
 * Every translatable unit of a document, in document order. Shared fields,
 * the slug field, `language`, `i18n` and system fields are never included.
 */
export function extractUnits(doc: Json, manifest: FieldManifest, typeName?: string): TranslationUnit[] {
  const type = typeName ?? (typeof doc._type === "string" ? doc._type : "");
  const documentType = manifest.documents[type];
  if (!documentType) return [];
  const units: TranslationUnit[] = [];

  const push = (segments: PathSegment[], kind: UnitKind, value: UnitValue, legal: boolean) => {
    units.push({
      path: pathToString(segments),
      segments,
      kind,
      value,
      legal,
      hash: sha256Hex(stableStringify(value)),
      piece: pieceOf(segments),
    });
  };

  const walk = (value: unknown, node: ManifestNode, segments: PathSegment[], inheritedLegal: boolean) => {
    const resolved = resolveManifestNode(manifest, node);
    if (!resolved) return;
    const legal = inheritedLegal || resolved.legal;
    const current = resolved.node;

    switch (current.kind) {
      case "text":
        if (isTranslatableValue(value)) push(segments, "text", value, legal);
        return;
      case "list":
        if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string") && value.some(isTranslatableValue)) {
          push(segments, "list", [...(value as string[])], legal);
        }
        return;
      case "portableText":
        if (!Array.isArray(value)) return;
        value.forEach((item, index) => {
          const next = [...segments, memberSegment(item, index)];
          if (isBlock(item)) {
            const pruned = pruneBlock(item);
            if (pruned.children.some((c) => isTranslatableValue(c.text))) push(next, "block", pruned, legal);
            return;
          }
          if (!isObject(item)) return;
          const member = current.members[typeof item._type === "string" ? item._type : "object"];
          if (member) walk(item, member, next, legal);
        });
        return;
      case "array": {
        if (!Array.isArray(value)) return;
        const names = Object.keys(current.members);
        value.forEach((item, index) => {
          if (!isObject(item)) return;
          const member =
            current.members[typeof item._type === "string" ? item._type : "object"] ??
            (names.length === 1 ? current.members[names[0]] : undefined);
          if (member) walk(item, member, [...segments, memberSegment(item, index)], legal);
        });
        return;
      }
      case "object":
        if (!isObject(value)) return;
        for (const [name, child] of Object.entries(current.fields)) {
          if (value[name] !== undefined && value[name] !== null) walk(value[name], child, [...segments, name], legal);
        }
        return;
    }
  };

  for (const [name, node] of Object.entries(documentType.fields)) {
    if (doc[name] !== undefined && doc[name] !== null) walk(doc[name], node, [name], false);
  }
  return units;
}

function anchors(source: unknown): Json {
  const out: Json = {};
  if (isObject(source)) {
    if (typeof source._key === "string") out._key = source._key;
    if (typeof source._type === "string") out._type = source._type;
  }
  return out;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The payload for a set of units: the document's shape, reduced to those
 * units and the `_key` and `_type` of everything above them.
 */
export function buildPayload(doc: Json, units: readonly TranslationUnit[]): Json {
  const root: Json = {};

  for (const unit of units) {
    let source: unknown = doc;
    let out: unknown = root;
    const last = unit.segments.length - 1;

    unit.segments.forEach((segment, i) => {
      const isLast = i === last;
      if (typeof segment === "string") {
        const sourceChild = isObject(source) ? source[segment] : undefined;
        const target = out as Json;
        if (isLast) {
          target[segment] = clone(unit.value);
        } else {
          if (target[segment] === undefined) {
            if (Array.isArray(sourceChild)) {
              // Members without a `_key` are addressed by index, so the whole
              // array is kept in place to keep the indexes true.
              const unkeyed = sourceChild.some((m) => !(isObject(m) && typeof m._key === "string" && m._key !== ""));
              target[segment] = unkeyed ? sourceChild.map((m) => anchors(m)) : [];
            } else {
              target[segment] = anchors(sourceChild);
            }
          }
          out = target[segment];
        }
        source = sourceChild;
        return;
      }

      const sourceArray = Array.isArray(source) ? source : [];
      const targetArray = out as unknown[];
      if (typeof segment === "number") {
        if (isLast) targetArray[segment] = clone(unit.value);
        else out = targetArray[segment];
        source = sourceArray[segment];
        return;
      }

      const sourceChild = sourceArray.find((m) => isObject(m) && m._key === segment._key);
      let existing = targetArray.find((m) => isObject(m) && m._key === segment._key);
      if (isLast) {
        if (!existing) targetArray.push(clone(unit.value));
      } else {
        if (!existing) {
          existing = anchors(sourceChild);
          targetArray.push(existing);
        }
        out = existing;
      }
      source = sourceChild;
    });
  }

  return root;
}

const MAX_ERRORS = 25;

/**
 * Compare a translated payload with the one that was sent. The two must have
 * the same keys, the same `_key` and `_type` values, the same array lengths,
 * and inside a Portable Text block the same style, marks and mark
 * definitions. Only the text itself may differ. Returns a list of plain
 * descriptions of every difference, empty when the structure is identical.
 */
export function validateStructure(sent: unknown, received: unknown): string[] {
  const errors: string[] = [];
  const add = (message: string) => {
    if (errors.length < MAX_ERRORS) errors.push(message);
  };
  const where = (path: string) => (path === "" ? "the top level" : path);

  const compare = (a: unknown, b: unknown, path: string, key: string | undefined) => {
    if (errors.length >= MAX_ERRORS) return;

    if (typeof a === "string") {
      if (typeof b !== "string") return add(`${where(path)}: expected text, got ${b === null ? "null" : Array.isArray(b) ? "a list" : typeof b}`);
      if (key === "_key" || key === "_type") {
        if (a !== b) add(`${where(path)}: ${key} must stay ${JSON.stringify(a)}, got ${JSON.stringify(b)}`);
        return;
      }
      if (a.trim() !== "" && b.trim() === "") add(`${where(path)}: the translation is empty`);
      return;
    }

    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return add(`${where(path)}: expected a list`);
      if (a.length !== b.length) return add(`${where(path)}: expected ${a.length} item(s), got ${b.length}`);
      a.forEach((item, i) => {
        const label = isObject(item) && typeof item._key === "string" ? `[_key==${JSON.stringify(item._key)}]` : `[${i}]`;
        compare(item, b[i], `${path}${label}`, undefined);
      });
      return;
    }

    if (isObject(a)) {
      if (!isObject(b)) return add(`${where(path)}: expected an object`);
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      for (const k of aKeys) if (!(k in b)) add(`${where(path)}: "${k}" is missing`);
      for (const k of bKeys) if (!(k in a)) add(`${where(path)}: "${k}" was added`);

      if (a._type === "block" && Array.isArray(a.children)) {
        for (const fixed of ["_key", "_type", "style", "listItem", "level", "markDefs"]) {
          if (fixed in a && fixed in b && stableStringify(a[fixed]) !== stableStringify(b[fixed])) {
            add(`${where(path)}: ${fixed} must not change`);
          }
        }
        const aChildren = a.children as unknown[];
        const bChildren = Array.isArray(b.children) ? (b.children as unknown[]) : null;
        if (!bChildren) return add(`${where(path)}.children: expected a list`);
        if (aChildren.length !== bChildren.length) {
          return add(`${where(path)}.children: expected ${aChildren.length} span(s), got ${bChildren.length}`);
        }
        aChildren.forEach((child, i) => {
          const ac = (isObject(child) ? child : {}) as Json;
          const bc = bChildren[i];
          const childPath = `${path}.children[${i}]`;
          if (!isObject(bc)) return add(`${childPath}: expected an object`);
          for (const k of Object.keys(ac)) if (!(k in bc)) add(`${childPath}: "${k}" is missing`);
          for (const k of Object.keys(bc)) if (!(k in ac)) add(`${childPath}: "${k}" was added`);
          for (const fixed of ["_key", "_type", "marks"]) {
            if (fixed in ac && fixed in bc && stableStringify(ac[fixed]) !== stableStringify(bc[fixed])) {
              add(`${childPath}: ${fixed} must not change`);
            }
          }
          if (typeof ac.text === "string") {
            if (typeof bc.text !== "string") add(`${childPath}.text: expected text`);
          }
        });
        if (aChildren.some((c) => isObject(c) && typeof c.text === "string" && c.text.trim() !== "")) {
          const translated = bChildren.map((c) => (isObject(c) && typeof c.text === "string" ? c.text : "")).join("");
          if (translated.trim() === "") add(`${where(path)}: the translation is empty`);
        }
        return;
      }

      for (const k of aKeys) if (k in b) compare(a[k], b[k], path ? `${path}.${k}` : k, k);
      return;
    }

    if (a !== b) add(`${where(path)}: value must stay ${JSON.stringify(a)}`);
  };

  compare(sent, received, "", undefined);
  return errors;
}

function keepEdgeWhitespace(source: string, translated: string): string {
  const lead = /^\s*/.exec(source)?.[0] ?? "";
  const trail = /\s*$/.exec(source)?.[0] ?? "";
  if (source.trim() === "") return translated;
  return lead + translated.trim() + trail;
}

/** The translated value of one unit, read from a payload of the same shape. `undefined` when it is not there. */
export function readUnit(payload: unknown, unit: TranslationUnit): UnitValue | undefined {
  const value = getAtPath(payload, unit.segments);
  if (unit.kind === "text") return typeof value === "string" ? value : undefined;
  if (unit.kind === "list") {
    return Array.isArray(value) && value.length === (unit.value as string[]).length && value.every((v) => typeof v === "string")
      ? (value as string[])
      : undefined;
  }
  return isBlock(value) ? pruneBlock(value) : undefined;
}

/**
 * Write translated unit values into a document (a copy of the source, or the
 * document being rebuilt). Spans keep the leading and trailing spaces of the
 * source span, because a space at a span edge separates words across a mark
 * boundary. Returns the paths that could not be written.
 */
export function applyUnits(target: Json, entries: readonly { unit: TranslationUnit; value: UnitValue }[]): string[] {
  const missing: string[] = [];
  for (const { unit, value } of entries) {
    if (unit.kind === "text" || unit.kind === "list") {
      if (!setAtPath(target, unit.segments, clone(value))) missing.push(unit.path);
      continue;
    }
    const block = getAtPath(target, unit.segments);
    const translated = value as PrunedBlock;
    const source = unit.value as PrunedBlock;
    if (!isBlock(block)) {
      missing.push(unit.path);
      continue;
    }
    (block.children as unknown[]).forEach((child, i) => {
      if (!isObject(child) || child._type !== "span") return;
      const from =
        translated.children.find((c) => c._key !== undefined && c._key === child._key) ?? translated.children[i];
      const original = source.children.find((c) => c._key !== undefined && c._key === child._key) ?? source.children[i];
      if (from && typeof from.text === "string") {
        child.text = keepEdgeWhitespace(typeof original?.text === "string" ? original.text : "", from.text);
      }
    });
  }
  return missing;
}

export interface UnitPair {
  path: string;
  source: string;
  translated: string;
  /** Link targets of a Portable Text block, compared as exact values. */
  sourceHrefs?: string[];
  translatedHrefs?: string[];
}

/** The source and translated text of a unit as plain string pairs, for the exact-match check and the reviewer. */
export function unitPairs(unit: TranslationUnit, translated: UnitValue): UnitPair[] {
  if (unit.kind === "text") return [{ path: unit.path, source: unit.value as string, translated: translated as string }];
  if (unit.kind === "list") {
    const source = unit.value as string[];
    const target = translated as string[];
    return source.map((s, i) => ({ path: `${unit.path}[${i}]`, source: s, translated: target[i] ?? "" }));
  }
  const source = unit.value as PrunedBlock;
  const target = translated as PrunedBlock;
  return [
    {
      path: unit.path,
      source: blockText(source),
      translated: blockText(target),
      sourceHrefs: blockHrefs(source),
      translatedHrefs: blockHrefs(target),
    },
  ];
}

/** The number of characters of text in a set of units. */
export function unitCharacters(units: readonly TranslationUnit[]): number {
  let total = 0;
  for (const unit of units) {
    if (unit.kind === "text") total += (unit.value as string).length;
    else if (unit.kind === "list") total += (unit.value as string[]).reduce((n, s) => n + s.length, 0);
    else total += blockText(unit.value as PrunedBlock).length;
  }
  return total;
}

/** The number of separate strings in a set of units (a block counts each span with text). */
export function unitStrings(units: readonly TranslationUnit[]): number {
  let total = 0;
  for (const unit of units) {
    if (unit.kind === "text") total += 1;
    else if (unit.kind === "list") total += (unit.value as string[]).length;
    else total += (unit.value as PrunedBlock).children.filter((c) => typeof c.text === "string" && c.text !== "").length;
  }
  return total;
}

// ── Change tracking ─────────────────────────────────────────────────────

/** The path the hash of everything that is not text is stored under. */
export const STRUCTURE_HASH_PATH = "__structure";

export interface SourceHashEntry {
  _key: string;
  path: string;
  hash: string;
}

const SYSTEM_FIELDS = ["_id", "_rev", "_createdAt", "_updatedAt", "_system", "_originalId"];

/**
 * A fingerprint of everything in the source that is not translated text but
 * is still copied onto the translation: block order, images, links, fixed
 * choices. When it changes, the translation is rebuilt from the source
 * without asking the model for anything.
 */
export function structureHash(doc: Json, manifest: FieldManifest, units: readonly TranslationUnit[]): string {
  const documentType = manifest.documents[typeof doc._type === "string" ? doc._type : ""];
  const copy = clone(doc);
  for (const field of SYSTEM_FIELDS) delete copy[field];
  delete copy[LANGUAGE_FIELD];
  delete copy[I18N_FIELD];
  for (const field of documentType?.sharedFields ?? []) delete copy[field];
  if (documentType?.slugField) delete copy[documentType.slugField];
  for (const unit of units) {
    if (unit.kind === "text") setAtPath(copy, unit.segments, "");
    else if (unit.kind === "list") setAtPath(copy, unit.segments, []);
    else {
      const block = getAtPath(copy, unit.segments);
      if (isBlock(block)) for (const child of block.children) if (isObject(child) && typeof child.text === "string") child.text = "";
    }
  }
  return sha256Hex(stableStringify(copy));
}

/** The per-unit source hashes stored on a translation as `i18n.sourceHashes`, plus the structure hash. */
export function sourceHashes(doc: Json, manifest: FieldManifest, units?: readonly TranslationUnit[]): SourceHashEntry[] {
  const list = units ?? extractUnits(doc, manifest);
  const entries = list.map((unit) => ({ _key: sha256Hex(unit.path).slice(0, 12), path: unit.path, hash: unit.hash }));
  entries.push({ _key: "structure", path: STRUCTURE_HASH_PATH, hash: structureHash(doc, manifest, list) });
  return entries;
}

/** One fingerprint for a whole set of source hashes, stored as `i18n.sourceHash`. */
export function sourceFingerprint(entries: readonly SourceHashEntry[]): string {
  return sha256Hex(
    entries
      .map((e) => `${e.path}\n${e.hash}`)
      .sort()
      .join("\n"),
  );
}

export interface SourceDiff {
  /** Units whose English changed since the translation was made. */
  changed: string[];
  /** Units that are new in the English. */
  added: string[];
  /** Units the translation was made from that no longer exist in the English. */
  removed: string[];
  /** True when something that is not text changed: block order, an image, a link target, a fixed choice. */
  structureChanged: boolean;
  /** True when nothing at all changed. */
  upToDate: boolean;
}

/**
 * Compare the source document with the hashes stored on a translation.
 * A translation without stored hashes reports every unit as added.
 */
export function diffSource(sourceDoc: Json, translationDoc: Json | null | undefined, manifest: FieldManifest): SourceDiff {
  const units = extractUnits(sourceDoc, manifest);
  const current = sourceHashes(sourceDoc, manifest, units);
  const storedRaw = (translationDoc?.[I18N_FIELD] as { sourceHashes?: unknown } | undefined)?.sourceHashes;
  const stored = new Map<string, string>();
  if (Array.isArray(storedRaw)) {
    for (const entry of storedRaw) {
      if (isObject(entry) && typeof entry.path === "string" && typeof entry.hash === "string") stored.set(entry.path, entry.hash);
    }
  }

  const changed: string[] = [];
  const added: string[] = [];
  let structureChanged = false;
  const seen = new Set<string>();
  for (const entry of current) {
    seen.add(entry.path);
    const before = stored.get(entry.path);
    if (entry.path === STRUCTURE_HASH_PATH) {
      structureChanged = before !== entry.hash;
      continue;
    }
    if (before === undefined) added.push(entry.path);
    else if (before !== entry.hash) changed.push(entry.path);
  }
  const removed = [...stored.keys()].filter((path) => path !== STRUCTURE_HASH_PATH && !seen.has(path));
  const upToDate = changed.length === 0 && added.length === 0 && removed.length === 0 && !structureChanged;
  return { changed, added, removed, structureChanged, upToDate };
}
