import "server-only";

import { getDb } from "@/db/client";
import { planLearning } from "@/lib/ai/learning-plan";

import { fillLearningPlans } from "./generate";
import { createLearningPlanStore } from "./store";

/** Writes the plan for the set's pending learning items (see generate.ts). */
export async function fillPendingLearningPlans(targetSetId: string): Promise<number> {
  const store = createLearningPlanStore({ db: await getDb() });
  return fillLearningPlans(store, (ctx) => planLearning(ctx), targetSetId);
}
