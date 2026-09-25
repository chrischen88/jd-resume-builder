"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AiOutputError } from "@/lib/ai/client";
import { acceptDraft, editDraft, getInterviewStore, InterviewError } from "@/lib/interview";

// Screen 5 (TASKS 1.16–1.21): each interview answer is saved as soon as it's
// given. Model steps run through POST /api/target-sets/:id/interview/step.

export type InterviewActionState = { error: string | null };

/** Longest free-text answer kept. */
const MAX_ANSWER_CHARS = 2000;
/** Longest edited bullet kept. */
const MAX_BULLET_CHARS = 400;

const gap = { targetSetId: z.uuid(), demandId: z.uuid() };

function read<T extends z.ZodRawShape>(shape: T, formData: FormData) {
  return z
    .object(shape)
    .safeParse(
      Object.fromEntries(Object.keys(shape).map((k) => [k, formData.get(k) ?? undefined])),
    );
}

async function run(
  targetSetId: string,
  work: () => Promise<unknown>,
): Promise<InterviewActionState> {
  try {
    await work();
  } catch (err) {
    if (err instanceof InterviewError) return { error: err.message };
    if (err instanceof AiOutputError) {
      return { error: `The model returned unusable output (${err.reason}). Try again.` };
    }
    console.error("Interview action failed", {
      error: err instanceof Error ? err.name : "unknown",
    });
    return { error: "Something went wrong saving that. Try again." };
  }
  revalidatePath(`/target-sets/${targetSetId}/interview`);
  revalidatePath(`/target-sets/${targetSetId}/gaps`);
  return { error: null };
}

const invalid = { error: "That didn't come through. Reload the page and try again." };

export async function answerGap(_: InterviewActionState, formData: FormData) {
  const p = read({ ...gap, response: z.enum(["yes", "somewhat", "no"]) }, formData);
  if (!p.success) return invalid;
  const { targetSetId, demandId, response } = p.data;
  return run(targetSetId, async () =>
    (await getInterviewStore()).answer(targetSetId, demandId, response),
  );
}

export async function chooseRole(_: InterviewActionState, formData: FormData) {
  const p = read({ ...gap, roleId: z.uuid("Pick a role.") }, formData);
  if (!p.success) return { error: p.error.issues[0].message };
  const { targetSetId, demandId, roleId } = p.data;
  return run(targetSetId, async () =>
    (await getInterviewStore()).chooseRole(targetSetId, demandId, roleId),
  );
}

export async function answerFollowUp(_: InterviewActionState, formData: FormData) {
  const p = read(
    {
      ...gap,
      answer: z
        .string()
        .max(MAX_ANSWER_CHARS, `Keep answers under ${MAX_ANSWER_CHARS} characters.`),
    },
    formData,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const { targetSetId, demandId, answer } = p.data;
  return run(targetSetId, async () =>
    (await getInterviewStore()).answerFollowUp(targetSetId, demandId, answer),
  );
}

export async function skipGap(_: InterviewActionState, formData: FormData) {
  const p = read(gap, formData);
  if (!p.success) return invalid;
  const { targetSetId, demandId } = p.data;
  return run(targetSetId, async () => (await getInterviewStore()).skip(targetSetId, demandId));
}

export async function undoGap(_: InterviewActionState, formData: FormData) {
  const p = read(gap, formData);
  if (!p.success) return invalid;
  const { targetSetId, demandId } = p.data;
  return run(targetSetId, async () => (await getInterviewStore()).undo(targetSetId, demandId));
}

const variant = { index: z.coerce.number().int().min(0).max(1) };

export async function acceptVariant(_: InterviewActionState, formData: FormData) {
  const p = read({ ...gap, ...variant }, formData);
  if (!p.success) return invalid;
  const { targetSetId, demandId, index } = p.data;
  const state = await run(targetSetId, () => acceptDraft(targetSetId, demandId, index));
  if (!state.error) revalidatePath(`/target-sets/${targetSetId}/strengths`);
  return state;
}

export async function editVariant(_: InterviewActionState, formData: FormData) {
  const p = read(
    {
      ...gap,
      ...variant,
      text: z
        .string()
        .trim()
        .min(1, "The bullet can't be empty.")
        .max(MAX_BULLET_CHARS, `Keep the bullet under ${MAX_BULLET_CHARS} characters.`),
    },
    formData,
  );
  if (!p.success) return { error: p.error.issues[0].message };
  const { targetSetId, demandId, index, text } = p.data;
  return run(targetSetId, () => editDraft(targetSetId, demandId, index, text));
}

export async function confirmDraftClaim(_: InterviewActionState, formData: FormData) {
  const p = read({ ...gap, ...variant, claim: z.string().min(1).max(500) }, formData);
  if (!p.success) return invalid;
  const { targetSetId, demandId, index, claim } = p.data;
  return run(targetSetId, async () =>
    (await getInterviewStore()).confirmClaim(targetSetId, demandId, index, claim),
  );
}

export async function confirmBulletClaim(_: InterviewActionState, formData: FormData) {
  const p = read(
    {
      targetSetId: z.uuid(),
      resumeId: z.uuid(),
      bulletId: z.uuid(),
      claim: z.string().min(1).max(500),
    },
    formData,
  );
  if (!p.success) return invalid;
  const { targetSetId, resumeId, bulletId, claim } = p.data;
  return run(targetSetId, async () =>
    (await getInterviewStore()).confirmBulletClaim(resumeId, bulletId, claim),
  );
}
