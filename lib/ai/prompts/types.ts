import type { z } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * A versioned prompt. Each prompt lives in its own file under lib/ai/prompts
 * and bumps `version` whenever its text or schema changes, so logs and golden
 * tests can be tied to an exact prompt revision.
 */
export interface PromptDefinition<Schema extends z.ZodType> {
  id: string;
  version: string;
  system: string;
  schema: Schema;
  maxTokens?: number;
  effort?: Effort;
}
