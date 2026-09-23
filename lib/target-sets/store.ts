import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, ne } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  bullets,
  documents,
  jobs,
  resumes,
  roles,
  skillDemands,
  skills,
  targetSets,
  type DocumentRow,
  type JobRow,
  type SkillDemandRow,
  type SkillRow,
  type TargetSetRow,
} from "@/db/schema";
import { scoreBullet, strongestBullets, type BulletStrength } from "@/lib/analysis/strength";
import { stripBoilerplate } from "@/lib/parsing/boilerplate";
import type { RemoveKeywordVectors } from "@/lib/vector/job-keywords";

/** SPEC: 2–20 JDs per target set. The minimum is checked when analyzing. */
export const MIN_JOBS = 2;
export const MAX_JOBS = 20;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Marks a set's analysis out of date after its JDs change. */
async function markStale(tx: Db | Tx, targetSetId: string) {
  await tx
    .update(targetSets)
    .set({ status: "draft" })
    .where(and(eq(targetSets.id, targetSetId), ne(targetSets.status, "analyzing")));
}

export class TargetSetError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "not_jd" | "too_many" | "too_few" | "busy",
  ) {
    super(message);
    this.name = "TargetSetError";
  }
}

export interface JobWithDocument extends JobRow {
  documentTitle: string;
  /** Words in the library document, and left after boilerplate stripping. */
  wordCounts: { original: number; clean: number };
}

export interface TargetSetDetail extends TargetSetRow {
  resumeTitle: string;
  jobs: JobWithDocument[];
}

export interface TargetSetSummary extends TargetSetRow {
  resumeTitle: string;
  jobCount: number;
}

/** One analyzed skill of a set, for the results summary (ranked by demand). */
export interface SkillDemandSummary {
  skillId: string;
  name: string;
  category: SkillRow["category"];
  jdCount: number;
  requiredCount: number;
  mustDo: boolean;
  rank: number;
  coverage: SkillDemandRow["coverage"];
}

/** A resume bullet with its role and strength against a set's demand. */
export interface ScoredBullet {
  bulletId: string;
  text: string;
  employer: string;
  roleTitle: string;
  strength: BulletStrength;
}

/** Strengths screen data (SPEC step 4, F9). */
export interface TargetSetStrengths {
  jobCount: number;
  /** Covered skills by rank; `proof` is null when only a skills-list or summary line names it. */
  covered: {
    skillId: string;
    name: string;
    jdCount: number;
    mustDo: boolean;
    rank: number;
    /** The wording found on the resume. */
    matchedTerm: string | null;
    evidence: string[];
    proof: ScoredBullet | null;
  }[];
  /** The resume's strongest accepted bullets for this set (up to 5). */
  strongest: ScoredBullet[];
}

/** Bullets shown as "strongest" (SPEC: top 3–5). */
export const STRONGEST_BULLETS = 5;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export interface AddJobsResult {
  added: string[];
  /** Documents already in the set. */
  alreadyInSet: string[];
}

/** Target sets: a resume plus the 2–20 library JDs it's being tailored to (SPEC F2). */
export interface TargetSetStoreDeps {
  db: Db;
  /** Removes job-keyword vectors after their rows are deleted (none in tests). */
  removeKeywordVectors?: RemoveKeywordVectors;
}

