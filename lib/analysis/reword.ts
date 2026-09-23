import type { Coverage } from "./coverage";
import { contentTokens, findPhraseOffsets } from "./text";

// Rewording suggestions (SPEC §AI design 4, F9): which bullets to reword, and
// a check on what the model sends back. The rewording itself is a model call
// (lib/ai/reword-bullets.ts); nothing here changes the resume.

/** CLAUDE.md: each JD phrase at most 3 times across the resume. */
export const MAX_PHRASE_USES = 3;
/** Suggestions per request, highest-demand skills first. */
export const MAX_SUGGESTIONS = 10;
/**
 * Longest JD phrasing used as the phrase to work in. Longer ones carry more
 * than the skill ("building and deploying ML models" also claims building
 * them), so the skill's own name is used instead.
 */
const MAX_PHRASE_WORDS = 3;
/** Words a rewording may add beyond the phrase itself. */
const MAX_EXTRA_WORDS = 6;
/** Adverbs that inflate a claim without adding a fact. */
const INTENSIFIERS = new Set([
  "successfully", "significantly", "greatly", "substantially", "dramatically", "expertly",
  "effectively", "efficiently", "strategically", "extensively", "highly", "seamlessly",
]);

export interface RewordSkill {
  skillId: string;
  name: string;
  coverage: Coverage;
  rank: number;
  /** Wordings that count as naming the skill (skill_demands.terms). */
  terms: string[];
  /** The set's JD phrasings for the skill, most used first. */
  jdPhrases: string[];
  /** Resume lines behind the coverage (skill_demands.coverage_evidence). */
  evidence: string[];
  proofBulletId: string | null;
}

export interface RewordCandidate {
  skillId: string;
  skillName: string;
  bulletId: string;
  bulletText: string;
  /** The JD wording to work in. */
  phrase: string;
  /** The skill's wordings; a rewording may replace these in the bullet. */
  terms: string[];
}

function uses(text: string, phrase: string): number {
  return findPhraseOffsets(text, phrase).length;
}

/**
 * Bullets that show a skill in words the JDs don't use:
 * - a weak skill whose evidence is a bullet ("Queried and analyzed complex
 *   datasets" for "Analytical skills");
 * - a covered skill whose proof bullet names it only by an alias no JD uses
 *   ("k8s" when the JDs say "Kubernetes").
 * Skills named only in the skills list or summary are skipped: working them
 * into a bullet would add a claim, which the gap interview handles.
 * One suggestion per bullet; a phrase already used MAX_PHRASE_USES times is
 * skipped.
 */
export function rewordCandidates(
  skills: RewordSkill[],
  bullets: { id: string; text: string }[],
  resumeText: string,
  limit = MAX_SUGGESTIONS,
): RewordCandidate[] {
  const candidates: RewordCandidate[] = [];
  const usedBullets = new Set<string>();

  for (const skill of [...skills].sort((a, b) => a.rank - b.rank)) {
    if (candidates.length >= limit) break;
    const phrase =
      skill.jdPhrases.find((p) => p.split(/\s+/).length <= MAX_PHRASE_WORDS) ?? skill.name;
    if (uses(resumeText, phrase) >= MAX_PHRASE_USES) continue;

    let bullet: { id: string; text: string } | undefined;
    if (skill.coverage === "weak") {
      const evidence = new Set(skill.evidence.map((line) => line.trim()));
      bullet = bullets.find((b) => evidence.has(b.text.trim()) && !usedBullets.has(b.id));
    } else if (skill.coverage === "covered" && skill.proofBulletId) {
      const proof = bullets.find((b) => b.id === skill.proofBulletId);
      const jdWording = [skill.name, ...skill.jdPhrases];
      if (proof && !usedBullets.has(proof.id) && !jdWording.some((w) => uses(proof.text, w) > 0)) {
        bullet = proof;
      }
    }
    if (!bullet || uses(bullet.text, phrase) > 0) continue;

    usedBullets.add(bullet.id);
    candidates.push({
      skillId: skill.skillId,
      skillName: skill.name,
      bulletId: bullet.id,
      bulletText: bullet.text,
      phrase,
      terms: skill.terms,
    });
  }
  return candidates;
}

