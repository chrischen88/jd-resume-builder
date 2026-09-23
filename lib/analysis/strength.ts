import { DEFAULT_STRENGTH_WEIGHTS, type StrengthWeights } from "./config";
import { findPhraseOffsets } from "./text";

// Bullet strength (SPEC §AI design 4, F9): strong verb + concrete scope +
// measurable result + in-demand keywords. Deterministic; used to pick proof
// bullets and the strongest bullets on the strengths screen.

export type VerbStrength = "strong" | "neutral" | "weak";

export interface BulletStrength {
  /** Weighted total; 0 to the sum of the weights (5 by default). */
  score: number;
  verb: VerbStrength;
  /** A number tied to what was worked on: "2B events/day", "10-person team". */
  hasScope: boolean;
  /** A number showing an outcome: "cut runtime 86%", "from 180 ms to 45 ms". */
  hasResult: boolean;
  /** In-demand skills the bullet names, highest demand first. */
  skills: string[];
}

/** A skill of the target set, with the wordings that count as naming it. */
export interface DemandTerms {
  name: string;
  terms: string[];
  jdCount: number;
}

// Action verbs that say what the person did and owned. Stems, so "lead",
// "leads", and "leading" count as well as "led".
const STRONG_VERB_STEMS = [
  "accelerat", "achiev", "architect", "automat", "boost", "built", "build", "consolidat",
  "creat", "cut", "debug", "deliver", "deploy", "design", "develop", "doubl", "drove", "drive",
  "eliminat", "engineer", "establish", "expand", "grew", "grow", "halv", "implement",
  "improv", "increas", "initiat", "introduc", "invent", "launch", "led", "lead", "migrat",
  "modernis", "moderniz", "optimis", "optimiz", "orchestrat", "overhaul", "own", "pioneer",
  "prototyp", "rebuilt", "rebuild", "redesign", "reduc", "refactor", "replac", "resolv",
  "restructur", "revamp", "saved", "scal", "ship", "simplif", "slash", "spearhead",
  "standardiz", "standardis", "streamlin", "tripl", "transform", "unifi", "won", "mentor",
];

// Openers that describe a duty or a supporting part rather than an action.
const WEAK_OPENERS = [
  "responsible for", "worked on", "worked with", "helped", "assisted", "participated",
  "involved in", "was involved", "contributed to", "supported", "tasked with",
  "duties included", "exposure to", "familiar with", "handled",
];

const oneOf = (words: string[]) => `(?:${words.join("|")})`;

/** "14", "~95", "6+", "2B", "1.5 million". */
const NUMBER = String.raw`(?:~|<|>|\+)?\d[\d,.]*\+?(?:\s?${oneOf(
  ["k", "m", "b", "bn", "mm", "million", "billion", "thousand"],
)})?`;
const NUMBER_WORD = oneOf([
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "fifteen", "twenty", "dozens", "dozen", "hundreds", "thousands", "millions", "billions",
]);
// Things whose count says how big the work was.
const SCOPE_NOUNS = oneOf([
  "users?", "customers?", "clients?", "members?", "requests?", "calls", "events?", "records?",
  "rows?", "transactions?", "queries", "documents?", "files", "services?", "microservices",
  "projects?", "products?", "teams?", "engineers?", "developers?", "analysts?", "people",
  "stakeholders", "reports", "countries", "regions", "markets", "stores", "sites", "locations",
  "models?", "pipelines?", "servers?", "nodes?", "clusters?", "applications?", "apps?",
  "repos(?:itories)?", "tables", "datasets?", "dashboards?", "accounts", "employees", "students",
  "patients", "tb", "gb", "pb", "qps", "rps",
]);
const PERIOD = oneOf(["day", "hour", "minute", "second", "sec", "month", "week", "year"]);
const CHANGE_VERB = oneOf([
  "reduc", "cut", "increas", "improv", "sav", "grew", "grow", "boost", "lift", "decreas",
  "lower", "rais", "shorten", "doubl", "tripl", "halv",
]);

