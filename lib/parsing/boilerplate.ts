// Deterministic JD boilerplate stripping (SPEC F2): EEO/legal text, benefits
// and pay, company blurbs. Conservative on purpose: cutting a requirements
// section is worse than keeping some noise. The output is made only of the
// input's own lines, so evidence quotes grounded in it are also verbatim in
// the original document.

export type BoilerplateKind = "eeo" | "benefits" | "company";

export interface RemovedBlock {
  kind: BoilerplateKind;
  /** The removed lines, joined with "\n". */
  text: string;
}

export interface StrippedJd {
  text: string;
  removed: RemovedBlock[];
  /** True if stripping would remove too much, so the original was kept. */
  keptOriginal: boolean;
}

/** Keep the original if stripping would leave less than this share of the words. */
const MIN_KEPT_WORD_SHARE = 0.4;
const MAX_HEADING_LENGTH = 70;

const ROLE_WORDS =
  /^(the |this )?(role|job|position|opportunity|team|you|work|day|internship|program|responsibilities)\b/i;

/** Headings that start a boilerplate section, by kind. Matched against the whole heading. */
const BOILERPLATE_HEADINGS: [BoilerplateKind, RegExp][] = [
  [
    "eeo",
    /^(equal (employment )?opportunity( employer)?|eeo( statement)?|diversity(,)? (equity,? )?(and|&) inclusion|our commitment to diversity|(reasonable )?accommodations?|e-verify|(applicant )?privacy (notice|policy|statement)|pay transparency|legal (notice|disclaimer)s?)$/i,
  ],
  [
    "benefits",
    /^(benefits|perks|(our |the )?(benefits|perks) (and|&) (perks|benefits)|what we offer|what we('|’)re offering|what('|’)s in it for you|our benefits|compensation( (and|&) benefits)?|total rewards|salary( range)?|pay( range)?|base (salary|pay))$/i,
  ],
  [
    "company",
    /^(about us|about the company|who we are|our (company|mission|story|values)|company overview|life at .+)$/i,
  ],
];

/**
 * Headings that start real content and end a boilerplate section. Anything
 * else after a boilerplate heading is treated as part of that section.
 */
const CONTENT_HEADING =
  /^(about (the |this )?(role|job|position|opportunity|team|you)|job (overview|description|summary)|(the |your )?(role|responsibilities|requirements|qualifications|skills|team)|(key |core |primary )?(responsibilities|duties)|(minimum|basic|required|preferred|desired|additional) (qualifications|requirements|skills|experience)|preferred|nice[ -]to[ -]haves?|bonus( points)?.*|what you('|’)ll (do|bring|need|be doing|work on|learn)|what (we('|’)re|we are) looking for|you (have|will|might|bring)|who you are|requirements|qualifications|experience|skills|technolog(y|ies).*|tech stack|tools.*|we look for.*)$/i;

/** Strong phrases that mark a single unheaded line as boilerplate. */
const BOILERPLATE_LINES: [BoilerplateKind, RegExp][] = [
  [
    "eeo",
    /equal (employment )?opportunity employer|without regard to (race|age|sex|gender|religion)|reasonable accommodations?|e-verify|affirmative action|pay transparency|protected (veteran|characteristic)/i,
  ],
  [
    "benefits",
    /(base |anticipated |expected )?(salary|pay|compensation) range|\bbase salary\b|401\s?\(?k\)?|medical,? dental|paid time off|unlimited pto|equity (grant|package|plans?)|incentive bonus/i,
  ],
  [
    "company",
    /\b(raised|closed) (a |an )?\$?\d[\d.,]*\s*(million|billion|m|b)\b|\b(seed|series [a-e]) (funding|round)\b|\bbacked by\b.*\b(ventures|capital|partners)\b/i,
  ],
];

function normalizeHeading(line: string): string {
  return line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/[*_]/g, "")
    .replace(/:$/, "")
    .trim();
}

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_HEADING_LENGTH &&
    !/[.;,]$/.test(trimmed) &&
    !/^[-•*]\s/.test(trimmed)
  );
}

function boilerplateHeadingKind(line: string): BoilerplateKind | null {
  if (!looksLikeHeading(line)) return null;
  const heading = normalizeHeading(line);
  for (const [kind, pattern] of BOILERPLATE_HEADINGS) if (pattern.test(heading)) return kind;
  // "About Acme" is a company blurb; "About the role" / "About you" are not.
  const about = heading.match(/^about (.+)$/i);
  if (about && !ROLE_WORDS.test(about[1]) && about[1].split(/\s+/).length <= 4) return "company";
  return null;
}

function isContentHeading(line: string): boolean {
  return looksLikeHeading(line) && CONTENT_HEADING.test(normalizeHeading(line));
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function stripBoilerplate(jdText: string): StrippedJd {
  const lines = jdText.split("\n");
  const kept: string[] = [];
  const removed: RemovedBlock[] = [];
  let section: { kind: BoilerplateKind; lines: string[] } | null = null;

  const closeSection = () => {
    if (section) removed.push({ kind: section.kind, text: section.lines.join("\n").trim() });
    section = null;
  };

  for (const line of lines) {
    const headingKind = boilerplateHeadingKind(line);
    if (headingKind) {
      closeSection();
      section = { kind: headingKind, lines: [line] };
      continue;
    }
    if (section) {
      if (isContentHeading(line)) {
        closeSection();
      } else {
        section.lines.push(line);
        continue;
      }
    }
    const lineKind = BOILERPLATE_LINES.find(([, pattern]) => pattern.test(line))?.[0];
    if (lineKind) {
      removed.push({ kind: lineKind, text: line.trim() });
      continue;
    }
    kept.push(line);
  }
  closeSection();

  const text = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (removed.length > 0 && wordCount(text) < wordCount(jdText) * MIN_KEPT_WORD_SHARE) {
    return { text: jdText, removed: [], keptOriginal: true };
  }
  return { text, removed, keptOriginal: false };
}
