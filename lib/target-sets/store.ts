import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  documents,
  jobs,
  resumes,
  targetSets,
  type DocumentRow,
  type JobRow,
  type TargetSetRow,
} from "@/db/schema";
import { stripBoilerplate } from "@/lib/parsing/boilerplate";

/** SPEC: 2–20 JDs per target set. The minimum is checked when analyzing. */
export const MIN_JOBS = 2;
export const MAX_JOBS = 20;

export class TargetSetError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "not_jd" | "too_many",
  ) {
    super(message);
    this.name = "TargetSetError";
  }
}

export interface JobWithDocument extends JobRow {
  documentTitle: string;
}

export interface TargetSetDetail extends TargetSetRow {
  resumeTitle: string;
  jobs: JobWithDocument[];
}

export interface TargetSetSummary extends TargetSetRow {
  resumeTitle: string;
  jobCount: number;
}

export interface AddJobsResult {
  added: string[];
  /** Documents already in the set. */
  alreadyInSet: string[];
}

/** Target sets: a resume plus the 2–20 library JDs it's being tailored to (SPEC F2). */
export function createTargetSetStore({ db }: { db: Db }) {
  return {
    async create({ name, resumeId }: { name: string; resumeId: string }): Promise<string> {
      const resume = await db.query.resumes.findFirst({ where: eq(resumes.id, resumeId) });
      if (!resume) throw new TargetSetError("That resume no longer exists.", "not_found");
      const id = randomUUID();
      await db.insert(targetSets).values({ id, name: name.trim(), resumeId });
      return id;
    },

    /**
     * Adds library JDs to a set, storing each with boilerplate stripped
     * (jobs.jd_clean). Skips JDs already in the set. All or nothing: throws
     * without adding if any document isn't a JD or the set would exceed
     * MAX_JOBS.
     */
    async addJobs(
      targetSetId: string,
      docs: Pick<DocumentRow, "id" | "kind" | "title" | "text">[],
    ): Promise<AddJobsResult> {
      return db.transaction(async (tx) => {
        const set = await tx.query.targetSets.findFirst({ where: eq(targetSets.id, targetSetId) });
        if (!set) throw new TargetSetError("That target set no longer exists.", "not_found");
        const notJd = docs.find((d) => d.kind !== "jd");
        if (notJd) {
          throw new TargetSetError(
            `“${notJd.title}” is a resume, not a job description.`,
            "not_jd",
          );
        }

        const existing = new Set(
          (
            await tx.query.jobs.findMany({
              where: eq(jobs.targetSetId, targetSetId),
              columns: { documentId: true },
            })
          ).map((j) => j.documentId),
        );
        const unique = [...new Map(docs.map((d) => [d.id, d])).values()];
        const fresh = unique.filter((d) => !existing.has(d.id));
        if (existing.size + fresh.length > MAX_JOBS) {
          throw new TargetSetError(
            `A target set holds up to ${MAX_JOBS} job descriptions; this would make ${existing.size + fresh.length}.`,
            "too_many",
          );
        }

        if (fresh.length > 0) {
          await tx.insert(jobs).values(
            fresh.map((doc) => ({
              id: randomUUID(),
              targetSetId,
              documentId: doc.id,
              jdClean: stripBoilerplate(doc.text).text,
            })),
          );
        }
        return {
          added: fresh.map((d) => d.title),
          alreadyInSet: unique.filter((d) => existing.has(d.id)).map((d) => d.title),
        };
      });
    },

    /** Removes a JD from a set (the library document stays). */
    async removeJob(targetSetId: string, jobId: string): Promise<boolean> {
      const [row] = await db
        .delete(jobs)
        .where(and(eq(jobs.id, jobId), eq(jobs.targetSetId, targetSetId)))
        .returning();
      return !!row;
    },

    async get(id: string): Promise<TargetSetDetail | undefined> {
      const [set] = await db
        .select({ set: targetSets, resumeTitle: resumes.title })
        .from(targetSets)
        .innerJoin(resumes, eq(resumes.id, targetSets.resumeId))
        .where(eq(targetSets.id, id));
      if (!set) return undefined;
      const jobRows = await db
        .select({ job: jobs, documentTitle: documents.title })
        .from(jobs)
        .innerJoin(documents, eq(documents.id, jobs.documentId))
        .where(eq(jobs.targetSetId, id))
        .orderBy(asc(jobs.createdAt), asc(documents.title));
      return {
        ...set.set,
        resumeTitle: set.resumeTitle,
        jobs: jobRows.map((r) => ({ ...r.job, documentTitle: r.documentTitle })),
      };
    },

    async list(): Promise<TargetSetSummary[]> {
      const rows = await db
        .select({ set: targetSets, resumeTitle: resumes.title, jobCount: count(jobs.id) })
        .from(targetSets)
        .innerJoin(resumes, eq(resumes.id, targetSets.resumeId))
        .leftJoin(jobs, eq(jobs.targetSetId, targetSets.id))
        .groupBy(targetSets.id)
        .orderBy(desc(targetSets.createdAt));
      return rows.map((r) => ({ ...r.set, resumeTitle: r.resumeTitle, jobCount: r.jobCount }));
    },

    async rename(id: string, name: string): Promise<boolean> {
      const [row] = await db
        .update(targetSets)
        .set({ name: name.trim() })
        .where(eq(targetSets.id, id))
        .returning();
      return !!row;
    },

    async remove(id: string): Promise<boolean> {
      const [row] = await db.delete(targetSets).where(eq(targetSets.id, id)).returning();
      return !!row;
    },
  };
}

export type TargetSetStore = ReturnType<typeof createTargetSetStore>;
