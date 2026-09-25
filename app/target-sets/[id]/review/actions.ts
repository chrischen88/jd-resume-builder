"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getReviewStore, ReviewError } from "@/lib/review";
import { getTargetSetStore } from "@/lib/target-sets";

// Screen 7 (task 1.26): inline edits on the review page. The inline editors
// call these bound to the target set and the thing being edited; the resume
// is always looked up from the set, never taken from the client.

export type SaveResult = { error: string | null };

const MAX_BULLET_CHARS = 1000;
const MAX_SUMMARY_CHARS = 2000;
const MAX_SKILL_LINE_CHARS = 500;

/** One line of text: the editors are single-paragraph, so collapse any stray line breaks. */
const line = (max: number, what: string) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `Keep the ${what} under ${max.toLocaleString()} characters.`));

async function run(
  targetSetId: unknown,
  work: (resumeId: string) => Promise<void>,
): Promise<SaveResult> {
  const id = z.uuid().safeParse(targetSetId);
  const set = id.success ? await (await getTargetSetStore()).get(id.data) : undefined;
  if (!set) return { error: "That target set no longer exists." };
  try {
    await work(set.resumeId);
  } catch (err) {
    if (err instanceof ReviewError) return { error: err.message };
    console.error("Review edit failed", { error: err instanceof Error ? err.name : "unknown" });
    return { error: "Something went wrong saving that. Try again." };
  }
  revalidatePath(`/target-sets/${set.id}/review`);
  revalidatePath(`/target-sets/${set.id}/interview`);
  return { error: null };
}

const firstIssue = (e: z.ZodError): SaveResult => ({ error: e.issues[0].message });

export async function saveBullet(
  targetSetId: string,
  bulletId: string,
  text: string,
): Promise<SaveResult> {
  const p = z
    .object({
      bulletId: z.uuid(),
      text: line(MAX_BULLET_CHARS, "bullet").pipe(
        z.string().min(1, "A bullet can't be empty. Remove it instead."),
      ),
    })
    .safeParse({ bulletId, text });
  if (!p.success) return firstIssue(p.error);
  return run(targetSetId, async (resumeId) =>
    (await getReviewStore()).editBullet(resumeId, p.data.bulletId, p.data.text),
  );
}

export async function saveSummary(targetSetId: string, text: string): Promise<SaveResult> {
  const p = line(MAX_SUMMARY_CHARS, "summary").safeParse(text);
  if (!p.success) return firstIssue(p.error);
  return run(targetSetId, async (resumeId) =>
    (await getReviewStore()).editSummary(resumeId, p.data),
  );
}

export async function saveSkillLine(
  targetSetId: string,
  index: number,
  previous: string,
  text: string,
): Promise<SaveResult> {
  const p = z
    .object({
      index: z.number().int().min(0),
      previous: z.string().max(MAX_SKILL_LINE_CHARS * 4),
      text: line(MAX_SKILL_LINE_CHARS, "line"),
    })
    .safeParse({ index, previous, text });
  if (!p.success) return firstIssue(p.error);
  return run(targetSetId, async (resumeId) =>
    (await getReviewStore()).editSkillLine(resumeId, p.data.index, p.data.previous, p.data.text),
  );
}

const bulletForm = z.object({ targetSetId: z.uuid(), bulletId: z.uuid() });

export async function removeBullet(_: SaveResult, formData: FormData): Promise<SaveResult> {
  const p = bulletForm.safeParse({
    targetSetId: formData.get("targetSetId"),
    bulletId: formData.get("bulletId"),
  });
  if (!p.success) return { error: "That didn't come through. Reload the page and try again." };
  return run(p.data.targetSetId, async (resumeId) =>
    (await getReviewStore()).removeGeneratedBullet(resumeId, p.data.bulletId),
  );
}

export async function resolveClaim(_: SaveResult, formData: FormData): Promise<SaveResult> {
  const p = bulletForm.extend({ claim: z.string().min(1).max(500) }).safeParse({
    targetSetId: formData.get("targetSetId"),
    bulletId: formData.get("bulletId"),
    claim: formData.get("claim"),
  });
  if (!p.success) return { error: "That didn't come through. Reload the page and try again." };
  return run(p.data.targetSetId, async (resumeId) =>
    (await getReviewStore()).resolveClaim(resumeId, p.data.bulletId, p.data.claim),
  );
}
