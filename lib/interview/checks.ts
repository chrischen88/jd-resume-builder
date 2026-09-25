import { MAX_PHRASE_USES } from "@/lib/analysis/reword";
import { findPhraseOffsets } from "@/lib/analysis/text";

// Deterministic checks around the interview's model calls (SPEC §AI design
// 6–7): they back up the prompts' rules, so a rule the model breaks is
// caught here rather than trusted.

/** Longest JD wording worked into a bullet; longer ones carry more than the skill. */
const MAX_PHRASE_WORDS = 3;

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** "86", "1.5", "2,000" → "2000"; commas are formatting. */
function numbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/** Numbers in the bullet that the user never gave (SPEC: metric only if the user gave it). */
export function unsupportedNumbers(bullet: string, sources: string[]): string[] {
  const known = new Set(sources.flatMap(numbers));
  return [...new Set(numbers(bullet).filter((n) => !known.has(n)))];
}

/** Whether a claim's supporting quote really appears in the sources. */
export function quoteFound(quote: string | null, sources: string[]): boolean {
  const q = normalize(quote ?? "");
  return q.length >= 3 && sources.some((s) => normalize(s).includes(q));
}

/** In-demand skills the bullet names, by their wordings (keywords_hit). */
export function keywordsHit(text: string, skills: { name: string; terms: string[] }[]): string[] {
  return skills
    .filter((s) => [s.name, ...s.terms].some((t) => findPhraseOffsets(text, t).length > 0))
    .map((s) => s.name);
}

/**
 * The JD wording to use in the bullet: the most used phrasing of up to three
 * words, else the skill name. Null if the resume already uses it
 * MAX_PHRASE_USES times (CLAUDE.md: cap each JD phrase at 3 uses).
 */
export function bulletPhrase(
  skillName: string,
  jdPhrases: string[],
  resumeText: string,
): string | null {
  const phrase = jdPhrases.find((p) => p.split(/\s+/).length <= MAX_PHRASE_WORDS) ?? skillName;
  return findPhraseOffsets(resumeText, phrase).length >= MAX_PHRASE_USES ? null : phrase;
}

const questionWords = (text: string) =>
  new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/**
 * Whether a new question repeats an earlier one: most of its words (Jaccard
 * ≥ 0.7) are the same. The model is told not to repeat itself; this catches
 * it when it does.
 */
export function repeatsQuestion(question: string, previous: string[]): boolean {
  const words = questionWords(question);
  return previous.some((p) => {
    const other = questionWords(p);
    const shared = [...words].filter((w) => other.has(w)).length;
    const union = new Set([...words, ...other]).size;
    return union > 0 && shared / union >= 0.7;
  });
}

const ASKS_FOR_NUMBER = /\b(how many|how much|what (percentage|percent|number)|by how)\b/i;
const NO_NUMBER = new RegExp(
  [
    String.raw`\b(don'?t|do not|can'?t|cannot) (know|remember|recall)\b`,
    String.raw`\bno (exact )?(number|idea|figure)\b`,
    String.raw`\bnot sure\b`,
  ].join("|"),
  "i",
);

/** Whether the question asks for a number after the user said they don't have one. */
export function asksForMissingNumber(question: string, answers: string[]): boolean {
  return ASKS_FOR_NUMBER.test(question) && answers.some((a) => NO_NUMBER.test(a));
}

/** A role still held: no end date, or "Present" / "Current" / "Now". */
export function isCurrentRole(endDate: string | null): boolean {
  return !endDate?.trim() || /present|current|now/i.test(endDate);
}
