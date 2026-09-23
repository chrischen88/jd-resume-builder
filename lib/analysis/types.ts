// Shared types for the deterministic analysis pipeline (SPEC §AI design 1–3).

export const SKILL_CATEGORIES = [
  "hard_skill",
  "tool",
  "soft_skill",
  "domain",
  "certification",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const IMPORTANCE_LEVELS = ["required", "preferred", "mentioned"] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number];

/** One keyword as extracted from one JD (the output shape of task 0.3). */
export interface ExtractedKeyword {
  /** Exact wording in the JD. */
  jd_phrase: string;
  canonical_skill: string;
  category: SkillCategory;
  importance: Importance;
  /** Verbatim sentence from the JD that supports this keyword. */
  evidence_quote: string;
}

/** All keywords extracted from one JD. */
export interface JobKeywords {
  jobId: string;
  keywords: ExtractedKeyword[];
}
