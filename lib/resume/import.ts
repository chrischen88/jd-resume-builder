import "server-only";

import type { ResumeParse } from "@/lib/ai/parse-resume";
import type { Library } from "@/lib/library";

import type { ParseIssue } from "./ground";
import type { ResumeStore } from "./store";

export class ResumeImportError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "not_resume",
  ) {
    super(message);
    this.name = "ResumeImportError";
  }
}

export interface ResumeImportDeps {
  library: Pick<Library, "get">;
  store: ResumeStore;
  parse: (text: string) => Promise<ResumeParse>;
}

export interface ResumeImport {
  resumeId: string;
  /** Parsed values not found in the resume text; the user confirms or fixes them (task 1.7). */
  issues: ParseIssue[];
}

/** Library resume document → parsed `Resume` with roles and bullets (TASKS 1.5). */
export async function importResumeDocument(
  { library, store, parse }: ResumeImportDeps,
  documentId: string,
): Promise<ResumeImport> {
  const document = await library.get(documentId);
  if (!document) throw new ResumeImportError("That document no longer exists.", "not_found");
  if (document.kind !== "resume") {
    throw new ResumeImportError(
      `“${document.title}” is a job description, not a resume.`,
      "not_resume",
    );
  }
  const { resume, issues } = await parse(document.text);
  const resumeId = await store.create(document, resume);
  return { resumeId, issues };
}
