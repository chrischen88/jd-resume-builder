import "server-only";

import { quoteFound, unsupportedNumbers } from "@/lib/interview/checks";

import {
  AiOutputError,
  callStructured,
  defaultGuardrailLogger,
  type AiGuardrailLogger,
  type CallOptions,
} from "./client";
import { checkClaimsInput, checkClaimsPrompt } from "./prompts/check-claims";
import {
  followUpQuestionInput,
  followUpQuestionPrompt,
  type FollowUpContext,
} from "./prompts/follow-up-question";
import {
  writeBulletInput,
  writeBulletPrompt,
  type WriteBulletContext,
  type WriteBulletOutput,
} from "./prompts/write-bullet";

// Model calls for the gap interview (tasks 1.17–1.19). Each validates and
// cleans what the model returns; nothing here writes to the database.

type Options = CallOptions & { guardrailLogger?: AiGuardrailLogger };

/** Longest follow-up question kept. */
const MAX_QUESTION_CHARS = 300;

/** The next follow-up, or null when the model says the answers are enough. */
export async function askFollowUp(ctx: FollowUpContext, options: Options = {}) {
  const { data } = await callStructured(
    followUpQuestionPrompt,
    followUpQuestionInput(ctx),
    options,
  );
  const question = data.question?.trim().replace(/\s+/g, " ") ?? "";
  if (data.done || !question) return { question: null };
  return { question: question.slice(0, MAX_QUESTION_CHARS) };
}

export interface DraftOutput {
  variants: { text: string; claims: string[] }[];
  evidence: WriteBulletOutput["evidence"];
  promptVersion: string;
}

/** Two bullet versions from the answers (at least one, or it throws). */
export async function writeBullet(ctx: WriteBulletContext, options: Options = {}) {
  const { data } = await callStructured(writeBulletPrompt, writeBulletInput(ctx), options);
  const variants = data.variants
    .map((v) => ({
      text: v.text.trim().replace(/^[•\-*]\s*/, "").replace(/\s+/g, " "),
      claims: v.claims.map((c) => c.trim()).filter(Boolean),
    }))
    .filter((v) => v.text)
    .slice(0, 2);
  if (variants.length === 0) {
    throw new AiOutputError("No bullet text returned", writeBulletPrompt.id, "invalid_output");
  }
  return {
    variants,
    evidence: data.evidence,
    promptVersion: writeBulletPrompt.version,
  } satisfies DraftOutput;
}

export interface ClaimCheck {
  claims: string[];
  /** Claims the sources don't back; these block export until confirmed. */
  unverified: string[];
}

/**
 * Checks a bullet's claims against the sources (answers and resume). A claim
 * counts as supported only if the model marks it so and its quote really is
 * in the sources; a number the user never gave is always unverified.
 */
export async function checkClaims(
  bullet: string,
  claims: string[],
  sources: string[],
  options: Options = {},
): Promise<ClaimCheck> {
  const { data } = await callStructured(
    checkClaimsPrompt,
    checkClaimsInput(bullet, claims, sources),
    options,
  );
  const checked = data.claims
    .map((c) => ({ ...c, claim: c.claim.trim() }))
    .filter((c) => c.claim);
  const unverified = checked
    .filter((c) => !c.supported || !quoteFound(c.support_quote, sources))
    .map((c) => c.claim);
  const numbers = unsupportedNumbers(bullet, sources).map(
    (n) => `The number ${n} isn't in your answers`,
  );

  (options.guardrailLogger ?? defaultGuardrailLogger)({
    prompt_id: checkClaimsPrompt.id,
    prompt_version: checkClaimsPrompt.version,
    counts: {
      claims: checked.length,
      unsupported_by_model: checked.filter((c) => !c.supported).length,
      quote_not_found: checked.filter((c) => c.supported && !quoteFound(c.support_quote, sources))
        .length,
      unsupported_numbers: numbers.length,
    },
  });
  return {
    claims: checked.map((c) => c.claim),
    unverified: [...new Set([...unverified, ...numbers])],
  };
}
