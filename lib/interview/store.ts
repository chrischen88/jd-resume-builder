import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNotNull, max } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  bullets,
  evidence,
  evidenceSkills,
  gapAnswers,
  jobKeywords,
  jobs,
  learningItems,
  resumes,
  roles,
  skillDemands,
  skills,
  targetSets,
  type EvidenceRow,
  type GapAnswerRow,
  type GapDraft,
  type ResumeSections,
  type RoleRow,
} from "@/db/schema";
import { findPhraseOffsets } from "@/lib/analysis/text";
import { createResumeStore } from "@/lib/resume/store";
import { resumeToText } from "@/lib/resume/text";
import { createGapStore, type Gap } from "@/lib/target-sets/gaps";

import { gapStage, isCertification, nextGap, type Stage } from "./state";

// The gap interview's saved state (SPEC step 5, tasks 1.16 and 1.20). Every
// answer is written as soon as it's given, so the interview can stop and
// resume anywhere. Model calls happen in steps.ts; this file only reads and
// writes the database.

/** Line that holds skills added by the interview. */
export const ADDED_SKILLS_LABEL = "Additional skills";
/** JD phrasings kept on a learning item. */
const MAX_LEARNING_KEYWORDS = 5;

export type Response = GapAnswerRow["response"];

export interface InterviewRole {
  id: string;
  title: string;
  employer: string;
  startDate: string | null;
  endDate: string | null;
}

export interface CurrentGap {
  gap: Gap;
  stage: Stage;
  answer: Pick<GapAnswerRow, "response" | "followUps" | "roleId" | "draft"> | null;
}

export interface InterviewView {
  resumeId: string;
  jobCount: number;
  /** Gaps left in the interview (not dismissed). */
  total: number;
  /** Of those, finished. */
  done: number;
  /** 1-based place of the current gap among `total`; null when all are done. */
  position: number | null;
  current: CurrentGap | null;
  /** Learning items from this set. */
  learningCount: number;
  roles: InterviewRole[];
}

export class InterviewError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "wrong_stage" | "bad_input",
  ) {
    super(message);
    this.name = "InterviewError";
  }
}

export function roleLabel(role: Pick<RoleRow, "title" | "employer" | "startDate" | "endDate">) {
  const dates = [role.startDate, role.endDate].filter(Boolean).join(" – ");
  return `${role.title}, ${role.employer}${dates ? ` (${dates})` : ""}`;
}

/**
 * Adds a skill to the resume's skills section: on the "Additional skills"
 * line (created if missing), unless some skills line already names it.
 */
