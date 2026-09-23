"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AiOutputError } from "@/lib/ai/client";
import { getResumeStore, importResume, ResumeImportError } from "@/lib/resume";

export type ImportState = { error: string | null };

/** Library resume → parsed resume, then open its review page. */
export async function importResumeAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const documentId = z.uuid().safeParse(formData.get("documentId"));
  if (!documentId.success) return { error: "Pick a resume from the library." };

  let resumeId: string;
  try {
    ({ resumeId } = await importResume(documentId.data));
  } catch (err) {
    if (err instanceof ResumeImportError) return { error: err.message };
    console.error("Resume import failed", {
      error: err instanceof Error ? err.name : "unknown",
      reason: err instanceof AiOutputError ? err.reason : undefined,
    });
    return {
      error:
        err instanceof AiOutputError
          ? `The model returned unusable output (${err.reason}). Try again.`
          : "The model call failed. Check your API key and connection, then try again.",
    };
  }
  revalidatePath("/resume");
  redirect(`/resume/${resumeId}`);
}

export type RoleFormState =
  { status: "idle" } | { status: "saved" } | { status: "error"; errors: string[] };

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((value) => value || null);

const roleSchema = z.object({
  employer: z.string().trim().min(1, "Employer is required.").max(200),
  title: z.string().trim().min(1, "Title is required.").max(200),
  location: optional(200),
  startDate: optional(50),
  endDate: optional(50),
  // One bullet per line; a leading bullet symbol is dropped.
  bullets: z
    .string()
    .max(20_000)
    .transform((text) =>
      text
        .split("\n")
        .map((line) => line.replace(/^\s*[-•*]\s+/, "").trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.string().max(1000, "Keep each bullet under 1,000 characters."))
        .max(50, "Up to 50 bullets per role."),
    ),
});

function readRole(formData: FormData) {
  return roleSchema.safeParse(
    Object.fromEntries(
      ["employer", "title", "location", "startDate", "endDate", "bullets"].map((key) => [
        key,
        formData.get(key) ?? "",
      ]),
    ),
  );
}

export async function saveRole(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const roleId = z.uuid().safeParse(formData.get("roleId"));
  const parsed = readRole(formData);
  if (!roleId.success) return { status: "error", errors: ["This role no longer exists."] };
  if (!parsed.success)
    return { status: "error", errors: parsed.error.issues.map((i) => i.message) };

  const { bullets, ...fields } = parsed.data;
  const store = await getResumeStore();
  const resumeId = await store.updateRole(roleId.data, fields, bullets);
  if (!resumeId) return { status: "error", errors: ["This role no longer exists."] };
  revalidatePath(`/resume/${resumeId}`);
  return { status: "saved" };
}

export async function addRole(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const resumeId = z.uuid().safeParse(formData.get("resumeId"));
  const parsed = readRole(formData);
  if (!resumeId.success) return { status: "error", errors: ["This resume no longer exists."] };
  if (!parsed.success)
    return { status: "error", errors: parsed.error.issues.map((i) => i.message) };

  const store = await getResumeStore();
  if (!(await store.get(resumeId.data))) {
    return { status: "error", errors: ["This resume no longer exists."] };
  }
  const { bullets, ...fields } = parsed.data;
  await store.addRole(resumeId.data, fields, bullets);
  revalidatePath(`/resume/${resumeId.data}`);
  return { status: "saved" };
}

export async function deleteRole(formData: FormData): Promise<void> {
  const roleId = z.uuid().parse(formData.get("roleId"));
  const resumeId = await (await getResumeStore()).removeRole(roleId);
  if (resumeId) revalidatePath(`/resume/${resumeId}`);
}

export async function confirmResume(formData: FormData): Promise<void> {
  const resumeId = z.uuid().parse(formData.get("resumeId"));
  await (await getResumeStore()).confirm(resumeId);
  revalidatePath(`/resume/${resumeId}`);
  revalidatePath("/resume");
}

export async function deleteResume(formData: FormData): Promise<void> {
  const resumeId = z.uuid().parse(formData.get("resumeId"));
  await (await getResumeStore()).remove(resumeId);
  revalidatePath("/resume");
  redirect("/resume");
}
