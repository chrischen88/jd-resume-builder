import { findPhraseOffsets } from "@/lib/analysis/text";

// Highlighting a skill's wording inside resume or bullet text. No hooks, so
// server and client components can both use it.

/** Text split around a phrase, so it can be highlighted. */
export type Segments = { text: string; phrase: boolean }[];

/** Characters of context on each side of the match in an excerpt. */
const EXCERPT_CONTEXT = 50;

/** Splits text around every match of the phrase. */
export function phraseSegments(text: string, phrase: string): Segments {
  const out: Segments = [];
  let at = 0;
  for (const start of findPhraseOffsets(text, phrase)) {
    if (start < at) continue;
    const end = start + phrase.trim().length;
    if (start > at) out.push({ text: text.slice(at, start), phrase: false });
    out.push({ text: text.slice(start, end), phrase: true });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), phrase: false });
  return out;
}

/**
 * A short piece of `line` around the first match of `term`, cut at word
 * boundaries ("…experience building AI/ML-driven…"). Without a match, the
 * start of the line.
 */
export function excerpt(line: string, term: string | null): Segments {
  const start = term ? findPhraseOffsets(line, term)[0] : undefined;
  if (start === undefined || !term) {
    if (line.length <= 2 * EXCERPT_CONTEXT) return [{ text: line, phrase: false }];
    const cut = line.lastIndexOf(" ", 2 * EXCERPT_CONTEXT);
    return [{ text: `${line.slice(0, cut > 0 ? cut : 2 * EXCERPT_CONTEXT)}…`, phrase: false }];
  }
  const end = start + term.trim().length;
  let from = Math.max(0, start - EXCERPT_CONTEXT);
  if (from > 0) from = line.indexOf(" ", from) + 1 || from;
  let to = Math.min(line.length, end + EXCERPT_CONTEXT);
  if (to < line.length) to = Math.max(end, line.lastIndexOf(" ", to));
  return [
    { text: `${from > 0 ? "…" : ""}${line.slice(from, start)}`, phrase: false },
    { text: line.slice(start, end), phrase: true },
    { text: `${line.slice(end, to)}${to < line.length ? "…" : ""}`, phrase: false },
  ];
}

export function Highlighted({ parts }: { parts: Segments }) {
  return (
    <>
      {parts.map((part, i) =>
        part.phrase ? (
          <mark key={i} className="rounded bg-accent-soft px-0.5 text-accent">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
