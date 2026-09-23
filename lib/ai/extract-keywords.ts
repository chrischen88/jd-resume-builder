import "server-only";

import { checkEvidence } from "@/lib/analysis/evidence";
import type { ExtractedKeyword } from "@/lib/analysis/types";

import {
  callStructured,
  defaultGuardrailLogger,
  type AiGuardrailLogger,
  type CallOptions,
} from "./client";
import {
  extractKeywordsInput,
  extractKeywordsPrompt,
  type ExtractKeywordsOutput,
} from "./prompts/extract-keywords";

export interface JobExtraction {
  job: ExtractKeywordsOutput["job"];
  /** Keywords whose evidence was found verbatim in the JD. */
  keywords: ExtractedKeyword[];
  dropped: { quoteNotFound: number; phraseNotFound: number; empty: number; duplicates: number };
  promptVersion: string;
  usage: { input_tokens: number; output_tokens: number };
}

function cleanJob(job: ExtractKeywordsOutput["job"]): ExtractKeywordsOutput["job"] {
  const years = job.years_experience_min;
  return {
    company: job.company?.trim() || null,
    title: job.title?.trim() || null,
    seniority: job.seniority,
    years_experience_min: years !== null && Number.isFinite(years) && years >= 0 ? years : null,
  };
}

/**
 * Extracts keywords from one JD (SPEC §AI design 1) and drops any whose
 * evidence can't be found in the JD text. Pass the same normalized text
 * that is stored for the JD, since quotes are checked against it.
 */
export async function extractJobKeywords(
  jdText: string,
  options: CallOptions & { guardrailLogger?: AiGuardrailLogger } = {},
): Promise<JobExtraction> {
  const { data, usage } = await callStructured(
    extractKeywordsPrompt,
    extractKeywordsInput(jdText),
    options,
  );
  const check = checkEvidence(jdText, data.keywords);

  (options.guardrailLogger ?? defaultGuardrailLogger)({
    prompt_id: extractKeywordsPrompt.id,
    prompt_version: extractKeywordsPrompt.version,
    counts: {
      extracted: data.keywords.length,
      kept: check.kept.length,
      dropped_quote_not_found: check.droppedQuoteNotFound,
      dropped_phrase_not_found: check.droppedPhraseNotFound,
      dropped_empty: check.droppedEmpty,
      duplicates: check.duplicates,
    },
  });

  return {
    job: cleanJob(data.job),
    keywords: check.kept,
    dropped: {
      quoteNotFound: check.droppedQuoteNotFound,
      phraseNotFound: check.droppedPhraseNotFound,
      empty: check.droppedEmpty,
      duplicates: check.duplicates,
    },
    promptVersion: extractKeywordsPrompt.version,
    usage,
  };
}
