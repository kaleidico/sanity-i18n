/**
 * The cost estimate shown before a bulk run. Token counts come from
 * Anthropic's token counting endpoint when the site's key is available, and
 * from a fixed characters-per-token ratio when it is not. Either way the
 * figure is an estimate: the real usage of every run is recorded on its job.
 *
 * How the figure is put together, per document:
 *
 *   translator input  = the system prompt + the payload, counted
 *   translator output = payload tokens x TRANSLATION_OUTPUT_FACTOR
 *   reviewer input    = the reviewer prompt + the items x REVIEW_INPUT_FACTOR
 *   reviewer output   = REVIEW_OUTPUT_TOKENS
 *
 * and each side is multiplied by the published rate of its model.
 */
import type { CostEstimate, Glossary, StyleGuide } from "../core/engineModel";
import { DEFAULT_STYLE_GUIDE } from "../core/engineModel";
import type { Language } from "../core/languages";
import type { FieldManifest } from "../core/manifest";
import { extractUnits, unitCharacters, unitPairs, unitStrings, type UnitValue } from "../core/payload";
import {
  CHARS_PER_TOKEN,
  costOf,
  DEFAULT_REVIEWER_MODEL,
  DEFAULT_TRANSLATOR_MODEL,
  RATES_AS_OF,
  REVIEW_INPUT_FACTOR,
  REVIEW_OUTPUT_TOKENS,
  TRANSLATION_OUTPUT_FACTOR,
} from "../core/pricing";
import { reviewerSystemPrompt, translatorSystemPrompt, type PromptContext } from "./prompts";
import { reviewerRequest } from "./review";
import { createLimiter } from "./retry";
import { translatorRequestPreview } from "./translate";

type Json = Record<string, unknown>;

/** Counts the input tokens of a request. The engine passes one backed by Anthropic's endpoint. */
export type TokenCounter = (request: { model: string; system: string; user: string }) => Promise<number>;

export interface EstimateCostInput {
  /** The source documents to estimate. */
  documents: readonly Json[];
  /** The language to translate into. */
  language: Language;
  sourceLanguage?: Language;
  manifest: FieldManifest;
  models?: { translatorModel?: string; reviewerModel?: string };
  glossary?: Glossary;
  styleGuide?: StyleGuide;
  /** When given, tokens are counted rather than estimated from characters. */
  countTokens?: TokenCounter;
  /** Above this many documents a sample is counted and the rest are scaled from it. Defaults to 20. */
  sampleSize?: number;
  concurrency?: number;
}

export function tokensFromCharacters(characters: number): number {
  return Math.ceil(characters / CHARS_PER_TOKEN);
}

interface DocumentFigures {
  strings: number;
  characters: number;
  translatorUser: string;
  reviewerUser: string;
}

