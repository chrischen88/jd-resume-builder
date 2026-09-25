import "server-only";

import { and, asc, count, eq, isNull, type SQL } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  gapAnswers,
  jobKeywords,
  jobs,
  learningItems,
  skillDemands,
  skills,
  targetSets,
  type LearningItemRow,
  type LearningResource,
} from "@/db/schema";
import type { LearningPlan } from "@/lib/ai/learning-plan";
import type { LearningPlanContext } from "@/lib/ai/prompts/learning-plan";

// Learning items (SPEC F15, task 1.22): created by the interview on No and
// Somewhat (lib/interview/store.ts), then filled in by the learning_plan
// prompt. This file only reads and writes the database.

/** JD sentences sent to the prompt, at most this many. */
const MAX_SENTENCES = 6;
/** The person's skills sent to the prompt, at most this many. */
const MAX_NEARBY_SKILLS = 20;

const IMPORTANCE_ORDER = { required: 0, preferred: 1, mentioned: 2 } as const;

export type LearningStatus = LearningItemRow["status"];

/** A learning item as Screen 6 shows it. */
export interface LearningItemView {
  id: string;
  name: string;
  category: string;
  status: LearningStatus;
  keywords: string[];
  relatedSkills: string[];
  jdCount: number;
  /** JDs in its target set; null when the set was deleted. */
  jobCount: number | null;
  targetSetId: string | null;
  targetSetName: string | null;
  meaning: string | null;
  resources: LearningResource[];
  /** False until the learning_plan prompt has filled it in. */
  planned: boolean;
}

export function createLearningPlanStore({ db }: { db: Db }) {
  return {
    /** Learning items, optionally from one target set only. */
    async list(filter: { targetSetId?: string } = {}): Promise<LearningItemView[]> {
      const where: SQL | undefined = filter.targetSetId
        ? eq(learningItems.targetSetId, filter.targetSetId)
        : undefined;
      const [rows, jobCounts] = await Promise.all([
        db
          .select({ item: learningItems, skill: skills, setName: targetSets.name })
          .from(learningItems)
          .innerJoin(skills, eq(skills.id, learningItems.skillId))
          .leftJoin(targetSets, eq(targetSets.id, learningItems.targetSetId))
          .where(where),
        db
          .select({ targetSetId: jobs.targetSetId, jobCount: count() })
          .from(jobs)
          .groupBy(jobs.targetSetId),
      ]);
      const jobsBySet = new Map(jobCounts.map((j) => [j.targetSetId, j.jobCount]));
      return rows.map(({ item, skill, setName }) => ({
        id: item.id,
        name: skill.canonicalName,
        category: skill.category,
        status: item.status,
        keywords: item.keywords,
        relatedSkills: item.relatedSkills,
        jdCount: item.jdCount,
        jobCount: item.targetSetId ? (jobsBySet.get(item.targetSetId) ?? null) : null,
        targetSetId: item.targetSetId,
        targetSetName: setName,
        meaning: item.meaning,
        resources: item.resources,
        planned: item.promptVersion !== null,
      }));
    },

    /** Target sets that have learning items, by name. */
    async sets(): Promise<{ id: string; name: string }[]> {
      return db
        .selectDistinct({ id: targetSets.id, name: targetSets.name })
        .from(learningItems)
        .innerJoin(targetSets, eq(targetSets.id, learningItems.targetSetId))
        .orderBy(asc(targetSets.name));
    },

    /** Returns false when the item is gone. */
    async setStatus(itemId: string, status: LearningStatus): Promise<boolean> {
      const [row] = await db
        .update(learningItems)
        .set({ status, updatedAt: new Date() })
        .where(eq(learningItems.id, itemId))
        .returning({ id: learningItems.id });
      return !!row;
    },

    /** Items from the set whose plan isn't written yet, oldest first. */
    async pending(targetSetId: string): Promise<LearningItemRow[]> {
      return db.query.learningItems.findMany({
        where: and(eq(learningItems.targetSetId, targetSetId), isNull(learningItems.promptVersion)),
        orderBy: asc(learningItems.createdAt),
      });
    },

    /** The prompt's input for an item, or null when the item is gone. */
    async context(itemId: string): Promise<LearningPlanContext | null> {
      const item = await db.query.learningItems.findFirst({
        where: eq(learningItems.id, itemId),
      });
      if (!item) return null;
      const skill = (await db.query.skills.findFirst({ where: eq(skills.id, item.skillId) }))!;
      const base = {
        skill: skill.canonicalName,
        category: skill.category,
        phrases: item.keywords,
        jdCount: item.jdCount,
      };
      const setId = item.targetSetId;
      // The set was deleted: plan from what the item kept.
      if (!setId) {
        return { ...base, response: "no", jdSentences: [], jobCount: item.jdCount, nearbySkills: [] };
      }

      const [quotes, [{ jobCount }], answer, nearby] = await Promise.all([
        db
          .select({ quote: jobKeywords.evidenceQuote, importance: jobKeywords.importance })
          .from(jobKeywords)
          .innerJoin(jobs, eq(jobs.id, jobKeywords.jobId))
          .where(and(eq(jobs.targetSetId, setId), eq(jobKeywords.skillId, item.skillId))),
        db.select({ jobCount: count() }).from(jobs).where(eq(jobs.targetSetId, setId)),
        db
          .select({ response: gapAnswers.response })
          .from(gapAnswers)
          .innerJoin(skillDemands, eq(skillDemands.id, gapAnswers.skillDemandId))
          .where(and(eq(skillDemands.targetSetId, setId), eq(skillDemands.skillId, item.skillId)))
          .get(),
        db
          .select({ name: skills.canonicalName })
          .from(skillDemands)
          .innerJoin(skills, eq(skills.id, skillDemands.skillId))
          .where(and(eq(skillDemands.targetSetId, setId), eq(skillDemands.coverage, "covered")))
          .orderBy(asc(skillDemands.rank))
          .limit(MAX_NEARBY_SKILLS),
      ]);
      const sentences = [
        ...new Set(
          quotes
            .sort((a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance])
            .map((q) => q.quote),
        ),
      ].slice(0, MAX_SENTENCES);

      return {
        ...base,
        response: answer?.response === "somewhat" ? "somewhat" : "no",
        jdSentences: sentences,
        jobCount: Math.max(jobCount, item.jdCount),
        nearbySkills: nearby.map((n) => n.name),
      };
    },

    /** Saves the plan; a no-op when the item was deleted meanwhile. */
    async save(itemId: string, plan: LearningPlan): Promise<void> {
      await db
        .update(learningItems)
        .set({
          meaning: plan.meaning,
          relatedSkills: plan.relatedSkills,
          resources: plan.resources,
          promptVersion: plan.promptVersion,
          updatedAt: new Date(),
        })
        .where(eq(learningItems.id, itemId));
    },
  };
}

export type LearningPlanStore = ReturnType<typeof createLearningPlanStore>;
