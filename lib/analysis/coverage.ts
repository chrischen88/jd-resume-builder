import type { MergedSkill } from "./merge";
import { contentTokens, findPhraseOffsets } from "./text";

// Coverage of each skill against the resume (SPEC §AI design 3, F8).
// Exact + synonym matching only; embedding similarity (cosine ≥ 0.80 → weak)
// is added in task 1.10.

export type Coverage = "covered" | "weak" | "missing";

export interface SkillCoverage {
  key: string;
  coverage: Coverage;
  /** The skill wording that matched the resume, if any. */
  matchedTerm: string | null;
  /** Resume lines that support the match, in resume order (max 3). */
  evidence: string[];
}

const MAX_EVIDENCE = 3;

function resumeLines(resumeText: string): string[] {
  return resumeText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * - covered: the skill's name, a curated alias, or a JD wording appears as a
 *   whole phrase in the resume.
 * - weak: a multi-word skill isn't there verbatim, but all of its content
 *   words (roughly stemmed) appear in one resume line, e.g. "model deployment"
 *   vs "deployed models to production". Weak matches get confirmed in the
 *   interview.
 * - missing: neither.
 */
export function classifyCoverage(skills: MergedSkill[], resumeText: string): SkillCoverage[] {
  const lines = resumeLines(resumeText);
  const lineTokens = lines.map((line) => new Set(contentTokens(line)));

  return skills.map((skill) => {
    // Name and aliases first so matchedTerm prefers the canonical wording.
    const terms = [...new Set([skill.name, ...skill.aliases, ...skill.variants])];

    for (const term of terms) {
      const evidence = lines.filter((line) => findPhraseOffsets(line, term).length > 0);
      if (evidence.length > 0) {
        return {
          key: skill.key,
          coverage: "covered",
          matchedTerm: term,
          evidence: evidence.slice(0, MAX_EVIDENCE),
        };
      }
    }

    for (const term of terms) {
      const tokens = [...new Set(contentTokens(term))];
      if (tokens.length < 2) continue;
      const evidence = lines.filter((_, i) => tokens.every((t) => lineTokens[i].has(t)));
      if (evidence.length > 0) {
        return {
          key: skill.key,
          coverage: "weak",
          matchedTerm: term,
          evidence: evidence.slice(0, MAX_EVIDENCE),
        };
      }
    }

    return { key: skill.key, coverage: "missing", matchedTerm: null, evidence: [] };
  });
}