export async function estimateCost(input: EstimateCostInput): Promise<CostEstimate> {
  const translatorModel = input.models?.translatorModel || DEFAULT_TRANSLATOR_MODEL;
  const reviewerModel = input.models?.reviewerModel || DEFAULT_REVIEWER_MODEL;
  const prompt: PromptContext = {
    sourceLanguage: input.sourceLanguage ?? { id: input.manifest.defaultLanguage, title: "English" },
    targetLanguage: input.language,
    glossary: input.glossary ?? { doNotTranslate: [], terms: [] },
    styleGuide: input.styleGuide ?? DEFAULT_STYLE_GUIDE,
  };
  const translatorSystem = translatorSystemPrompt(prompt);
  const reviewerSystem = reviewerSystemPrompt(prompt);

  const figures: DocumentFigures[] = [];
  for (const document of input.documents) {
    const units = extractUnits(document, input.manifest);
    if (units.length === 0) continue;
    const slugField = input.manifest.documents[String(document._type)]?.slugField;
    const slug = slugField ? (document[slugField] as { current?: string } | undefined)?.current : undefined;
    const preview = translatorRequestPreview(prompt, document, units, slug);
    // The reviewer sees each source string next to its translation. The
    // translation does not exist yet, so the source stands in for it.
    const pairs = units.flatMap((unit) => unitPairs(unit, unit.value as UnitValue));
    figures.push({
      strings: unitStrings(units),
      characters: unitCharacters(units),
      translatorUser: preview.user,
      reviewerUser: reviewerRequest(prompt, pairs.map((p) => ({ ...p, translated: "" })), []),
    });
  }

  const documents = figures.length;
  const strings = figures.reduce((n, f) => n + f.strings, 0);
  const characters = figures.reduce((n, f) => n + f.characters, 0);

  // Tokens per document: the translator's request body and the reviewer's items.
  const translatorUserTokens: number[] = figures.map((f) => tokensFromCharacters(f.translatorUser.length));
  const reviewerUserTokens: number[] = figures.map((f) => tokensFromCharacters(f.reviewerUser.length));
  let translatorSystemTokens = tokensFromCharacters(translatorSystem.length);
  let reviewerSystemTokens = tokensFromCharacters(reviewerSystem.length);
  let method: CostEstimate["method"] = "characters";
  let counted = 0;

  if (input.countTokens && documents > 0) {
    const count = input.countTokens;
    const sampleSize = Math.max(1, input.sampleSize ?? 20);
    const sample =
      documents <= sampleSize
        ? figures.map((_, i) => i)
        : Array.from({ length: sampleSize }, (_, i) => Math.floor((i * documents) / sampleSize));
    const limit = createLimiter(input.concurrency ?? 4);

    // A request cannot be empty, so each prompt is counted with a one-character message.
    const [tSystem, rSystem] = await Promise.all([
      limit(() => count({ model: translatorModel, system: translatorSystem, user: "." })),
      limit(() => count({ model: reviewerModel, system: reviewerSystem, user: "." })),
    ]);
    translatorSystemTokens = tSystem;
    reviewerSystemTokens = rSystem;

    let sampledCharsT = 0;
    let sampledTokensT = 0;
    let sampledCharsR = 0;
    let sampledTokensR = 0;
    await Promise.all(
      sample.map((index) =>
        limit(async () => {
          const f = figures[index];
          const [t, r] = await Promise.all([
            count({ model: translatorModel, system: translatorSystem, user: f.translatorUser }),
            count({ model: reviewerModel, system: reviewerSystem, user: f.reviewerUser }),
          ]);
          translatorUserTokens[index] = Math.max(0, t - tSystem);
          reviewerUserTokens[index] = Math.max(0, r - rSystem);
          sampledCharsT += f.translatorUser.length;
          sampledTokensT += translatorUserTokens[index];
          sampledCharsR += f.reviewerUser.length;
          sampledTokensR += reviewerUserTokens[index];
        }),
      ),
    );
    counted = sample.length;
    method = counted === documents ? "counted" : "sampled";

    if (method === "sampled") {
      const inSample = new Set(sample);
      const ratioT = sampledCharsT > 0 ? sampledTokensT / sampledCharsT : 1 / CHARS_PER_TOKEN;
      const ratioR = sampledCharsR > 0 ? sampledTokensR / sampledCharsR : 1 / CHARS_PER_TOKEN;
      figures.forEach((f, i) => {
        if (inSample.has(i)) return;
        translatorUserTokens[i] = Math.ceil(f.translatorUser.length * ratioT);
        reviewerUserTokens[i] = Math.ceil(f.reviewerUser.length * ratioR);
      });
    }
  }

  let translatorInput = 0;
  let translatorOutput = 0;
  let reviewerInput = 0;
  let reviewerOutput = 0;
  for (let i = 0; i < documents; i++) {
    translatorInput += translatorSystemTokens + translatorUserTokens[i];
    translatorOutput += Math.ceil(translatorUserTokens[i] * TRANSLATION_OUTPUT_FACTOR);
    reviewerInput += reviewerSystemTokens + Math.ceil(reviewerUserTokens[i] * REVIEW_INPUT_FACTOR);
    reviewerOutput += REVIEW_OUTPUT_TOKENS;
  }

  const costUsd =
    costOf({ inputTokens: translatorInput, outputTokens: translatorOutput }, translatorModel) +
    costOf({ inputTokens: reviewerInput, outputTokens: reviewerOutput }, reviewerModel);

  const note =
    method === "counted"
      ? "Input tokens were counted by Anthropic for every document. Output is estimated."
      : method === "sampled"
        ? `Input tokens were counted by Anthropic for a sample of ${counted} document(s) and scaled to the rest. Output is estimated.`
        : `No API key was available, so tokens are estimated at ${CHARS_PER_TOKEN} characters per token. Save a key for a counted figure.`;

  return {
    documents,
    strings,
    characters,
    inputTokens: translatorInput + reviewerInput,
    outputTokens: translatorOutput + reviewerOutput,
    costUsd: Math.round(costUsd * 10_000) / 10_000,
    translatorModel,
    reviewerModel,
    ratesAsOf: RATES_AS_OF,
    method,
    counted,
    note,
  };
}
