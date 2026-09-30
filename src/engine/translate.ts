/**
 * The translator call: units in, translated units out. A document that fits
 * goes in one request. A larger one is split along its top-level parts, and
 * each request still carries the document's outline and the text on either
 * side, so nothing is translated out of context.
 */
import { toSlug, type CallUsage } from "../core/engineModel";
import {
  blockText,
  buildPayload,
  readUnit,
  validateStructure,
  type PrunedBlock,
  type TranslationUnit,
  type UnitValue,
} from "../core/payload";
import { callModel, parseJsonObject, type AnthropicLike, type CallPolicy, type Effort, type ModelMessage } from "./anthropic";
import { EngineError } from "./errors";
import { translatorSystemPrompt, type PromptContext } from "./prompts";
import { createLimiter } from "./retry";

type Json = Record<string, unknown>;

/** Characters of payload JSON per request. Above this the document is split. */
export const DEFAULT_MAX_CHARS_PER_REQUEST = 24_000;
/** A single part larger than this cannot be translated in one run. */
export const HARD_MAX_CHARS_PER_REQUEST = 160_000;
const NEIGHBOUR_CHARS = 600;

export interface TranslateUnitsInput {
  client: AnthropicLike;
  model: string;
  effort?: Effort;
  prompt: PromptContext;
  /** The source document. */
  document: Json;
  /** The units to translate on this run. */
  units: readonly TranslationUnit[];
  /** Every unit of the document, for context when only some are translated. */
  allUnits: readonly TranslationUnit[];
  /** The current translation of the units that are not being translated, as a fixed reference. */
  existing?: ReadonlyMap<string, UnitValue>;
  /** The source slug, when a translated one should be proposed. */
  slug?: string | null;
  maxCharsPerRequest?: number;
  concurrency?: number;
  policy?: CallPolicy;
}

export interface TranslateUnitsResult {
  values: Map<string, UnitValue>;
  slug: string | null;
  usage: CallUsage;
  servedBy: string[];
  structureRetries: number;
  requests: number;
}

function unitText(unit: TranslationUnit): string {
  if (unit.kind === "text") return unit.value as string;
  if (unit.kind === "list") return (unit.value as string[]).join(" / ");
  return blockText(unit.value as PrunedBlock);
}

