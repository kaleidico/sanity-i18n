/**
 * Check 2, the reviewer: a second, separate model call that reads the source
 * and the translation side by side and reports meaning drift, omissions,
 * additions, tone, terminology and legal wording for a person to look at.
 */
import type { CallUsage, ReviewIssue } from "../core/engineModel";
import type { UnitPair } from "../core/payload";
import { callModel, parseJsonObject, type AnthropicLike, type CallPolicy, type Effort } from "./anthropic";
import { REVIEW_SCHEMA, reviewerSystemPrompt, type PromptContext } from "./prompts";
import { createLimiter } from "./retry";

const SEVERITIES = ["high", "medium", "low"] as const;
const CATEGORIES = ["meaning", "omission", "addition", "tone", "terminology", "legal"] as const;

/** Characters of source and translation per reviewer request. */
export const DEFAULT_REVIEW_CHARS_PER_REQUEST = 40_000;

/**
 * Read the reviewer's answer. Anything that is not a well-formed issue is
 * dropped rather than trusted; an unknown severity is treated as medium so a
 * malformed answer can never clear a document by accident, and `ok` is false
 * when the answer could not be read at all.
 */
export function parseReviewerResponse(text: string, knownPaths?: ReadonlySet<string>): { ok: boolean; issues: ReviewIssue[] } {
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.issues)) return { ok: false, issues: [] };

  const issues: ReviewIssue[] = [];
  for (const raw of parsed.issues) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const note = typeof r.note === "string" ? r.note.trim() : "";
    if (note === "") continue;
    const path = typeof r.path === "string" ? r.path.trim() : "";
    const severityRaw = typeof r.severity === "string" ? r.severity.toLowerCase().trim() : "";
    const categoryRaw = typeof r.category === "string" ? r.category.toLowerCase().trim() : "";
    const severity = (SEVERITIES as readonly string[]).includes(severityRaw) ? (severityRaw as ReviewIssue["severity"]) : "medium";
    const category = (CATEGORIES as readonly string[]).includes(categoryRaw) ? (categoryRaw as ReviewIssue["category"]) : "meaning";
    issues.push({
      // An issue about a path that was not in the request is kept, marked, so a person still sees it.
      path: knownPaths && path !== "" && !knownPaths.has(path) ? `${path} (path not recognised)` : path,
      severity,
      category,
      note: note.slice(0, 1000),
    });
  }
  return { ok: true, issues };
}

export interface ReviewInput {
  client: AnthropicLike;
  model: string;
  effort?: Effort;
  prompt: PromptContext;
  pairs: readonly UnitPair[];
  legalPaths: readonly string[];
  maxCharsPerRequest?: number;
  concurrency?: number;
  policy?: CallPolicy;
}

export interface ReviewResult {
  /** False when there is a high severity issue, or an answer could not be read. */
  passed: boolean;
  issues: ReviewIssue[];
  usage: CallUsage;
  servedBy: string[];
  /** True when every reviewer answer could be read. */
  readable: boolean;
}

export function reviewerRequest(prompt: PromptContext, pairs: readonly UnitPair[], legalPaths: readonly string[]): string {
  const paths = new Set(pairs.map((p) => p.path));
  return JSON.stringify({
    task: "review",
    sourceLanguage: prompt.sourceLanguage.id,
    targetLanguage: prompt.targetLanguage.id,
    legalPaths: legalPaths.filter((p) => paths.has(p) || [...paths].some((known) => known.startsWith(p))),
    items: pairs.map((p) => ({ path: p.path, source: p.source, translation: p.translated })),
  });
}

export async function reviewTranslation(input: ReviewInput): Promise<ReviewResult> {
  const usage: CallUsage = { model: input.model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  if (input.pairs.length === 0) return { passed: true, issues: [], usage, servedBy: [], readable: true };

  const max = input.maxCharsPerRequest ?? DEFAULT_REVIEW_CHARS_PER_REQUEST;
  const chunks: UnitPair[][] = [];
  let current: UnitPair[] = [];
  let size = 0;
  for (const pair of input.pairs) {
    const length = pair.source.length + pair.translated.length;
    if (current.length > 0 && size + length > max) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(pair);
    size += length;
  }
  if (current.length > 0) chunks.push(current);

  const system = reviewerSystemPrompt(input.prompt);
  const issues: ReviewIssue[] = [];
  const servedBy = new Set<string>();
  let readable = true;

  const limit = createLimiter(input.concurrency ?? 2);
  await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const answer = await callModel(
          input.client,
          {
            model: input.model,
            system,
            messages: [{ role: "user", content: reviewerRequest(input.prompt, chunk, input.legalPaths) }],
            effort: input.effort,
            jsonSchema: REVIEW_SCHEMA,
          },
          input.policy,
        );
        usage.requests++;
        usage.inputTokens += answer.usage.inputTokens;
        usage.outputTokens += answer.usage.outputTokens;
        usage.cacheReadTokens += answer.usage.cacheReadTokens;
        usage.cacheWriteTokens += answer.usage.cacheWriteTokens;
        servedBy.add(answer.servedBy);

        const result = parseReviewerResponse(answer.text, new Set(chunk.map((p) => p.path)));
        if (!result.ok) readable = false;
        issues.push(...result.issues);
      }),
    ),
  );

  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { passed: readable && !issues.some((i) => i.severity === "high"), issues, usage, servedBy: [...servedBy], readable };
}
