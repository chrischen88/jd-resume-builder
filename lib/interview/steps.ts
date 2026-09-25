import "server-only";

import type { DraftVariant, GapDraft } from "@/db/schema";
import type { ClaimCheck, DraftOutput } from "@/lib/ai/interview";
import type { FollowUpContext } from "@/lib/ai/prompts/follow-up-question";
import type { WriteBulletContext } from "@/lib/ai/prompts/write-bullet";

import {
  asksForMissingNumber,
  bulletPhrase,
  isCurrentRole,
  keywordsHit,
  repeatsQuestion,
} from "./checks";
import { answeredFollowUps, gapStage, MIN_FOLLOW_UPS } from "./state";
import { InterviewError, roleLabel, type InterviewStore } from "./store";

// The interview's model steps (tasks 1.17–1.19): ask the next follow-up, or
// write the bullet and check its claims. Run when a gap is waiting on the
// model; progress goes to `emit` (streamed to the page as SSE).

export interface InterviewAi {
  askFollowUp(ctx: FollowUpContext): Promise<{ question: string | null }>;
  writeBullet(ctx: WriteBulletContext): Promise<DraftOutput>;
  checkClaims(bullet: string, claims: string[], sources: string[]): Promise<ClaimCheck>;
}

export type StepEvent =
  | { type: "status"; message: string }
  | { type: "question"; question: string }
  | { type: "draft" };

/**
 * Questions used when the model stops before MIN_FOLLOW_UPS: the two facts
 * every bullet needs.
 */
export function fallbackQuestion(skill: string, response: "yes" | "somewhat", asked: number) {
  if (asked === 0) {
    return response === "somewhat"
      ? `What's the closest you've come to ${skill} in that role, and what was your part in it?`
      : `What did you do with ${skill} in that role? Describe one specific piece of work.`;
  }
  return (
    "How big was it, or what came of it? A number helps if you know one " +
    "(people, users, time saved); say so if you don't."
  );
}

// One step per gap at a time, so two tabs don't both call the model.
const running = new Set<string>();

/** The user's answers and resume, as the claim check's sources. */
function claimSources(
  ctx: Awaited<ReturnType<InterviewStore["stepContext"]>>,
): string[] {
  return [
    ...(ctx.role ? [roleLabel(ctx.role)] : []),
    ...ctx.answer.followUps
      .filter((f) => f.answer)
      .map((f) => `${f.question} ${f.answer}`),
    ...ctx.roleBullets,
  ];
}

/** Claim-checks one bullet text and fills in keywords_hit. */
export async function checkVariant(
  ai: InterviewAi,
  ctx: Awaited<ReturnType<InterviewStore["stepContext"]>>,
  text: string,
  claims: string[],
): Promise<DraftVariant> {
  const check = await ai.checkClaims(text, claims, claimSources(ctx));
  return {
    text,
    keywordsHit: keywordsHit(text, [
      { name: ctx.gap.name, terms: ctx.jdPhrases },
      ...ctx.otherSkills.map((name) => ({ name, terms: [] })),
    ]),
    claims: check.claims,
    unverifiedClaims: check.unverified,
  };
}

/**
 * Does whatever the gap is waiting on: asks the next question, or writes and
 * checks the drafts. `regenerate` rewrites existing drafts. Returns without a
 * model call when the gap isn't waiting on the model.
 */
export async function runStep(
  store: InterviewStore,
  ai: InterviewAi,
  targetSetId: string,
  demandId: string,
  emit: (event: StepEvent) => void,
  { regenerate = false }: { regenerate?: boolean } = {},
): Promise<void> {
  if (running.has(demandId)) {
    throw new InterviewError("Already working on this one.", "wrong_stage");
  }
  running.add(demandId);
  try {
    const ctx = await store.stepContext(targetSetId, demandId);
    const stage = gapStage(ctx.answer);
    const response = ctx.answer.response as "yes" | "somewhat";
    const answers = ctx.answer.followUps
      .filter((f) => f.answer !== null)
      .map((f) => ({ question: f.question, answer: f.answer ?? "" }));

    if (stage === "needs_question") {
      const asked = answeredFollowUps(ctx.answer);
      emit({ type: "status", message: "Thinking of the next question…" });
      const { question: proposed } = await ai.askFollowUp({
        skill: ctx.gap.name,
        category: ctx.gap.category,
        response,
        role: ctx.role ? roleLabel(ctx.role) : "",
        jdSentences: ctx.gap.sources.map((s) => s.quote),
        followUps: answers,
      });
      // A repeated question, or one asking for a number the user said they
      // don't have, counts as "enough".
      const question =
        proposed &&
        !repeatsQuestion(proposed, answers.map((a) => a.question)) &&
        !asksForMissingNumber(proposed, answers.map((a) => a.answer))
          ? proposed
          : null;
      const fallback =
        asked < MIN_FOLLOW_UPS ? fallbackQuestion(ctx.gap.name, response, asked) : null;
      const next = question ?? fallback;
      if (next) {
        await store.saveQuestion(targetSetId, demandId, next);
        emit({ type: "question", question: next });
        return;
      }
      // The model has enough: go on to the draft.
    } else if (stage !== "needs_draft" && !(stage === "draft" && regenerate)) {
      return;
    }

    emit({ type: "status", message: "Writing two versions of the bullet…" });
    const written = await ai.writeBullet({
      skill: ctx.gap.name,
      phrase: bulletPhrase(ctx.gap.name, ctx.jdPhrases, ctx.resumeText),
      response,
      role: ctx.role ? roleLabel(ctx.role) : "",
      currentRole: isCurrentRole(ctx.role?.endDate ?? null),
      seniority: ctx.seniority,
      otherSkills: ctx.otherSkills,
      answers,
    });
    emit({ type: "status", message: "Checking every claim against your answers…" });
    const variants = await Promise.all(
      written.variants.map((v) => checkVariant(ai, ctx, v.text, v.claims)),
    );
    const draft: GapDraft = {
      variants,
      evidence: written.evidence,
      promptVersion: written.promptVersion,
    };
    await store.saveDraft(targetSetId, demandId, draft);
    emit({ type: "draft" });
  } finally {
    running.delete(demandId);
  }
}
