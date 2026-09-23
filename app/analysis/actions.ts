"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { AiOutputError } from "@/lib/ai/client";
import { ensureExtractions, getLibrary } from "@/lib/library";

export type AnalyzeState = { error: string | null };

const MAX_JDS = 20;

const analyzeSchema = z.object({
  resume: z.uuid("Pick a resume."),
  jds: z
    .array(z.uuid())
    .min(1, "Pick at least one job description.")
    .max(MAX_JDS, `Pick at most ${MAX_JDS} job descriptions.`),
});

/** Extracts keywords for any selected JD not yet cached, then shows the table. */
export async function analyze(_previous: AnalyzeState, formData: FormData): Promise<AnalyzeState> {
  const parsed = analyzeSchema.safeParse({
    resume: formData.get("resume") ?? undefined,
    jds: formData.getAll("jd"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { resume, jds } = parsed.data;

  const library = await getLibrary();
  const docs = await library.list("jd");
  const selected = docs.filter((d) => jds.includes(d.id));
  if (selected.length !== new Set(jds).size || !(await library.get(resume))) {
    return { error: "Some selected documents no longer exist. Reload and try again." };
  }

  try {
    await ensureExtractions(selected);
  } catch (err) {
    console.error("Keyword extraction failed", {
      error: err instanceof Error ? err.name : "unknown",
      promptId: err instanceof AiOutputError ? err.promptId : undefined,
    });
    const reason =
      err instanceof AiOutputError
        ? `the model returned unusable output (${err.reason})`
        : "the model call failed";
    return {
      error: `Keyword extraction stopped: ${reason}. JDs that finished are saved; try again to continue.`,
    };
  }

  const params = new URLSearchParams({ resume });
  for (const id of jds) params.append("jd", id);
  redirect(`/analysis?${params}`);
}
