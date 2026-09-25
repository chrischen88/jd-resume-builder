// Scoring weights (SPEC §AI design 2). Tune here, not in score.ts.
//   score_j(s) = required·[best importance is required]
//              + preferred·[best importance is preferred]
//              + frequency·ln(1 + times the skill appears in the JD)
//              + inTitle·[skill in job title]
//              + inFirstThird·[first mention in first third of the JD]

export interface ScoringWeights {
  required: number;
  preferred: number;
  /** Multiplier on ln(1 + frequency). */
  frequency: number;
  inTitle: number;
  inFirstThird: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  required: 3,
  preferred: 1.5,
  frequency: 1,
  inTitle: 1,
  inFirstThird: 0.5,
};

/**
 * Coverage (SPEC §AI design 3): a skill the resume doesn't name is "weak" when
 * one of its JD requirement lines has cosine similarity ≥ this with an
 * experience bullet. Calibrated on the fixtures with text-embedding-3-small
 * (task 1.10): real and false matches both scored 0.50–0.62, so no lower
 * value separated them; at 0.80 nothing is flagged, so no wrong bullet is
 * shown as proof. Revisit with labeled pairs (task 1.27).
 */
export const WEAK_COVERAGE_SIMILARITY = 0.8;

// Bullet strength (SPEC §AI design 4):
//   strength = verb·[strong: 1, neutral: ½, weak: 0] + scope·[has scope]
//            + result·[has measurable result] + keywords·min(1, Σ share of JDs
//              asking for each in-demand skill the bullet names)

export interface StrengthWeights {
  verb: number;
  scope: number;
  result: number;
  keywords: number;
}

export const DEFAULT_STRENGTH_WEIGHTS: StrengthWeights = {
  verb: 1,
  scope: 1,
  result: 1.5,
  keywords: 1.5,
};

// Coverage score (SPEC F17): demand-weighted share of the set's skills the
// resume shows, 0–100.
//   score = 100 · Σ demand(s)·credit(coverage(s)) / Σ demand(s)

export const COVERAGE_CREDIT = { covered: 1, weak: 0.5, missing: 0 } as const;
