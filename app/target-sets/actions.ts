"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AiOutputError } from "@/lib/ai/client";
import { getLibrary } from "@/lib/library";
import {
  ensureNotAnalyzing,
  getGapStore,
  getSuggestionStore,
  getTargetSetStore,
  MAX_JOBS,
  suggestRewordings,
  TargetSetError,
} from "@/lib/target-sets";

// Screen 2 (TASKS 1.11): create a target set, pick its JDs from the library,
// rename or delete it. Analysis itself runs through POST /api/target-sets/:id/analyze.
// Screen 3 (TASKS 1.14): ask for rewording suggestions, accept or ignore them.
// Screen 4 (TASKS 1.15): reorder and dismiss gaps.

export type FormState = { error: string | null };

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the set a name.")
  .max(100, "Keep the name under 100 characters.");

function revalidateSet(id: string) {
  revalidatePath(`/target-sets/${id}`);
  revalidatePath(`/target-sets/${id}/strengths`);
  revalidatePath("/target-sets");
}

export async function createTargetSet(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({ name: nameSchema, resumeId: z.uuid("Pick a resume.") })
    .safeParse({ name: formData.get("name") ?? "", resumeId: formData.get("resumeId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let id: string;
  try {
    id = await (await getTargetSetStore()).create(parsed.data);
  } catch (err) {
    if (err instanceof TargetSetError) return { error: err.message };
    throw err;
  }
  revalidatePath("/target-sets");
  redirect(`/target-sets/${id}`);
}

export type AddJobsState =
  | { status: "idle" }
  | { status: "done"; added: string[]; alreadyInSet: string[] }
  | { status: "error"; error: string };

export async function addJobs(_previous: AddJobsState, formData: FormData): Promise<AddJobsState> {
  const parsed = z
    .object({
      targetSetId: z.uuid(),
      documentIds: z
        .array(z.uuid())
        .min(1, "Pick at least one job description.")
        .max(MAX_JOBS, `A target set holds up to ${MAX_JOBS} job descriptions.`),
    })
    .safeParse({
      targetSetId: formData.get("targetSetId"),
      documentIds: formData.getAll("documentId"),
    });
  if (!parsed.success) return { status: "error", error: parsed.error.issues[0].message };
  const { targetSetId, documentIds } = parsed.data;

  const library = await getLibrary();
  const docs = await Promise.all(documentIds.map((id) => library.get(id)));
  if (docs.some((d) => !d)) {
    return {
      status: "error",
      error: "One of those job descriptions was deleted. Reload the page.",
    };
  }
  try {
    await ensureNotAnalyzing(targetSetId);
    const result = await (await getTargetSetStore()).addJobs(targetSetId, docs.filter((d) => !!d));
    revalidateSet(targetSetId);
    return { status: "done", ...result };
  } catch (err) {
    if (err instanceof TargetSetError) return { status: "error", error: err.message };
    throw err;
  }
}

export async function removeJob(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ targetSetId: z.uuid(), jobId: z.uuid() })
    .safeParse({ targetSetId: formData.get("targetSetId"), jobId: formData.get("jobId") });
  if (!parsed.success) return { error: "That job description is no longer in this set." };
  try {
    await ensureNotAnalyzing(parsed.data.targetSetId);
  } catch (err) {
    if (err instanceof TargetSetError) return { error: err.message };
    throw err;
  }
  await (await getTargetSetStore()).removeJob(parsed.data.targetSetId, parsed.data.jobId);
  revalidateSet(parsed.data.targetSetId);
  return { error: null };
}

export async function renameTargetSet(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({ targetSetId: z.uuid(), name: nameSchema })
    .safeParse({ targetSetId: formData.get("targetSetId"), name: formData.get("name") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const renamed = await (await getTargetSetStore()).rename(
    parsed.data.targetSetId,
    parsed.data.name,
  );
  if (!renamed) return { error: "That target set no longer exists." };
  revalidateSet(parsed.data.targetSetId);
  return { error: null };
}

export async function deleteTargetSet(formData: FormData): Promise<void> {
  const id = z.uuid().parse(formData.get("targetSetId"));
  // The page hides Delete while analyzing; this only catches a stale page.
  await ensureNotAnalyzing(id);
  await (await getTargetSetStore()).remove(id);
  revalidatePath("/target-sets");
  redirect("/target-sets");
}

export type SuggestState =
  | { status: "idle" }
  | { status: "done"; candidates: number; added: number }
  | { status: "error"; error: string };

/** Asks the model to reword bullets that show a skill in other words (one call). */
export async function requestSuggestions(
  _previous: SuggestState,
  formData: FormData,
): Promise<SuggestState> {
  const id = z.uuid().safeParse(formData.get("targetSetId"));
  if (!id.success) return { status: "error", error: "That target set no longer exists." };
  try {
    await ensureNotAnalyzing(id.data);
    const result = await suggestRewordings(id.data);
    if (!result) return { status: "error", error: "That target set no longer exists." };
    revalidatePath(`/target-sets/${id.data}/strengths`);
    return { status: "done", ...result };
  } catch (err) {
    if (err instanceof TargetSetError) return { status: "error", error: err.message };
    // Error name and reason only; never bullet text.
    console.error("Rewording suggestions failed", {
      error: err instanceof Error ? err.name : "unknown",
      reason: err instanceof AiOutputError ? err.reason : undefined,
    });
    return {
      status: "error",
      error:
        err instanceof AiOutputError
          ? `The model returned unusable output (${err.reason}). Try again.`
          : "The model call failed. Check your API key and connection, then try again.",
    };
  }
}

const suggestionFields = z.object({ targetSetId: z.uuid(), suggestionId: z.uuid() });

function readSuggestion(formData: FormData) {
  return suggestionFields.safeParse({
    targetSetId: formData.get("targetSetId"),
    suggestionId: formData.get("suggestionId"),
  });
}

/** Writes a suggestion into its bullet. The only way a rewording reaches the resume. */
export async function acceptSuggestion(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = readSuggestion(formData);
  if (!parsed.success) return { error: "That suggestion no longer exists." };
  const result = await (await getSuggestionStore()).accept(parsed.data.suggestionId);
  revalidateSet(parsed.data.targetSetId);
  if (result === "stale") {
    return { error: "This bullet was edited since the suggestion was made, so it wasn't changed." };
  }
  if (result === "not_found") return { error: "That suggestion no longer exists." };
  return { error: null };
}

export async function dismissSuggestion(formData: FormData): Promise<void> {
  const parsed = readSuggestion(formData);
  if (!parsed.success) return;
  await (await getSuggestionStore()).dismiss(parsed.data.suggestionId);
  revalidatePath(`/target-sets/${parsed.data.targetSetId}/strengths`);
}

const gapFields = z.object({ targetSetId: z.uuid(), demandId: z.uuid() });

function fields(formData: FormData, names: string[]) {
  return Object.fromEntries(names.map((name) => [name, formData.get(name)]));
}

/** Moves a gap to the top, up, or down in the interview order. */
export async function moveGap(formData: FormData): Promise<void> {
  const parsed = gapFields
    .extend({ direction: z.enum(["top", "up", "down"]) })
    .safeParse(fields(formData, ["targetSetId", "demandId", "direction"]));
  if (!parsed.success) return;
  const { targetSetId, demandId, direction } = parsed.data;
  await (await getGapStore()).move(targetSetId, demandId, direction);
  revalidatePath(`/target-sets/${targetSetId}/gaps`);
}

/** Leaves a gap out of the interview, or brings it back. */
export async function setGapDismissed(formData: FormData): Promise<void> {
  const parsed = gapFields
    .extend({ dismissed: z.enum(["true", "false"]).transform((v) => v === "true") })
    .safeParse(fields(formData, ["targetSetId", "demandId", "dismissed"]));
  if (!parsed.success) return;
  const { targetSetId, demandId, dismissed } = parsed.data;
  await (await getGapStore()).setDismissed(targetSetId, demandId, dismissed);
  revalidatePath(`/target-sets/${targetSetId}/gaps`);
}
