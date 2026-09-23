import "server-only";

import { checkRewording, type RewordCandidate } from "@/lib/analysis/reword";

import {
  callStructured,
  defaultGuardrailLogger,
  type AiGuardrailLogger,
  type CallOptions,
} from "./client";
import { rewordBulletsInput, rewordBulletsPrompt } from "./prompts/reword-bullets";

export interface Rewording extends RewordCandidate {
  suggestion: string;
}

export interface RewordResult {
  /** Suggestions that passed checkRewording. */
  rewordings: Rewording[];
  promptVersion: string;
}

/**
 * Asks the model to reword each candidate bullet with its JD phrase (one
 * call), then keeps only suggestions that pass checkRewording. Returns an
 * empty list without calling the model when there are no candidates.
 */
export async function rewordBullets(
  candidates: RewordCandidate[],
  options: CallOptions & { guardrailLogger?: AiGuardrailLogger } = {},
): Promise<RewordResult> {
  const promptVersion = rewordBulletsPrompt.version;
  if (candidates.length === 0) return { rewordings: [], promptVersion };

  const items = candidates.map((c, i) => ({
    id: `b${i + 1}`,
    bullet: c.bulletText,
    skill: c.skillName,
    phrase: c.phrase,
  }));
  const { data } = await callStructured(rewordBulletsPrompt, rewordBulletsInput(items), options);
  const byId = new Map(data.items.map((item) => [item.id, item.suggestion]));

  const counts: Record<string, number> = { candidates: candidates.length, kept: 0, declined: 0 };
  const rewordings: Rewording[] = [];
  candidates.forEach((candidate, i) => {
    const suggestion = byId.get(items[i].id);
    if (!suggestion?.trim()) {
      counts.declined++;
      return;
    }
    const check = checkRewording(
      candidate.bulletText,
      suggestion,
      candidate.phrase,
      candidate.terms,
    );
    if (!check.ok) {
      counts[`dropped_${check.reason}`] = (counts[`dropped_${check.reason}`] ?? 0) + 1;
      return;
    }
    counts.kept++;
    rewordings.push({ ...candidate, suggestion: check.text });
  });

  (options.guardrailLogger ?? defaultGuardrailLogger)({
    prompt_id: rewordBulletsPrompt.id,
    prompt_version: promptVersion,
    counts,
  });
  return { rewordings, promptVersion };
}