export type RewordCheck =
  | { ok: true; text: string }
  | {
      ok: false;
      reason:
        | "unchanged"
        | "missing_phrase"
        | "new_number"
        | "new_name"
        | "new_intensifier"
        | "dropped_name"
        | "dropped_content"
        | "too_long";
    };

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** "86", "1.5", "2,000" as written. */
function numbers(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

/** Word pieces with edge punctuation trimmed; "LLM-driven" → "LLM", "driven". */
function pieces(text: string): string[] {
  return words(text)
    .flatMap((w) => w.split(/[-/]/))
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu, ""))
    .filter(Boolean);
}

/**
 * Pieces that look like names (tools, products, employers): capitalized past
 * the first word, mixed case, or containing digits, "+", or "#".
 */
function names(text: string): string[] {
  return pieces(text)
    .slice(1)
    .filter((w) => /^\p{Lu}/u.test(w) || /\p{Ll}\p{Lu}/u.test(w) || /[\d+#]/.test(w));
}

const lower = (list: string[]) => new Set(list.map((w) => w.toLowerCase()));

/** Rough word root, so tense changes don't count ("queried" ~ "query", "analyzed" ~ "analyze"). */
function root(token: string): string {
  return token
    .replace(/ied$|ies$/, "y")
    .replace(/(ing|ed|es|s)$/, "")
    .replace(/e$/, "")
    // contentTokens already turns "queried" into "queri".
    .replace(/i$/, "y");
}

const roots = (text: string) => new Set(contentTokens(text).map(root));

/**
 * Checks a suggested rewording against the original bullet. It must use the
 * phrase; may not add numbers, names, or intensifiers ("successfully"); may
 * not drop any word except the skill's own wordings, which the phrase
 * replaces (with the rest of a compound: "LLM-driven"); and may not grow
 * much longer. It can't catch every changed claim (the prompt forbids those too),
 * but it catches the ones that matter most on a resume.
 */
export function checkRewording(
  original: string,
  suggestion: string,
  phrase: string,
  terms: string[] = [],
): RewordCheck {
  const text = suggestion.trim().replace(/\s+/g, " ");
  if (text === original.trim().replace(/\s+/g, " ")) return { ok: false, reason: "unchanged" };
  if (uses(text, phrase) === 0) return { ok: false, reason: "missing_phrase" };

  const originalNumbers = new Set(numbers(original));
  if (numbers(text).some((n) => !originalNumbers.has(n) && !numbers(phrase).includes(n))) {
    return { ok: false, reason: "new_number" };
  }
  const known = lower([...pieces(original), ...pieces(phrase)]);
  if (names(text).some((w) => !known.has(w.toLowerCase()))) {
    return { ok: false, reason: "new_name" };
  }
  const originalPieces = lower(pieces(original));
  const isNewIntensifier = (w: string) =>
    INTENSIFIERS.has(w.toLowerCase()) && !originalPieces.has(w.toLowerCase());
  if (pieces(text).some(isNewIntensifier)) {
    return { ok: false, reason: "new_intensifier" };
  }

  // The phrase may replace the skill's own wordings ("k8s" → "Kubernetes"),
  // with the rest of a compound they're part of ("LLM-driven").
  const termPieces = lower(terms.flatMap(pieces));
  const compounds = words(original).filter((w) =>
    pieces(w).some((p) => termPieces.has(p.toLowerCase())),
  );
  const replaceable = new Set([...termPieces, ...lower(compounds.flatMap(pieces))]);
  const kept = lower(pieces(text));
  const isDropped = (w: string) => !kept.has(w.toLowerCase()) && !replaceable.has(w.toLowerCase());
  if (names(original).some(isDropped)) {
    return { ok: false, reason: "dropped_name" };
  }
  const keptRoots = roots(text);
  const replaceableRoots = new Set([...terms, ...compounds].flatMap((t) => [...roots(t)]));
  if ([...roots(original)].some((r) => !keptRoots.has(r) && !replaceableRoots.has(r))) {
    return { ok: false, reason: "dropped_content" };
  }

  if (words(text).length > words(original).length + words(phrase).length + MAX_EXTRA_WORDS) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, text };
}
