import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  bullets,
  jobKeywords,
  jobs,
  rewordSuggestions,
  roles,
  skillDemands,
  skills,
  targetSets,
} from "@/db/schema";
import { rewordCandidates, type RewordCandidate, type RewordSkill } from "@/lib/analysis/reword";
import { createResumeStore } from "@/lib/resume/store";
import { resumeToText } from "@/lib/resume/text";

// Rewording suggestions for a target set (SPEC §AI design 4, task 1.13).
// Generated on request, stored as pending, and applied to the resume only
// when the user accepts one.

/** Rewords candidates with the model (rewordBullets in lib/ai). */
export type Reworder = (
  candidates: RewordCandidate[],
) => Promise<{ rewordings: (RewordCandidate & { suggestion: string })[]; promptVersion: string }>;

export interface SuggestionView {
  id: string;
  skillName: string;
  jdPhrase: string;
  originalText: string;
  suggestedText: string;
  employer: string;
  roleTitle: string;
}

export type AcceptResult = "accepted" | "stale" | "not_found";

export function createSuggestionStore({ db }: { db: Db }) {
  /** The set's skills with their JD phrasings, for choosing candidates. */
  async function rewordSkills(targetSetId: string): Promise<RewordSkill[]> {
    const [demandRows, phraseRows] = await Promise.all([
      db
        .select({ demand: skillDemands, name: skills.canonicalName })
        .from(skillDemands)
        .innerJoin(skills, eq(skills.id, skillDemands.skillId))
        .where(eq(skillDemands.targetSetId, targetSetId)),
      db
        .select({ skillId: jobKeywords.skillId, phrase: jobKeywords.jdPhrase })
        .from(jobKeywords)
        .innerJoin(jobs, eq(jobs.id, jobKeywords.jobId))
        .where(eq(jobs.targetSetId, targetSetId)),
    ]);
    const phraseCounts = new Map<string, Map<string, number>>();
    for (const { skillId, phrase } of phraseRows) {
      const counts = phraseCounts.get(skillId) ?? new Map<string, number>();
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
      phraseCounts.set(skillId, counts);
    }
    return demandRows.map(({ demand, name }) => ({
      skillId: demand.skillId,
      name,
      coverage: demand.coverage,
      rank: demand.userRank ?? demand.rank,
      terms: demand.terms,
      jdPhrases: [...(phraseCounts.get(demand.skillId) ?? new Map()).entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([phrase]) => phrase),
      evidence: demand.coverageEvidence,
      proofBulletId: demand.proofBulletId,
    }));
  }

  return {
    /**
     * Asks for rewordings of the set's current candidates. A bullet already
     * suggested for the same skill (pending, accepted, or dismissed) isn't
     * asked again unless its text changed since. Returns how many were added.
     */
    async generate(
      targetSetId: string,
      reword: Reworder,
    ): Promise<{ candidates: number; added: number } | undefined> {
      const set = await db.query.targetSets.findFirst({ where: eq(targetSets.id, targetSetId) });
      if (!set) return undefined;
      const resume = await createResumeStore({ db }).get(set.resumeId);
      if (!resume) return undefined;

      const accepted = resume.roles.flatMap((r) =>
        r.bullets.filter((b) => b.status === "accepted"),
      );
      const existing = await db.query.rewordSuggestions.findMany({
        where: eq(rewordSuggestions.targetSetId, targetSetId),
      });
      const textOf = new Map(accepted.map((b) => [b.id, b.text]));
      const done = new Set(
        existing
          .filter((s) => textOf.get(s.bulletId) === s.originalText)
          .map((s) => `${s.bulletId}:${s.skillId}`),
      );
      const candidates = rewordCandidates(
        await rewordSkills(targetSetId),
        accepted,
        resumeToText(resume),
      ).filter((c) => !done.has(`${c.bulletId}:${c.skillId}`));
      if (candidates.length === 0) return { candidates: 0, added: 0 };

      const { rewordings, promptVersion } = await reword(candidates);
      if (rewordings.length > 0) {
        await db
          .insert(rewordSuggestions)
          .values(
            rewordings.map((r) => ({
              id: randomUUID(),
              targetSetId,
              bulletId: r.bulletId,
              skillId: r.skillId,
              originalText: r.bulletText,
              suggestedText: r.suggestion,
              jdPhrase: r.phrase,
              promptVersion,
            })),
          )
          // A bullet edited since its last suggestion gets a fresh one.
          .onConflictDoUpdate({
            target: [
              rewordSuggestions.targetSetId,
              rewordSuggestions.bulletId,
              rewordSuggestions.skillId,
            ],
            set: {
              originalText: sql`excluded.original_text`,
              suggestedText: sql`excluded.suggested_text`,
              jdPhrase: sql`excluded.jd_phrase`,
              promptVersion: sql`excluded.prompt_version`,
              status: "pending",
            },
          });
      }
      return { candidates: candidates.length, added: rewordings.length };
    },

    /** Pending suggestions whose bullet hasn't changed since, in resume order. */
    async list(targetSetId: string): Promise<SuggestionView[]> {
      const rows = await db
        .select({
          suggestion: rewordSuggestions,
          skillName: skills.canonicalName,
          bulletText: bullets.text,
          employer: roles.employer,
          roleTitle: roles.title,
        })
        .from(rewordSuggestions)
        .innerJoin(skills, eq(skills.id, rewordSuggestions.skillId))
        .innerJoin(bullets, eq(bullets.id, rewordSuggestions.bulletId))
        .innerJoin(roles, eq(roles.id, bullets.roleId))
        .where(
          and(
            eq(rewordSuggestions.targetSetId, targetSetId),
            eq(rewordSuggestions.status, "pending"),
          ),
        )
        .orderBy(asc(roles.position), asc(bullets.position));
      return rows
        .filter((r) => r.bulletText === r.suggestion.originalText)
        .map((r) => ({
          id: r.suggestion.id,
          skillName: r.skillName,
          jdPhrase: r.suggestion.jdPhrase,
          originalText: r.suggestion.originalText,
          suggestedText: r.suggestion.suggestedText,
          employer: r.employer,
          roleTitle: r.roleTitle,
        }));
    },

    /**
     * Writes the suggestion into the bullet, if the bullet still reads as it
     * did. Marks the resume's analyzed sets out of date, since coverage changed.
     */
    async accept(id: string): Promise<AcceptResult> {
      return db.transaction(async (tx) => {
        const row = await tx.query.rewordSuggestions.findFirst({
          where: and(eq(rewordSuggestions.id, id), eq(rewordSuggestions.status, "pending")),
        });
        if (!row) return "not_found";
        const bullet = await tx.query.bullets.findFirst({ where: eq(bullets.id, row.bulletId) });
        if (!bullet || bullet.text !== row.originalText) return "stale";

        await tx
          .update(bullets)
          .set({ text: row.suggestedText, updatedAt: new Date() })
          .where(eq(bullets.id, bullet.id));
        await tx
          .update(rewordSuggestions)
          .set({ status: "accepted" })
          .where(eq(rewordSuggestions.id, id));

        const role = (await tx.query.roles.findFirst({ where: eq(roles.id, bullet.roleId) }))!;
        const sets = await tx.query.targetSets.findMany({
          where: and(eq(targetSets.resumeId, role.resumeId), eq(targetSets.status, "ready")),
          columns: { id: true },
        });
        if (sets.length > 0) {
          await tx
            .update(targetSets)
            .set({ status: "draft" })
            .where(inArray(targetSets.id, sets.map((s) => s.id)));
        }
        return "accepted";
      });
    },

    async dismiss(id: string): Promise<boolean> {
      const [row] = await db
        .update(rewordSuggestions)
        .set({ status: "dismissed" })
        .where(and(eq(rewordSuggestions.id, id), eq(rewordSuggestions.status, "pending")))
        .returning();
      return !!row;
    },
  };
}

export type SuggestionStore = ReturnType<typeof createSuggestionStore>;
