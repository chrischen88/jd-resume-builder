import "server-only";

import { getDb } from "@/db/client";
import { parseResumeText } from "@/lib/ai/parse-resume";
import { getLibrary } from "@/lib/library";

import { importResumeDocument, type ResumeImport } from "./import";
import { createResumeStore, type ResumeStore } from "./store";

export { ResumeImportError } from "./import";
export type { ResumeImport } from "./import";
export type { ParseIssue, ParsedResume, ParsedRole } from "./ground";
export type { ResumeDetail, RoleWithBullets } from "./store";

export async function getResumeStore(): Promise<ResumeStore> {
  return createResumeStore({ db: await getDb() });
}

/** Parses a library resume with the configured model and saves it. */
export async function importResume(documentId: string): Promise<ResumeImport> {
  return importResumeDocument(
    {
      library: await getLibrary(),
      store: await getResumeStore(),
      parse: (text) => parseResumeText(text),
    },
    documentId,
  );
}