export function createTargetSetStore({
  db,
  removeKeywordVectors = async () => {},
}: TargetSetStoreDeps) {
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
      docs: Pick<DocumentRow, "id" | "kind" | "title" | "text" | "sourceUrl">[],
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
              sourceUrl: doc.sourceUrl,
              jdClean: stripBoilerplate(doc.text).text,
            })),
          );
          await markStale(tx, targetSetId);
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
      if (!row) return false;
      await markStale(db, targetSetId);
      await removeKeywordVectors({ job_id: jobId });
      return true;
    },

    async get(id: string): Promise<TargetSetDetail | undefined> {
      const [set] = await db
        .select({ set: targetSets, resumeTitle: resumes.title })
        .from(targetSets)
        .innerJoin(resumes, eq(resumes.id, targetSets.resumeId))
        .where(eq(targetSets.id, id));
      if (!set) return undefined;
      const jobRows = await db
        .select({ job: jobs, documentTitle: documents.title, documentText: documents.text })
        .from(jobs)
        .innerJoin(documents, eq(documents.id, jobs.documentId))
        .where(eq(jobs.targetSetId, id))
        .orderBy(asc(jobs.createdAt), asc(documents.title));
      return {
        ...set.set,
        resumeTitle: set.resumeTitle,
        jobs: jobRows.map((r) => ({
          ...r.job,
          documentTitle: r.documentTitle,
          wordCounts: {
            original: wordCount(r.documentText),
            clean: wordCount(r.job.jdClean ?? r.documentText),
          },
        })),
      };
    },

    /** The set's analyzed skills, by rank (empty until it's analyzed). */
    async demands(targetSetId: string): Promise<SkillDemandSummary[]> {
      return db
        .select({
          skillId: skillDemands.skillId,
          name: skills.canonicalName,
          category: skills.category,
          jdCount: skillDemands.jdCount,
          requiredCount: skillDemands.requiredCount,
          mustDo: skillDemands.mustDo,
          rank: skillDemands.rank,
          coverage: skillDemands.coverage,
        })
        .from(skillDemands)
        .innerJoin(skills, eq(skills.id, skillDemands.skillId))
        .where(eq(skillDemands.targetSetId, targetSetId))
        .orderBy(asc(skillDemands.rank));
    },

    /**
     * Covered skills with proof bullets, and the strongest bullets. Bullets are
     * scored against the resume as it is now, using the skill wordings stored
     * at analysis time. Undefined if the set doesn't exist.
     */
    async strengths(targetSetId: string): Promise<TargetSetStrengths | undefined> {
      const set = await db.query.targetSets.findFirst({ where: eq(targetSets.id, targetSetId) });
      if (!set) return undefined;
      const [jobRows, demandRows, bulletRows] = await Promise.all([
        db.select({ id: jobs.id }).from(jobs).where(eq(jobs.targetSetId, targetSetId)),
        db
          .select({ demand: skillDemands, name: skills.canonicalName })
          .from(skillDemands)
          .innerJoin(skills, eq(skills.id, skillDemands.skillId))
          .where(eq(skillDemands.targetSetId, targetSetId))
          .orderBy(asc(skillDemands.rank)),
        db
          .select({
            bulletId: bullets.id,
            text: bullets.text,
            employer: roles.employer,
            roleTitle: roles.title,
          })
          .from(bullets)
          .innerJoin(roles, eq(roles.id, bullets.roleId))
          .where(and(eq(roles.resumeId, set.resumeId), eq(bullets.status, "accepted")))
          .orderBy(asc(roles.position), asc(bullets.position)),
      ]);

      const jobCount = jobRows.length;
      const demand = demandRows.map((r) => ({
        name: r.name,
        terms: r.demand.terms,
        jdCount: r.demand.jdCount,
      }));
      const scored = new Map(
        bulletRows.map((b) => [
          b.bulletId,
          { ...b, strength: scoreBullet(b.text, demand, jobCount) },
        ]),
      );
      return {
        jobCount,
        covered: demandRows
          .filter((r) => r.demand.coverage === "covered")
          .map((r) => ({
            skillId: r.demand.skillId,
            name: r.name,
            jdCount: r.demand.jdCount,
            mustDo: r.demand.mustDo,
            rank: r.demand.rank,
            matchedTerm: r.demand.matchedTerm,
            evidence: r.demand.coverageEvidence,
            proof: (r.demand.proofBulletId && scored.get(r.demand.proofBulletId)) || null,
          })),
        strongest: strongestBullets(bulletRows, demand, jobCount, STRONGEST_BULLETS),
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
      if (row) await removeKeywordVectors({ target_set_id: id });
      return !!row;
    },
  };
}

export type TargetSetStore = ReturnType<typeof createTargetSetStore>;
