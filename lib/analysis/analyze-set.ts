import { narrowListPhrase } from "./evidence";
import { classifyCoverage, type SkillCoverage } from "./coverage";
import { mergeSkills, type MergeOptions } from "./merge";
import { scoreSkills, type JobText, type SkillDemand } from "./score";
import type { ExtractedKeyword, SkillCategory } from "./types";

// Runs the deterministic pipeline over one target set: merge → score →
// coverage (SPEC §AI design 2–3). Input is already-extracted keywords.

export interface AnalyzedJob extends JobText {
  keywords: ExtractedKeyword[];
}

export interface SkillRow extends SkillDemand {
  category: SkillCategory;
  coverage: SkillCoverage["coverage"];
  matchedTerm: string | null;
  resumeEvidence: string[];
}

export function analyzeSet(
  jobs: AnalyzedJob[],
  resumeText: string,
  options: MergeOptions = {},
): SkillRow[] {
  const merged = mergeSkills(
    jobs.map((job) => ({
      jobId: job.jobId,
      // checkEvidence already narrows new extractions; this also covers ones
      // cached before it did. Idempotent.
      keywords: job.keywords.map((k) => ({
        ...k,
        jd_phrase: narrowListPhrase(k.jd_phrase, k.canonical_skill),
      })),
    })),
    options,
  );
  const demands = scoreSkills(merged, jobs);
  const skillsByKey = new Map(merged.map((skill) => [skill.key, skill]));
  const coverageByKey = new Map(
    classifyCoverage(merged, resumeText).map((c) => [c.key, c]),
  );

  return demands.map((demand) => {
    const coverage = coverageByKey.get(demand.key)!;
    return {
      ...demand,
      category: skillsByKey.get(demand.key)!.category,
      coverage: coverage.coverage,
      matchedTerm: coverage.matchedTerm,
      resumeEvidence: coverage.evidence,
    };
  });
}
