/**
 * Paths into a Sanity document, in the same form the Studio uses: field
 * names, array members by `_key`, and an index only where a member has no
 * key (arrays of plain strings).
 *
 * `blocks[_key=="k01"].heading`, `seo.metaTitle`, `tags[2]`
 */

export type PathSegment = string | number | { _key: string };

export function pathToString(segments: readonly PathSegment[]): string {
  let out = "";
  for (const segment of segments) {
    if (typeof segment === "string") out += out ? `.${segment}` : segment;
    else if (typeof segment === "number") out += `[${segment}]`;
    else out += `[_key==${JSON.stringify(segment._key)}]`;
  }
  return out;
}

const SEGMENT = /\[_key=="((?:[^"\\]|\\.)*)"\]|\[(\d+)\]|([^.[\]]+)/g;

export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  SEGMENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SEGMENT.exec(path)) !== null) {
    if (match[1] !== undefined) segments.push({ _key: JSON.parse(`"${match[1]}"`) as string });
    else if (match[2] !== undefined) segments.push(Number(match[2]));
    else if (match[3] !== undefined) segments.push(match[3]);
  }
  return segments;
}

function step(current: unknown, segment: PathSegment): unknown {
  if (current === null || typeof current !== "object") return undefined;
  if (typeof segment === "string") {
    return Array.isArray(current) ? undefined : (current as Record<string, unknown>)[segment];
  }
  if (!Array.isArray(current)) return undefined;
  if (typeof segment === "number") return current[segment];
  return current.find(
    (item) => item !== null && typeof item === "object" && (item as { _key?: unknown })._key === segment._key,
  );
}

/** The value at a path, or `undefined` when any step is missing. */
export function getAtPath(root: unknown, segments: readonly PathSegment[]): unknown {
  let current = root;
  for (const segment of segments) {
    current = step(current, segment);
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * Set the value at a path that already exists up to its last step. Returns
 * false, changing nothing, when a step on the way is missing.
 */
export function setAtPath(root: unknown, segments: readonly PathSegment[], value: unknown): boolean {
  if (segments.length === 0) return false;
  const parent = getAtPath(root, segments.slice(0, -1));
  const last = segments[segments.length - 1];
  if (parent === null || typeof parent !== "object") return false;
  if (typeof last === "string") {
    if (Array.isArray(parent)) return false;
    (parent as Record<string, unknown>)[last] = value;
    return true;
  }
  if (!Array.isArray(parent)) return false;
  if (typeof last === "number") {
    if (last < 0 || last >= parent.length) return false;
    parent[last] = value;
    return true;
  }
  const index = parent.findIndex(
    (item) => item !== null && typeof item === "object" && (item as { _key?: unknown })._key === last._key,
  );
  if (index === -1) return false;
  parent[index] = value;
  return true;
}
