// Guardrails for the learning_plan prompt (task 1.22, CLAUDE.md: "Never
// output invented course names or URLs"). Pure functions, unit-tested.

/** Longest "what employers mean" text kept. */
const MAX_MEANING_CHARS = 400;
/** Longest resource description kept. */
const MAX_RESOURCE_CHARS = 300;
/** Longest related-skill name kept. */
const MAX_SKILL_CHARS = 40;
export const MAX_RELATED_SKILLS = 4;
export const MAX_RESOURCES = 4;

/**
 * Names resources may use though the input doesn't have them (the curated
 * list CLAUDE.md allows). Lowercase.
 */
export const CURATED_NAMES = ["github", "i"];

export type ResourceProblem = "url" | "quoted_title" | "unknown_name";

const URL_RE =
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|edu|dev|ai|co|gov|ly)\b/i;
const QUOTE_RE = /["“”«»]/;
const WORD_RE = /[A-Za-z][A-Za-z0-9+#]*(?:[.'’-][A-Za-z0-9+#]+)*/g;

function squash(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

/** Lowercased words in the texts, for checking names against the input. */
export function vocabulary(texts: string[]): Set<string> {
  const words = new Set<string>(CURATED_NAMES);
  for (const text of texts) {
    for (const word of text.match(WORD_RE) ?? []) words.add(word.toLowerCase());
  }
  return words;
}

/**
 * Why a resource description can't be shown, or null when it's generic. A
 * capitalized word that doesn't start a sentence counts as a name, and names
 * are allowed only when the input already has them (the skill, the JD
 * sentences, the person's skills): a certification the JD names is fine, a
 * course title or provider the model came up with is not.
 */
export function resourceProblem(description: string, known: Set<string>): ResourceProblem | null {
  if (URL_RE.test(description)) return "url";
  if (QUOTE_RE.test(description)) return "quoted_title";
  for (const match of description.matchAll(WORD_RE)) {
    const word = match[0];
    if (!/[A-Z]/.test(word)) continue;
    const before = description.slice(0, match.index).trimEnd();
    const startsSentence = before === "" || /[.!?:;(]$/.test(before);
    // A sentence's first word is only a name if it's an acronym or possessive.
    if (startsSentence && !/[A-Z].*[A-Z]|['’]s$/.test(word)) continue;
    if (!known.has(word.toLowerCase())) return "unknown_name";
  }
  return null;
}

export function cleanMeaning(text: string): string | null {
  const meaning = squash(text);
  return meaning ? meaning.slice(0, MAX_MEANING_CHARS) : null;
}

/** Trimmed, deduplicated, without the skill itself; at most MAX_RELATED_SKILLS. */
export function cleanRelatedSkills(names: string[], skillNames: string[]): string[] {
  const seen = new Set(skillNames.map((n) => squash(n).toLowerCase()));
  const kept: string[] = [];
  for (const raw of names) {
    const name = squash(raw).replace(/[.;,]$/, "");
    const key = name.toLowerCase();
    if (!name || name.length > MAX_SKILL_CHARS || seen.has(key) || URL_RE.test(name)) continue;
    seen.add(key);
    kept.push(name);
  }
  return kept.slice(0, MAX_RELATED_SKILLS);
}

export interface Resource {
  kind: string;
  description: string;
}

/**
 * Resources that pass resourceProblem, one per kind, at most MAX_RESOURCES.
 * Returns the problems found, for guardrail counts.
 */
export function cleanResources(resources: Resource[], known: Set<string>) {
  const kept: Resource[] = [];
  const problems: ResourceProblem[] = [];
  for (const r of resources) {
    const description = squash(r.description);
    if (!description || kept.some((k) => k.kind === r.kind)) continue;
    const problem = resourceProblem(description, known);
    if (problem) {
      problems.push(problem);
      continue;
    }
    kept.push({ kind: r.kind, description: description.slice(0, MAX_RESOURCE_CHARS) });
  }
  return { resources: kept.slice(0, MAX_RESOURCES), problems };
}
