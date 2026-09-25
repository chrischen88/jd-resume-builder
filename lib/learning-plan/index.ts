import "server-only";

import { getDb } from "@/db/client";
import { planLearning } from "@/lib/ai/learning-plan";

import { fillLearningPlans } from "./generate";
import { createLearningPlanStore } from "./store";

export { DEMAND_GROUP_LABELS, groupByDemand, type DemandGroup } from "./groups";
export { learningPlanMarkdown, resourceKindLabel } from "./markdown";
export type { LearningItemView, LearningStatus } from "./store";

/** Writes the plan for the set's pending learning items (see generate.ts). */
export async function fillPendingLearningPlans(targetSetId: string): Promise<number> {
  const store = createLearningPlanStore({ db: await getDb() });
  return fillLearningPlans(store, (ctx) => planLearning(ctx), targetSetId);
}

export async function getLearningPlanStore() {
  return createLearningPlanStore({ db: await getDb() });
}
