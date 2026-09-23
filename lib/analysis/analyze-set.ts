import { narrowListPhrase } from "./evidence";
import { classifyCoverage, type SkillCoverage } from "./coverage";
import { mergeSkills, type MergeOptions, type SkillMention } from "./merge";
import { scoreSkills, type JobText, type SkillDemand } from "./score";
import type { ExtractedKeyword, SkillCategory } from "./types";

// Runs the deterministic pipeline over one target set: merge → score →
// coverage (SPEC §AI design 2–3). Input is already-extracted keywords.

export interface AnalyzedJob extends JobText {
  keywords: ExtractedKeyword[];
}

export interface SkillAnalysisRow extends SkillDemand {
  category: SkillCategory;
  /** Every mention across the set, with list-shaped phrases narrowed. */
  mentions: SkillMention[];
  /** Wordings that count as naming the skill: name, curated aliases, JD phrasings. */
  terms: string[];
  coverage: SkillCoverage["coverage"];
  matchedTerm: string | null;
  resumeEvidence: string[];
}

export function analyzeSet(
  jobs: AnalyzedJob[],
  resumeText: string,
  options: MergeOptions = {},
): SkillAnalysisRow[] {
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
    const skill = skillsByKey.get(demand.key)!;
    return {
      ...demand,
      category: skill.category,
      mentions: skill.mentions,
      terms: [...new Set([skill.name, ...skill.aliases, ...skill.variants])],
      coverage: coverage.coverage,
      matchedTerm: coverage.matchedTerm,
      resumeEvidence: coverage.evidence,
    };
  });
}
