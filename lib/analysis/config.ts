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
