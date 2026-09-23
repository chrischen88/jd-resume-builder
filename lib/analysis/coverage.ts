import { WEAK_COVERAGE_SIMILARITY } from "./config";
import type { MergedSkill } from "./merge";
import { cosineSimilarity } from "./similarity";
import { contentTokens, findPhraseOffsets } from "./text";
import type { SkillCategory } from "./types";

// Coverage of each skill against the resume (SPEC §AI design 3, F8).
// classifyCoverage: exact + synonym matching. semanticWeakMatches: the
// embedding pass over what's still missing (cosine ≥ 0.80 → weak).

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

/** Shortest stem that may match a longer word form ("communicat" ~ "communication"). */
const MIN_PREFIX_STEM = 6;

/**
 * Loose match between two stemmed words: one is a prefix of the other and
 * the shared part is long enough to be meaningful ("communicat" and
 * "communication", "statistic" and "statistical").
 */
function sameWordFamily(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_PREFIX_STEM && long.startsWith(short);
}

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
 *   vs "deployed models to production". Or a one-word skill that isn't a
 *   tool appears in another word form ("Communicated" for Communication).
 *   Tools are skipped: their names aren't inflected, so a near-match is a
 *   different word. Weak matches get confirmed in the interview.
 * - missing: neither.
 */
export function classifyCoverage(skills: MergedSkill[], resumeText: string): SkillCoverage[] {
  const lines = resumeLines(resumeText);
  const lineTokenLists = lines.map((line) => contentTokens(line));
  const lineTokens = lineTokenLists.map((tokens) => new Set(tokens));

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

    if (skill.category !== "tool") {
      for (const term of terms) {
        const tokens = [...new Set(contentTokens(term))];
        if (tokens.length !== 1) continue;
        const evidence = lines.filter((_, i) =>
          lineTokenLists[i].some((t) => sameWordFamily(t, tokens[0])),
        );
        if (evidence.length > 0) {
          return {
            key: skill.key,
            coverage: "weak",
            matchedTerm: term,
            evidence: evidence.slice(0, MAX_EVIDENCE),
          };
        }
      }
    }

    return { key: skill.key, coverage: "missing", matchedTerm: null, evidence: [] };
  });
}

export interface EmbeddedLine {
  text: string;
  vector: number[];
}

export interface SemanticCandidate {
  key: string;
  category: SkillCategory;
  coverage: Coverage;
  /** The skill's JD requirement lines. */
  mentions: { evidenceQuote: string }[];
}

/**
 * Embedding pass after classifyCoverage. A missing skill becomes weak when one
 * of its JD requirement lines has cosine similarity ≥ threshold with an
 * experience bullet. Only bullets count: summary and skills-list lines read as
 * similar to almost any requirement. Tools are skipped, as in the lexical
 * pass: a similar tool list names different tools.
 *
 * Returns the matching bullets (best first, max 3) for each skill that
 * becomes weak.
 */
export function semanticWeakMatches(
  skills: SemanticCandidate[],
  bullets: EmbeddedLine[],
  quoteVector: (quote: string) => number[] | undefined,
  threshold = WEAK_COVERAGE_SIMILARITY,
): Map<string, string[]> {
  const matches = new Map<string, string[]>();
  for (const skill of skills) {
    if (skill.coverage !== "missing" || skill.category === "tool") continue;
    const quoteVectors = [...new Set(skill.mentions.map((m) => m.evidenceQuote))]
      .map(quoteVector)
      .filter((v): v is number[] => v !== undefined);
    const scored = bullets
      .map((bullet) => ({
        text: bullet.text,
        score: Math.max(-1, ...quoteVectors.map((v) => cosineSimilarity(v, bullet.vector))),
      }))
      .filter((b) => b.score >= threshold)
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      matches.set(
        skill.key,
        scored.slice(0, MAX_EVIDENCE).map((b) => b.text),
      );
    }
  }
  return matches;
}
