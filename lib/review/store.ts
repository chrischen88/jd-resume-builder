import "server-only";

import { and, eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { bullets, resumes, roles, targetSets } from "@/db/schema";
import { findPhraseOffsets } from "@/lib/analysis/text";

// Screen 7 (task 1.26): inline edits on the review page. They change the
// resume the interview wrote to, and mark its analyzed sets out of date, as
// the interview does. Edits are the user's own words, so they aren't
// claim-checked; a bullet's unverified claims stay until the user confirms
// them or says the text no longer makes them.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "conflict" | "bad_input",
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

async function markResumeChanged(tx: Tx, resumeId: string) {
  await tx
    .update(targetSets)
    .set({ status: "draft" })
    .where(and(eq(targetSets.resumeId, resumeId), eq(targetSets.status, "ready")));
}

export function createReviewStore({ db }: { db: Db }) {
  async function bulletOf(resumeId: string, bulletId: string) {
    const [row] = await db
      .select({ bullet: bullets })
      .from(bullets)
      .innerJoin(roles, eq(roles.id, bullets.roleId))
      .where(and(eq(bullets.id, bulletId), eq(roles.resumeId, resumeId)));
    if (!row) throw new ReviewError("That bullet is no longer on your resume.", "not_found");
    return row.bullet;
  }

  async function sectionsOf(resumeId: string) {
    const resume = await db.query.resumes.findFirst({ where: eq(resumes.id, resumeId) });
    if (!resume) throw new ReviewError("That resume no longer exists.", "not_found");
    return resume.sections;
  }

  return {
    /** New text for a bullet. A generated bullet keeps only the keyword tags its text still has. */
    async editBullet(resumeId: string, bulletId: string, text: string): Promise<void> {
      const bullet = await bulletOf(resumeId, bulletId);
      if (bullet.text === text) return;
      await db.transaction(async (tx) => {
        await tx
          .update(bullets)
          .set({
            text,
            keywordsHit: bullet.keywordsHit.filter((k) => findPhraseOffsets(text, k).length > 0),
            updatedAt: new Date(),
          })
          .where(eq(bullets.id, bulletId));
        await markResumeChanged(tx, resumeId);
      });
    },

    /** Takes an interview bullet off the resume. Its evidence stays in the library. */
    async removeGeneratedBullet(resumeId: string, bulletId: string): Promise<void> {
      const bullet = await bulletOf(resumeId, bulletId);
      if (bullet.source !== "generated") {
        throw new ReviewError("Edit your original bullets on the resume page.", "bad_input");
      }
      await db.transaction(async (tx) => {
        await tx.delete(bullets).where(eq(bullets.id, bulletId));
        await markResumeChanged(tx, resumeId);
      });
    },

    /** The user says the bullet no longer makes this claim, or that it's true. */
    async resolveClaim(resumeId: string, bulletId: string, claim: string): Promise<void> {
      const bullet = await bulletOf(resumeId, bulletId);
      if (!bullet.unverifiedClaims.includes(claim)) return;
      await db
        .update(bullets)
        .set({
          unverifiedClaims: bullet.unverifiedClaims.filter((c) => c !== claim),
          updatedAt: new Date(),
        })
        .where(eq(bullets.id, bulletId));
    },

    /** Empty text removes the summary. */
    async editSummary(resumeId: string, text: string): Promise<void> {
      const sections = await sectionsOf(resumeId);
      const summary = text || null;
      if (sections.summary === summary) return;
      await db.transaction(async (tx) => {
        await tx
          .update(resumes)
          .set({ sections: { ...sections, summary }, updatedAt: new Date() })
          .where(eq(resumes.id, resumeId));
        await markResumeChanged(tx, resumeId);
      });
    },

    /**
     * New text for skills line `index`, which must still read `previous` (so a
     * stale page can't overwrite another line). Empty text removes the line.
     */
    async editSkillLine(
      resumeId: string,
      index: number,
      previous: string,
      text: string,
    ): Promise<void> {
      const sections = await sectionsOf(resumeId);
      if (sections.skills[index] !== previous) {
        throw new ReviewError("Your skills changed since this page loaded. Reload it.", "conflict");
      }
      if (previous === text) return;
      const skills = text
        ? sections.skills.map((line, i) => (i === index ? text : line))
        : sections.skills.filter((_, i) => i !== index);
      await db.transaction(async (tx) => {
        await tx
          .update(resumes)
          .set({ sections: { ...sections, skills }, updatedAt: new Date() })
          .where(eq(resumes.id, resumeId));
        await markResumeChanged(tx, resumeId);
      });
    },
  };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;
