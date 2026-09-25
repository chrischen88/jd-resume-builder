import "server-only";

import type { LearningPlan } from "@/lib/ai/learning-plan";
import type { LearningPlanContext } from "@/lib/ai/prompts/learning-plan";

import type { LearningPlanStore } from "./store";

// Fills in learning items the interview created (task 1.22), one model call
// each. Runs after the answer is saved, so the interview never waits on it;
// an item that fails stays pending and is tried again next time.

export type PlanLearning = (ctx: LearningPlanContext) => Promise<LearningPlan>;

// One call per item at a time, so two requests don't both pay for it.
const running = new Set<string>();

/** Writes the plan for every pending item in the set. Returns how many were filled. */
export async function fillLearningPlans(
  store: LearningPlanStore,
  plan: PlanLearning,
  targetSetId: string,
): Promise<number> {
  let filled = 0;
  for (const item of await store.pending(targetSetId)) {
    if (running.has(item.id)) continue;
    running.add(item.id);
    try {
      const ctx = await store.context(item.id);
      if (!ctx) continue;
      await store.save(item.id, await plan(ctx));
      filled++;
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "learning_plan_failed",
          error: err instanceof Error ? err.name : "unknown",
        }),
      );
    } finally {
      running.delete(item.id);
    }
  }
  return filled;
}
