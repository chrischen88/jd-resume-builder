import "server-only";

import type { LearningResource } from "@/db/schema";
import {
  cleanMeaning,
  cleanRelatedSkills,
  cleanResources,
  vocabulary,
} from "@/lib/learning-plan/checks";

import {
  callStructured,
  defaultGuardrailLogger,
  type AiGuardrailLogger,
  type CallOptions,
} from "./client";
import {
  learningPlanInput,
  learningPlanPrompt,
  type LearningPlanContext,
} from "./prompts/learning-plan";

// Model call for the learning plan (task 1.22). Validates and cleans what
// the model returns; nothing here writes to the database.

type Options = CallOptions & { guardrailLogger?: AiGuardrailLogger };

export interface LearningPlan {
  meaning: string | null;
  relatedSkills: string[];
  resources: LearningResource[];
  promptVersion: string;
}

/**
 * What employers mean by the skill, related skills, and ways to learn it.
 * Resources naming anything the input doesn't (a course, provider, URL) are
 * dropped, so the plan can come back with fewer than the model wrote.
 */
export async function planLearning(
  ctx: LearningPlanContext,
  options: Options = {},
): Promise<LearningPlan> {
  const { data } = await callStructured(learningPlanPrompt, learningPlanInput(ctx), options);
  const relatedSkills = cleanRelatedSkills(data.related_skills, [ctx.skill, ...ctx.phrases]);
  const known = vocabulary([
    ctx.skill,
    ...ctx.phrases,
    ...ctx.jdSentences,
    ...ctx.nearbySkills,
    ...relatedSkills,
  ]);
  const { resources, problems } = cleanResources(data.resources, known);

  const counts: Record<string, number> = {
    related_skills: data.related_skills.length,
    related_skills_kept: relatedSkills.length,
    resources: data.resources.length,
    resources_kept: resources.length,
  };
  for (const problem of problems) {
    counts[`dropped_${problem}`] = (counts[`dropped_${problem}`] ?? 0) + 1;
  }
  (options.guardrailLogger ?? defaultGuardrailLogger)({
    prompt_id: learningPlanPrompt.id,
    prompt_version: learningPlanPrompt.version,
    counts,
  });

  return {
    meaning: cleanMeaning(data.meaning),
    relatedSkills,
    resources,
    promptVersion: learningPlanPrompt.version,
  };
}
