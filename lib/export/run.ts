import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import { resumeVersions, targetSets } from "@/db/schema";
import { createInterviewStore } from "@/lib/interview/store";
import { createResumeStore } from "@/lib/resume/store";
import { scoreTargetSet } from "@/lib/target-sets/score";

import { renderDocx } from "./docx";
import { renderHtml } from "./html";
import { exportFilename, exportModel } from "./model";

// Exports a target set's resume as DOCX or PDF (SPEC F18, task 1.25). Refused
// while any bullet on it has unverified claims (F14). The file is kept under
// <data dir>/exports/<set id>/ and recorded on the set's resume version.

export const EXPORT_FORMATS = ["docx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const CONTENT_TYPES: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

export class ExportError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "blocked",
  ) {
    super(message);
    this.name = "ExportError";
  }
}

export interface ExportDeps {
  db: Db;
  dataDir: string;
  htmlToPdf: (html: string) => Promise<Buffer>;
}

export interface ExportedFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

export async function exportResume(
  { db, dataDir, htmlToPdf }: ExportDeps,
  targetSetId: string,
  format: ExportFormat,
): Promise<ExportedFile> {
  const set = await db.query.targetSets.findFirst({ where: eq(targetSets.id, targetSetId) });
  if (!set) throw new ExportError("That target set no longer exists.", "not_found");
  const blockers = await createInterviewStore({ db }).exportBlockers(set.resumeId);
  if (blockers.length > 0) {
    const n = blockers.length;
    throw new ExportError(
      `${n} ${n === 1 ? "bullet has" : "bullets have"} claims you haven't confirmed. Confirm or ` +
        "remove them before downloading.",
      "blocked",
    );
  }
  const resume = await createResumeStore({ db }).get(set.resumeId);
  if (!resume) throw new ExportError("That resume no longer exists.", "not_found");

  const model = exportModel(resume);
  const body = format === "docx" ? await renderDocx(model) : await htmlToPdf(renderHtml(model));

  const relative = path.join("exports", set.id, `resume.${format}`);
  await mkdir(path.join(dataDir, "exports", set.id), { recursive: true });
  await writeFile(path.join(dataDir, relative), body);

  const score = await scoreTargetSet(db, set.id, set.resumeId);
  const values = {
    summary: resume.sections.summary,
    skills: resume.sections.skills,
    bulletIds: resume.roles.flatMap((r) =>
      r.bullets.filter((b) => b.status === "accepted").map((b) => b.id),
    ),
    scoreBefore: score.before,
    scoreAfter: score.after,
    ...(format === "docx" ? { docxPath: relative } : { pdfPath: relative }),
  };
  const version = await db.query.resumeVersions.findFirst({
    where: and(eq(resumeVersions.targetSetId, set.id), isNull(resumeVersions.jobId)),
  });
  if (version) {
    await db.update(resumeVersions).set(values).where(eq(resumeVersions.id, version.id));
  } else {
    await db.insert(resumeVersions).values({ id: randomUUID(), targetSetId: set.id, ...values });
  }

  return { filename: exportFilename(model.name, format), contentType: CONTENT_TYPES[format], body };
}