/** Group units into requests along the document's top-level parts. */
export function chunkUnits(document: Json, units: readonly TranslationUnit[], maxChars: number): TranslationUnit[][] {
  const pieces: TranslationUnit[][] = [];
  for (const unit of units) {
    const last = pieces[pieces.length - 1];
    if (last && last[0].piece === unit.piece) last.push(unit);
    else pieces.push([unit]);
  }

  const chunks: TranslationUnit[][] = [];
  let current: TranslationUnit[] = [];
  let currentSize = 0;
  for (const piece of pieces) {
    const size = JSON.stringify(buildPayload(document, piece)).length;
    if (size > HARD_MAX_CHARS_PER_REQUEST) throw new EngineError("document_too_large", { details: [piece[0].piece] });
    if (current.length > 0 && currentSize + size > maxChars) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(...piece);
    currentSize += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function outline(document: Json, units: readonly TranslationUnit[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    if (seen.has(unit.piece)) continue;
    seen.add(unit.piece);
    const first = unitText(unit).replace(/\s+/g, " ").trim().slice(0, 80);
    lines.push(`${unit.piece}: ${first}`);
  }
  return lines;
}

function withValues(units: readonly TranslationUnit[], values: ReadonlyMap<string, UnitValue>): TranslationUnit[] {
  return units.filter((u) => values.has(u.path)).map((u) => ({ ...u, value: values.get(u.path) as UnitValue }));
}

export async function translateUnits(input: TranslateUnitsInput): Promise<TranslateUnitsResult> {
  const usage: CallUsage = { model: input.model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const values = new Map<string, UnitValue>();
  const servedBy = new Set<string>();
  let structureRetries = 0;
  let slug: string | null = null;

  if (input.units.length === 0) return { values, slug, usage, servedBy: [], structureRetries, requests: 0 };

  const chunks = chunkUnits(input.document, input.units, input.maxCharsPerRequest ?? DEFAULT_MAX_CHARS_PER_REQUEST);
  const system = translatorSystemPrompt(input.prompt);
  const partial = input.units.length < input.allUnits.length;
  const typeName = typeof input.document._type === "string" ? input.document._type : "";

  const sharedContext: Json = {};
  if (chunks.length > 1) sharedContext.outline = outline(input.document, input.allUnits);
  if (partial) {
    sharedContext.source = buildPayload(input.document, input.allUnits);
    if (input.existing && input.existing.size > 0) {
      sharedContext.existingTranslation = buildPayload(input.document, withValues(input.allUnits, input.existing));
    }
  }

  const runChunk = async (chunk: TranslationUnit[], index: number) => {
    const payload = buildPayload(input.document, chunk);
    const context: Json = { ...sharedContext };
    if (chunks.length > 1) {
      const before = chunks[index - 1]?.map(unitText).join("\n").slice(-NEIGHBOUR_CHARS);
      const after = chunks[index + 1]?.map(unitText).join("\n").slice(0, NEIGHBOUR_CHARS);
      if (before) context.before = before;
      if (after) context.after = after;
    }

    const request: Json = {
      task: "translate",
      sourceLanguage: input.prompt.sourceLanguage.id,
      targetLanguage: input.prompt.targetLanguage.id,
      documentType: typeName,
    };
    const wantsSlug = index === 0 && typeof input.slug === "string" && input.slug !== "";
    if (wantsSlug) request.slug = input.slug;
    if (Object.keys(context).length > 0) request.context = context;
    request.translate = payload;

    const messages: ModelMessage[] = [{ role: "user", content: JSON.stringify(request) }];
    let translated: unknown;
    let errors: string[] = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await callModel(input.client, { model: input.model, system, messages, effort: input.effort }, input.policy);
      usage.requests++;
      usage.inputTokens += answer.usage.inputTokens;
      usage.outputTokens += answer.usage.outputTokens;
      usage.cacheReadTokens += answer.usage.cacheReadTokens;
      usage.cacheWriteTokens += answer.usage.cacheWriteTokens;
      servedBy.add(answer.servedBy);

      const parsed = parseJsonObject(answer.text);
      translated = parsed?.translated;
      errors = parsed ? validateStructure(payload, translated) : ["The answer was not a JSON object."];
      if (errors.length === 0) {
        if (wantsSlug && typeof parsed?.slug === "string") slug = toSlug(parsed.slug) || null;
        break;
      }
      if (attempt === 0) {
        structureRetries++;
        messages.push({ role: "assistant", content: answer.content });
        messages.push({
          role: "user",
          content:
            'Your answer does not have the same structure as "translate". Return the complete JSON object again with these corrected, and nothing else changed in structure:\n' +
            errors.map((e) => `- ${e}`).join("\n"),
        });
      }
    }

    if (errors.length > 0) throw new EngineError("structure_mismatch", { details: errors });

    for (const unit of chunk) {
      const value = readUnit(translated, unit);
      if (value === undefined) throw new EngineError("structure_mismatch", { details: [`${unit.path}: missing from the answer`] });
      values.set(unit.path, value);
    }
  };

  const limit = createLimiter(input.concurrency ?? 2);
  await Promise.all(chunks.map((chunk, index) => limit(() => runChunk(chunk, index))));

  return { values, slug, usage, servedBy: [...servedBy], structureRetries, requests: usage.requests };
}

/** The translator request for a whole document, as it would be sent. Used for the cost estimate. */
export function translatorRequestPreview(
  prompt: PromptContext,
  document: Json,
  units: readonly TranslationUnit[],
  slug?: string | null,
): { system: string; user: string } {
  const request: Json = {
    task: "translate",
    sourceLanguage: prompt.sourceLanguage.id,
    targetLanguage: prompt.targetLanguage.id,
    documentType: typeof document._type === "string" ? document._type : "",
  };
  if (slug) request.slug = slug;
  request.translate = buildPayload(document, units);
  return { system: translatorSystemPrompt(prompt), user: JSON.stringify(request) };
}
