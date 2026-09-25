import "server-only";

import { and, asc, count, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  gapAnswers,
  jobKeywords,
  jobs,
  learningItems,
  skillDemands,
  skills,
  type LearningItemRow,
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

export function createLearningPlanStore({ db }: { db: Db }) {
  return {
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