const SCOPE_PATTERNS = [
  // "2B events/day", "6+ projects", "14 ranking models", "three junior engineers"
  new RegExp(String.raw`(?:${NUMBER}|\b${NUMBER_WORD})\s+(?:[\w-]+\s+){0,2}${SCOPE_NOUNS}\b`, "i"),
  // "10-person team", "team of 5"
  new RegExp(
    String.raw`\b\d+[-\s](?:person|member|engineer)\b|\bteam of (?:\d+|${NUMBER_WORD})\b`,
    "i",
  ),
  // "/day", "per second"
  new RegExp(String.raw`${NUMBER}\s*\S*\s*(?:/|per\s)${PERIOD}\b`, "i"),
];

const RESULT_PATTERNS = [
  /\d(?:[\d.]*)\s?%/, // "86%", "~95 %"
  /\b\d+(?:\.\d+)?\s?[x×](?![a-z])/i, // "3x faster"
  /\$\s?\d/, // "$2M"
  // "from 180 ms to 45 ms", "56 hrs → 8 hrs"
  new RegExp(String.raw`\bfrom\s+${NUMBER}[^.;]{0,30}?\bto\s+${NUMBER}`, "i"),
  new RegExp(String.raw`\d[^→.;]{0,20}(?:→|->)\s*${NUMBER}`, "i"),
  // "reduced late deliveries by 9", "cut costs by half"
  new RegExp(
    String.raw`\b${CHANGE_VERB}\w*\b[^.;]{0,50}?\bby\s+~?(?:\d|half|a third|a quarter)`,
    "i",
  ),
];

function openingWords(text: string): string {
  return text
    .replace(/^[\s•\-*–·>]+/, "")
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}

export function verbStrength(text: string): VerbStrength {
  const opening = openingWords(text);
  if (WEAK_OPENERS.some((w) => opening.startsWith(w))) return "weak";
  const first = opening.split(" ")[0]?.replace(/[^a-z]/g, "") ?? "";
  const strong = STRONG_VERB_STEMS.some(
    (stem) => first === stem || (first.startsWith(stem) && first.length - stem.length <= 3),
  );
  return strong ? "strong" : "neutral";
}

export function hasScope(text: string): boolean {
  return SCOPE_PATTERNS.some((p) => p.test(text));
}

export function hasResult(text: string): boolean {
  return RESULT_PATTERNS.some((p) => p.test(text));
}

const VERB_POINTS: Record<VerbStrength, number> = { strong: 1, neutral: 0.5, weak: 0 };

export function scoreBullet(
  text: string,
  demands: DemandTerms[],
  jobCount: number,
  weights: StrengthWeights = DEFAULT_STRENGTH_WEIGHTS,
): BulletStrength {
  const verb = verbStrength(text);
  const scope = hasScope(text);
  const result = hasResult(text);
  const named = demands
    .filter((d) => d.terms.some((term) => findPhraseOffsets(text, term).length > 0))
    .sort((a, b) => b.jdCount - a.jdCount);
  const keywordShare =
    jobCount > 0 ? Math.min(1, named.reduce((sum, d) => sum + d.jdCount / jobCount, 0)) : 0;

  const score =
    weights.verb * VERB_POINTS[verb] +
    weights.scope * (scope ? 1 : 0) +
    weights.result * (result ? 1 : 0) +
    weights.keywords * keywordShare;
  return {
    score: Math.round(score * 100) / 100,
    verb,
    hasScope: scope,
    hasResult: result,
    skills: named.map((d) => d.name),
  };
}

/**
 * Bullets by strength, strongest first; ties keep resume order. Returns at
 * most `limit`.
 */
export function strongestBullets<B extends { text: string }>(
  bullets: B[],
  demands: DemandTerms[],
  jobCount: number,
  limit = 5,
): (B & { strength: BulletStrength })[] {
  const scored = bullets.map((bullet) => ({
    ...bullet,
    strength: scoreBullet(bullet.text, demands, jobCount),
  }));
  // Array.prototype.sort is stable, so ties keep resume order.
  return scored.sort((a, b) => b.strength.score - a.strength.score).slice(0, limit);
}
