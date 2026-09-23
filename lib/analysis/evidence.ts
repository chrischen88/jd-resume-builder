import { findPhraseOffsets } from "./text";
import type { ExtractedKeyword } from "./types";

// Grounding checks for extracted keywords (CLAUDE.md: evidence_quote must
// appear verbatim in the JD; drop items that don't).

function normalizeChar(ch: string): string {
  return ch
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[•●▪◦·]/g, " ");
}

interface Normalized {
  text: string;
  /** For each char of `text`, the [start, end) range it came from in the original. */
  starts: number[];
  ends: number[];
}

/**
 * Normalizes only differences that don't change the words: letter case,
 * whitespace runs, curly vs. straight quotes, dash variants, bullet glyphs,
 * and Unicode forms. Words and other punctuation stay as they are. Keeps a
 * map back to the original so a match can be returned as the exact original
 * text.
 */
function normalizeWithMap(original: string): Normalized {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < original.length; ) {
    const ch = String.fromCodePoint(original.codePointAt(i)!);
    const next = i + ch.length;
    const normalized = normalizeChar(ch);
    if (/^\s+$/.test(normalized)) {
      if (text.length > 0) pendingSpace = true;
    } else {
      if (pendingSpace) {
        text += " ";
        starts.push(i);
        ends.push(i);
        pendingSpace = false;
      }
      for (const unit of normalized) {
        text += unit;
        for (let k = 0; k < unit.length; k++) {
          starts.push(i);
          ends.push(next);
        }
      }
    }
    i = next;
  }
  return { text, starts, ends };
}

export function normalizeForMatch(text: string): string {
  return normalizeWithMap(text).text;
}

/** Models often end a quoted sentence fragment with "." or ";" that isn't in the JD. */
function trimTrailingPunctuation(text: string): string {
  return text.replace(/[\s.;:,!?]+$/u, "");
}

export interface VerbatimMatch {
  /** The matched span exactly as it appears in the source. */
  exact: string;
  /** The fragment as matched, after normalizeForMatch (and trailing-punctuation trim). */
  normalized: string;
}

/**
 * Returns a finder for fragments that appear verbatim in `source`, modulo
 * normalizeForMatch and trailing punctuation the model may add. Normalizes
 * the source once, so it's cheap to call for many fragments.
 */
export function createVerbatimMatcher(source: string): (fragment: string) => VerbatimMatch | null {
  const src = normalizeWithMap(source);
  return (fragment) => {
    let normalized = normalizeForMatch(fragment);
    // Prefer the fragment as given; fall back to it without trailing punctuation.
    let at = normalized ? src.text.indexOf(normalized) : -1;
    if (at < 0) {
      normalized = trimTrailingPunctuation(normalized);
      at = normalized ? src.text.indexOf(normalized) : -1;
    }
    if (at < 0) return null;
    const exact = source.slice(src.starts[at], src.ends[at + normalized.length - 1]);
    return { exact, normalized };
  };
}

/**
 * The model sometimes returns a whole list as jd_phrase ("PyTorch,
 * TensorFlow, scikit-learn") for each item in it. When the phrase is a list
 * and contains the skill's name, narrow it to that name as written in the JD.
 */
export function narrowListPhrase(jdPhrase: string, skill: string): string {
  if (!/[,;/(]/.test(jdPhrase)) return jdPhrase;
  const [at] = findPhraseOffsets(jdPhrase, skill);
  return at === undefined ? jdPhrase : jdPhrase.slice(at, at + skill.trim().length);
}

export interface EvidenceCheckResult {
  kept: ExtractedKeyword[];
  droppedQuoteNotFound: number;
  droppedPhraseNotFound: number;
  droppedEmpty: number;
  duplicates: number;
}

/**
 * Keeps keywords whose evidence_quote appears verbatim in the JD (modulo
 * normalizeForMatch and trailing punctuation) and whose jd_phrase appears in
 * that quote, so a quote can't vouch for a skill it doesn't mention.
 * Kept items get their evidence_quote replaced by the exact original JD text,
 * so later lookups can use plain indexOf, and a list-shaped jd_phrase is
 * narrowed to the one skill (narrowListPhrase). Also drops empty items and
 * exact duplicates.
 */
export function checkEvidence(jdText: string, keywords: ExtractedKeyword[]): EvidenceCheckResult {
  const findInJd = createVerbatimMatcher(jdText);
  const result: EvidenceCheckResult = {
    kept: [],
    droppedQuoteNotFound: 0,
    droppedPhraseNotFound: 0,
    droppedEmpty: 0,
    duplicates: 0,
  };
  const seen = new Set<string>();

  for (const keyword of keywords) {
    const phrase = normalizeForMatch(keyword.jd_phrase);
    const skill = keyword.canonical_skill.trim();
    if (!trimTrailingPunctuation(normalizeForMatch(keyword.evidence_quote)) || !phrase || !skill) {
      result.droppedEmpty++;
      continue;
    }
    const match = findInJd(keyword.evidence_quote);
    if (!match) {
      result.droppedQuoteNotFound++;
      continue;
    }
    const { exact: exactQuote, normalized: quote } = match;
    if (!quote.includes(phrase)) {
      result.droppedPhraseNotFound++;
      continue;
    }
    const dedupeKey = [skill.toLowerCase(), phrase, keyword.importance, quote].join(
      "\u0000",
    );
    if (seen.has(dedupeKey)) {
      result.duplicates++;
      continue;
    }
    seen.add(dedupeKey);
    result.kept.push({
      ...keyword,
      canonical_skill: skill,
      jd_phrase: narrowListPhrase(keyword.jd_phrase.trim(), skill),
      evidence_quote: exactQuote,
    });
  }
  return result;
}
