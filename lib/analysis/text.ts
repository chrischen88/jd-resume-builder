// Text matching shared by scoring and coverage.

/**
 * Skill names that are also ordinary English words (or single letters). A
 * match only counts if it starts with a capital, so "go-to-market" doesn't
 * count as Go and "rust-proof" doesn't count as Rust.
 */
const AMBIGUOUS_TERMS = new Set([
  "c",
  "r",
  "go",
  "rust",
  "swift",
  "spark",
  "dart",
  "julia",
  "ruby",
  "rest",
  "chef",
  "puppet",
  "hive",
  "pig",
  "flask",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Start offsets of every whole-phrase, case-insensitive match. A boundary is
 * any character other than a letter, digit, "+", or "#" (not \b), so "C++"
 * matches and "C" doesn't match inside "C++" or "C#". Ambiguous terms (see
 * AMBIGUOUS_TERMS) must start with a capital letter.
 */
export function findPhraseOffsets(text: string, phrase: string): number[] {
  const trimmed = phrase.trim();
  if (!trimmed) return [];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}+#])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}+#])`,
    "giu",
  );
  const ambiguous = AMBIGUOUS_TERMS.has(trimmed.toLowerCase());
  return [...text.matchAll(pattern)]
    .filter((m) => !ambiguous || /^\p{Lu}/u.test(m[0]))
    .map((m) => m.index);
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "for",
  "with",
  "in",
  "on",
  "to",
  "using",
  "via",
  "experience",
  "knowledge",
  "skills",
  "strong",
  "proficiency",
  "familiarity",
]);

/** Crude suffix stripping so "deploying models" and "model deployment" share tokens. */
function stem(token: string): string {
  if (token.length > 6 && token.endsWith("ment")) return token.slice(0, -4);
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es") && !token.endsWith("ies")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Lowercased, stemmed content words (stopwords removed). */
export function contentTokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? [])
    .filter((t) => !STOPWORDS.has(t))
    .map(stem);
}
