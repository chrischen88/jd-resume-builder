import { COVERAGE_CREDIT } from "./config";
import { classifyCoverage, type Coverage } from "./coverage";
import type { SkillCategory } from "./types";

// Coverage score across a target set, before/after (SPEC F17, task 1.24).
// Deterministic: the same lexical matching as analysis (classifyCoverage),
// re-run on the resume text, weighted by each skill's demand score. The
// embedding pass isn't repeated, so "before" and "after" compare like with
// like without a model call.

export interface ScoredSkill {
  key: string;
  name: string;
  category: SkillCategory;
  /** Wordings that count as naming the skill; the first is its name. */
  terms: string[];
  demandScore: number;
}

export interface CoverageScore {
  /** 0–100, rounded; null when the set has no skills. */
  score: number | null;
  counts: Record<Coverage, number>;
  bySkill: Map<string, Coverage>;
}

export function coverageScore(skills: ScoredSkill[], resumeText: string): CoverageScore {
  const coverage = classifyCoverage(
    skills.map((s) => ({
      key: s.key,
      name: s.terms[0] ?? s.name,
      category: s.category,
      mentions: [],
      variants: s.terms.slice(1),
      jobIds: [],
      aliases: [],
    })),
    resumeText,
  );
  const bySkill = new Map(coverage.map((c) => [c.key, c.coverage]));
  const counts: Record<Coverage, number> = { covered: 0, weak: 0, missing: 0 };
  let earned = 0;
  let total = 0;
  for (const skill of skills) {
    const level = bySkill.get(skill.key)!;
    counts[level]++;
    earned += skill.demandScore * COVERAGE_CREDIT[level];
    total += skill.demandScore;
  }
  return { score: total > 0 ? Math.round((100 * earned) / total) : null, counts, bySkill };
}

export interface ScoreChange {
  key: string;
  name: string;
  before: Coverage;
  after: Coverage;
}

/** Skills whose coverage changed between two scores, most in demand first. */
export function coverageChanges(
  skills: ScoredSkill[],
  before: CoverageScore,
  after: CoverageScore,
): ScoreChange[] {
  return [...skills]
    .sort((a, b) => b.demandScore - a.demandScore)
    .map((s) => ({
      key: s.key,
      name: s.name,
      before: before.bySkill.get(s.key)!,
      after: after.bySkill.get(s.key)!,
    }))
    .filter((c) => c.before !== c.after);
}