export function addSkillToSections(sections: ResumeSections, skill: string): ResumeSections {
  if (sections.skills.some((line) => findPhraseOffsets(line, skill).length > 0)) return sections;
  const prefix = `${ADDED_SKILLS_LABEL}: `;
  const at = sections.skills.findIndex((line) => line.startsWith(prefix));
  const skills =
    at >= 0
      ? sections.skills.map((line, i) => (i === at ? `${line}, ${skill}` : line))
      : [...sections.skills, `${prefix}${skill}`];
  return { ...sections, skills };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createInterviewStore({ db }: { db: Db }) {
  const gapStore = createGapStore({ db });

  async function setOf(targetSetId: string) {
    const set = await db.query.targetSets.findFirst({ where: eq(targetSets.id, targetSetId) });
    if (!set) throw new InterviewError("That target set no longer exists.", "not_found");
    return set;
  }

  async function answersFor(demandIds: string[]) {
    if (demandIds.length === 0) return new Map<string, GapAnswerRow>();
    const rows = await db.query.gapAnswers.findMany({
      where: inArray(gapAnswers.skillDemandId, demandIds),
    });
    return new Map(rows.map((r) => [r.skillDemandId, r]));
  }

  /** The demand, checked to belong to the set, with its answer (if any). */
  async function gapOf(targetSetId: string, demandId: string) {
    const [row] = await db
      .select({ demand: skillDemands, skill: skills })
      .from(skillDemands)
      .innerJoin(skills, eq(skills.id, skillDemands.skillId))
      .where(and(eq(skillDemands.id, demandId), eq(skillDemands.targetSetId, targetSetId)));
    if (!row) throw new InterviewError("That skill is no longer in this set.", "not_found");
    const demand = { ...row.demand, skill: row.skill };
    const answer = await db.query.gapAnswers.findFirst({
      where: eq(gapAnswers.skillDemandId, demandId),
    });
    return { demand, answer };
  }

  function expectStage(answer: GapAnswerRow | undefined, ...stages: Stage[]) {
    if (!stages.includes(gapStage(answer))) {
      throw new InterviewError("This step was already answered. Reload the page.", "wrong_stage");
    }
  }

  async function update(demandId: string, values: Partial<GapAnswerRow>) {
    await db
      .update(gapAnswers)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(gapAnswers.skillDemandId, demandId));
  }

  /** A learning item for the skill (SPEC: No and Somewhat), unless it already has one. */
  async function addLearningItem(
    tx: Db | Tx,
    targetSetId: string,
    skillId: string,
    jdCount: number,
  ) {
    const phrases = await tx
      .select({ phrase: jobKeywords.jdPhrase })
      .from(jobKeywords)
      .innerJoin(jobs, eq(jobs.id, jobKeywords.jobId))
      .where(and(eq(jobs.targetSetId, targetSetId), eq(jobKeywords.skillId, skillId)));
    const keywords = [...new Set(phrases.map((p) => p.phrase))].slice(0, MAX_LEARNING_KEYWORDS);
    await tx
      .insert(learningItems)
      .values({ id: randomUUID(), skillId, targetSetId, keywords, jdCount })
      .onConflictDoNothing({ target: learningItems.skillId });
  }

  async function resumeRoles(resumeId: string): Promise<InterviewRole[]> {
    return db
      .select({
        id: roles.id,
        title: roles.title,
        employer: roles.employer,
        startDate: roles.startDate,
        endDate: roles.endDate,
      })
      .from(roles)
      .where(eq(roles.resumeId, resumeId))
      .orderBy(asc(roles.position));
  }

  /** Marks the resume's analyzed sets out of date after the resume changes. */
  async function markResumeChanged(tx: Tx, resumeId: string) {
    await tx
      .update(targetSets)
      .set({ status: "draft" })
      .where(and(eq(targetSets.resumeId, resumeId), eq(targetSets.status, "ready")));
  }

  return {
    async view(targetSetId: string): Promise<InterviewView> {
      const set = await setOf(targetSetId);
      const [overview, roleList, learning] = await Promise.all([
        gapStore.overview(targetSetId),
        resumeRoles(set.resumeId),
        db.query.learningItems.findMany({
          where: eq(learningItems.targetSetId, targetSetId),
          columns: { id: true },
        }),
      ]);
      const answers = await answersFor(overview.active.map((g) => g.demandId));
      const stageOf = (gap: Gap) => gapStage(answers.get(gap.demandId));
      const current = nextGap(overview.active, stageOf);
      const answer = current ? answers.get(current.demandId) : undefined;
      return {
        resumeId: set.resumeId,
        jobCount: overview.jobCount,
        total: overview.active.length,
        done: overview.active.filter((g) => stageOf(g) === "done").length,
        position: current ? overview.active.indexOf(current) + 1 : null,
        current: current
          ? {
              gap: current,
              stage: stageOf(current),
              answer: answer
                ? {
                    response: answer.response,
                    followUps: answer.followUps,
                    roleId: answer.roleId,
                    draft: answer.draft,
                  }
                : null,
            }
          : null,
        learningCount: learning.length,
        roles: roleList,
      };
    },

    /**
     * "Have you done this?" No → learning plan, done. Somewhat → learning
     * plan too. A certification Yes goes straight into the certifications
     * section. With a single role, it's chosen for the user.
     */
    async answer(targetSetId: string, demandId: string, response: Response): Promise<void> {
      const set = await setOf(targetSetId);
      const { demand, answer } = await gapOf(targetSetId, demandId);
      expectStage(answer, "ask");
      const certification = isCertification(demand.skill.category);
      if (certification && response === "somewhat") {
        throw new InterviewError("For a certification, answer Yes or No.", "bad_input");
      }
      const roleList = await resumeRoles(set.resumeId);

      await db.transaction(async (tx) => {
        const finished = response === "no" || (certification && response === "yes");
        await tx.insert(gapAnswers).values({
          id: randomUUID(),
          skillDemandId: demandId,
          response,
          roleId: !finished && roleList.length === 1 ? roleList[0].id : null,
          completedAt: finished ? new Date() : null,
        });
        if (response !== "yes") {
          await addLearningItem(tx, targetSetId, demand.skillId, demand.jdCount);
        }
        if (certification && response === "yes") {
          const resume = (await tx.query.resumes.findFirst({
            where: eq(resumes.id, set.resumeId),
          }))!;
          const listed = resume.sections.certifications.some(
            (c) => findPhraseOffsets(c, demand.skill.canonicalName).length > 0,
          );
          if (!listed) {
            await tx
              .update(resumes)
              .set({
                sections: {
                  ...resume.sections,
                  certifications: [...resume.sections.certifications, demand.skill.canonicalName],
                },
                updatedAt: new Date(),
              })
              .where(eq(resumes.id, resume.id));
            await markResumeChanged(tx, resume.id);
          }
        }
      });
    },

    async chooseRole(targetSetId: string, demandId: string, roleId: string): Promise<void> {
      const set = await setOf(targetSetId);
      const { answer } = await gapOf(targetSetId, demandId);
      expectStage(answer, "role");
      const role = await db.query.roles.findFirst({
        where: and(eq(roles.id, roleId), eq(roles.resumeId, set.resumeId)),
      });
      if (!role) throw new InterviewError("Pick one of the roles on your resume.", "bad_input");
      await update(demandId, { roleId });
    },

    /** Saves the model's next question, waiting for an answer. */
    async saveQuestion(targetSetId: string, demandId: string, question: string): Promise<void> {
      const { answer } = await gapOf(targetSetId, demandId);
      expectStage(answer, "needs_question");
      await update(demandId, { followUps: [...answer!.followUps, { question, answer: null }] });
    },

    /** Answers the waiting follow-up; an empty answer means skipped. */
    async answerFollowUp(targetSetId: string, demandId: string, text: string): Promise<void> {
      const { answer } = await gapOf(targetSetId, demandId);
      expectStage(answer, "follow_up");
      const followUps = answer!.followUps.map((f) =>
        f.answer === null ? { ...f, answer: text.trim() } : f,
      );
      await update(demandId, { followUps });
    },

    async saveDraft(targetSetId: string, demandId: string, draft: GapDraft): Promise<void> {
      const { answer } = await gapOf(targetSetId, demandId);
      expectStage(answer, "needs_question", "needs_draft", "draft");
      await update(demandId, { draft });
    },

    /** Replaces one variant (after an edit, already claim-checked). */
    async saveVariant(
      targetSetId: string,
      demandId: string,
      index: number,
      variant: GapDraft["variants"][number],
    ): Promise<void> {
      const { answer } = await gapOf(targetSetId, demandId);
      expectStage(answer, "draft");
      const draft = answer!.draft!;
      if (!draft.variants[index]) throw new InterviewError("That version is gone.", "bad_input");
      await update(demandId, {
        draft: { ...draft, variants: draft.variants.map((v, i) => (i === index ? variant : v)) },
      });
    },

    /**
     * The user confirms an unverified claim is true: it's dropped from the
     * variant's unverified list and recorded with the answers, so later
     * checks count it as the user's word.
     */
    async confirmClaim(targetSetId: string, demandId: string, index: number, claim: string) {
      const { answer } = await gapOf(targetSetId, demandId);
      expectStage(answer, "draft");
      const draft = answer!.draft!;
      const variant = draft.variants[index];
      if (!variant?.unverifiedClaims.includes(claim)) return;
      await update(demandId, {
        followUps: [...answer!.followUps, { question: "Confirmed in review", answer: claim }],
        draft: {
          ...draft,
          variants: draft.variants.map((v, i) =>
            i === index
              ? { ...v, unverifiedClaims: v.unverifiedClaims.filter((c) => c !== claim) }
              : v,
          ),
        },
      });
    },

    /** Moves the gap to the end of the interview order (its answers so far are kept). */
    async skip(targetSetId: string, demandId: string): Promise<void> {
      await gapOf(targetSetId, demandId);
      const [{ last }] = await db
        .select({ last: max(skillDemands.userRank) })
        .from(skillDemands)
        .where(eq(skillDemands.targetSetId, targetSetId));
      const [{ lastRank }] = await db
        .select({ lastRank: max(skillDemands.rank) })
        .from(skillDemands)
        .where(eq(skillDemands.targetSetId, targetSetId));
      await db
        .update(skillDemands)
        .set({ userRank: Math.max(last ?? 0, lastRank ?? 0) + 1 })
        .where(eq(skillDemands.id, demandId));
    },

    /**
     * Starts the gap over. Not after a bullet was accepted or a certification
     * added: those changed the resume, and are edited there.
     */
    async undo(targetSetId: string, demandId: string): Promise<void> {
      const { demand, answer } = await gapOf(targetSetId, demandId);
      if (!answer) return;
      if (answer.completedAt && answer.response !== "no") {
        throw new InterviewError(
          "This one already changed your resume; edit it there instead.",
          "wrong_stage",
        );
      }
      await db.transaction(async (tx) => {
        await tx.delete(gapAnswers).where(eq(gapAnswers.id, answer.id));
        if (answer.response !== "yes") {
          await tx
            .delete(learningItems)
            .where(
              and(
                eq(learningItems.skillId, demand.skillId),
                eq(learningItems.targetSetId, targetSetId),
                eq(learningItems.status, "to_learn"),
              ),
            );
        }
      });
    },

    /**
     * Accepts one drafted version (SPEC F12, F19; task 1.20): the bullet goes
     * under the chosen role, the answers become an Evidence record, and on a
     * Yes the skill joins the skills section. Unverified claims stay on the
     * bullet and block export until confirmed. Returns the new evidence row,
     * for indexing.
     */
    async accept(targetSetId: string, demandId: string, index: number): Promise<EvidenceRow> {
      const set = await setOf(targetSetId);
      const { demand, answer } = await gapOf(targetSetId, demandId);
      expectStage(answer, "draft");
      const draft = answer!.draft!;
      const variant = draft.variants[index];
      if (!variant) throw new InterviewError("That version is gone.", "bad_input");
      const roleId = answer!.roleId!;

      return db.transaction(async (tx) => {
        const evidenceId = randomUUID();
        const [row] = await tx
          .insert(evidence)
          .values({
            id: evidenceId,
            roleId,
            situation: draft.evidence.situation,
            action: draft.evidence.action.trim() || variant.text,
            tools: draft.evidence.tools,
            scale: draft.evidence.scale,
            result: draft.evidence.result,
            metric: draft.evidence.metric,
          })
          .returning();
        await tx.insert(evidenceSkills).values({ evidenceId, skillId: demand.skillId });

        const [{ last }] = await tx
          .select({ last: max(bullets.position) })
          .from(bullets)
          .where(eq(bullets.roleId, roleId));
        await tx.insert(bullets).values({
          id: randomUUID(),
          roleId,
          position: (last ?? -1) + 1,
          text: variant.text,
          source: "generated",
          status: "accepted",
          evidenceId,
          keywordsHit: variant.keywordsHit,
          claims: variant.claims,
          unverifiedClaims: variant.unverifiedClaims,
        });

        if (answer!.response === "yes") {
          const resume = (await tx.query.resumes.findFirst({
            where: eq(resumes.id, set.resumeId),
          }))!;
          const sections = addSkillToSections(resume.sections, demand.skill.canonicalName);
          if (sections !== resume.sections) {
            await tx
              .update(resumes)
              .set({ sections, updatedAt: new Date() })
              .where(eq(resumes.id, resume.id));
          }
        }
        await tx
          .update(gapAnswers)
          .set({ evidenceId, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(gapAnswers.id, answer!.id));
        await markResumeChanged(tx, set.resumeId);
        return row;
      });
    },

    /** Accepted bullets on the resume that still have unverified claims (they block export). */
    async exportBlockers(resumeId: string) {
      const rows = await db
        .select({ id: bullets.id, text: bullets.text, unverified: bullets.unverifiedClaims })
        .from(bullets)
        .innerJoin(roles, eq(roles.id, bullets.roleId))
        .where(and(eq(roles.resumeId, resumeId), eq(bullets.status, "accepted")))
        .orderBy(asc(roles.position), asc(bullets.position));
      return rows.filter((r) => r.unverified.length > 0);
    },

    /** The user confirms an unverified claim on an accepted bullet. */
    async confirmBulletClaim(resumeId: string, bulletId: string, claim: string): Promise<boolean> {
      const [row] = await db
        .select({ bullet: bullets })
        .from(bullets)
        .innerJoin(roles, eq(roles.id, bullets.roleId))
        .where(and(eq(bullets.id, bulletId), eq(roles.resumeId, resumeId)));
      if (!row || !row.bullet.unverifiedClaims.includes(claim)) return false;
      await db
        .update(bullets)
        .set({
          unverifiedClaims: row.bullet.unverifiedClaims.filter((c) => c !== claim),
          updatedAt: new Date(),
        })
        .where(eq(bullets.id, bulletId));
      return true;
    },

    /** Everything the model steps need about one gap. */
    async stepContext(targetSetId: string, demandId: string) {
      const set = await setOf(targetSetId);
      const { demand, answer } = await gapOf(targetSetId, demandId);
      const overview = await gapStore.overview(targetSetId);
      const gap = overview.active.find((g) => g.demandId === demandId);
      if (!gap || !answer) throw new InterviewError("Nothing to do for this skill.", "wrong_stage");
      const role = answer.roleId
        ? await db.query.roles.findFirst({ where: eq(roles.id, answer.roleId) })
        : undefined;
      const [roleBullets, phrases, seniorities, resume] = await Promise.all([
        role
          ? db
              .select({ text: bullets.text })
              .from(bullets)
              .where(and(eq(bullets.roleId, role.id), eq(bullets.status, "accepted")))
          : Promise.resolve([]),
        db
          .select({ phrase: jobKeywords.jdPhrase })
          .from(jobKeywords)
          .innerJoin(jobs, eq(jobs.id, jobKeywords.jobId))
          .where(and(eq(jobs.targetSetId, targetSetId), eq(jobKeywords.skillId, demand.skillId))),
        db
          .select({ seniority: jobs.seniority })
          .from(jobs)
          .where(and(eq(jobs.targetSetId, targetSetId), isNotNull(jobs.seniority))),
        createResumeStore({ db }).get(set.resumeId),
      ]);
      const phraseCounts = new Map<string, number>();
      for (const { phrase } of phrases) {
        phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
      }
      const seniorityCounts = new Map<string, number>();
      for (const { seniority } of seniorities) {
        if (seniority) seniorityCounts.set(seniority, (seniorityCounts.get(seniority) ?? 0) + 1);
      }
      const at = overview.active.indexOf(gap);
      return {
        gap,
        answer,
        role: role ?? null,
        roleBullets: roleBullets.map((b) => b.text),
        jdPhrases: [...phraseCounts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p),
        seniority: [...seniorityCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        /** The next few gaps: named in the bullet only if the answers show them. */
        otherSkills: overview.active
          .slice(at + 1, at + 4)
          .map((g) => g.name),
        resumeText: resume ? resumeToText(resume) : "",
      };
    },
  };
}

export type InterviewStore = ReturnType<typeof createInterviewStore>;
