import { SKILL_SYNONYMS } from "./synonyms";
import type { ExtractedKeyword, Importance, JobKeywords, SkillCategory } from "./types";

// Merges per-JD keywords into canonical skills across the whole target set
// (SPEC F6). Deterministic: the same input always yields the same output.

/**
 * Grouping key for a skill name: case-, spacing-, and punctuation-insensitive,
 * but keeps `+` and `#` so C++ and C# don't collapse into C.
 */
export function skillKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}+#]/gu, "");
}

export type SynonymMap = Record<string, string[]>;

interface Lexicon {
  /** skillKey → canonical display name. */
  canonicalByKey: Map<string, string>;
  /** canonical display name → every curated spelling (canonical + aliases). */
  aliasesByCanonical: Map<string, string[]>;
}

/**
 * Builds the lookup from a synonym map. Later maps win on conflicts, so user
 * synonyms passed after the built-in map override it (SPEC: user overrides win).
 */
export function buildLexicon(...maps: SynonymMap[]): Lexicon {
  const canonicalByKey = new Map<string, string>();
  for (const map of maps) {
    for (const [canonical, aliases] of Object.entries(map)) {
      for (const name of [canonical, ...aliases]) {
        canonicalByKey.set(skillKey(name), canonical);
      }
    }
  }
  const aliasesByCanonical = new Map<string, string[]>();
  for (const map of maps) {
    for (const [canonical, aliases] of Object.entries(map)) {
      for (const name of [canonical, ...aliases]) {
        // Skip names a later map reassigned to a different canonical skill.
        if (canonicalByKey.get(skillKey(name)) !== canonical) continue;
        const list = aliasesByCanonical.get(canonical) ?? [];
        if (!list.includes(name)) list.push(name);
        aliasesByCanonical.set(canonical, list);
      }
    }
  }
  return { canonicalByKey, aliasesByCanonical };
}

const DEFAULT_LEXICON = buildLexicon(SKILL_SYNONYMS);

export interface SkillMention {
  jobId: string;
  jdPhrase: string;
  importance: Importance;
  evidenceQuote: string;
}

export interface MergedSkill {
  /** Stable id for this skill within the target set (a skillKey). */
  key: string;
  /** Display name: the curated canonical name, else the most common spelling. */
  name: string;
  category: SkillCategory;
  /** Every mention, in input order, with the JD's exact wording. */
  mentions: SkillMention[];
  /** Distinct JD phrases and model canonical names seen, excluding `name`. */
  variants: string[];
  /** Distinct JD ids that mention this skill, in first-seen order. */
  jobIds: string[];
  /** Curated spellings from the synonym map (empty for uncurated skills). */
  aliases: string[];
}

export interface MergeOptions {
  /** User-defined synonyms; override the built-in map. */
  synonyms?: SynonymMap;
}

/** Resolves a name to its canonical key, trying the model's name then the JD phrase. */
function resolveKey(keyword: ExtractedKeyword, lexicon: Lexicon): { key: string; curated?: string } {
  for (const candidate of [keyword.canonical_skill, keyword.jd_phrase]) {
    const curated = lexicon.canonicalByKey.get(skillKey(candidate));
    if (curated) return { key: skillKey(curated), curated };
  }
  return { key: skillKey(keyword.canonical_skill) };
}

/** Most frequent value; ties go to the one seen first. */
function mostCommon<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  for (const v of values) if (counts.get(v)! > counts.get(best)!) best = v;
  return best;
}

export function mergeSkills(jobs: JobKeywords[], options: MergeOptions = {}): MergedSkill[] {
  const lexicon = options.synonyms
    ? buildLexicon(SKILL_SYNONYMS, options.synonyms)
    : DEFAULT_LEXICON;

  const groups = new Map<
    string,
    { curated?: string; spellings: string[]; categories: SkillCategory[]; mentions: SkillMention[]; phrases: string[] }
  >();

  for (const job of jobs) {
    for (const keyword of job.keywords) {
      const { key, curated } = resolveKey(keyword, lexicon);
      if (!key) continue; // name was only punctuation
      let group = groups.get(key);
      if (!group) {
        group = { curated, spellings: [], categories: [], mentions: [], phrases: [] };
        groups.set(key, group);
      }
      group.curated ??= curated;
      group.spellings.push(keyword.canonical_skill.trim());
      group.categories.push(keyword.category);
      group.phrases.push(keyword.jd_phrase.trim(), keyword.canonical_skill.trim());
      group.mentions.push({
        jobId: job.jobId,
        jdPhrase: keyword.jd_phrase,
        importance: keyword.importance,
        evidenceQuote: keyword.evidence_quote,
      });
    }
  }

  return [...groups.entries()].map(([key, group]) => {
    const name = group.curated ?? mostCommon(group.spellings);
    const seen = new Set([name.toLowerCase()]);
    const variants: string[] = [];
    for (const phrase of group.phrases) {
      const lower = phrase.toLowerCase();
      if (phrase && !seen.has(lower)) {
        seen.add(lower);
        variants.push(phrase);
      }
    }
    return {
      key,
      name,
      category: mostCommon(group.categories),
      mentions: group.mentions,
      variants,
      jobIds: [...new Set(group.mentions.map((m) => m.jobId))],
      aliases: group.curated ? (lexicon.aliasesByCanonical.get(group.curated) ?? []) : [],
    };
  });
}
