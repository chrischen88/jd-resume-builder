import type { Coverage } from "./coverage";
import { findPhraseOffsets } from "./text";

// Proof bullets (SPEC §AI design 4): for each covered skill, the resume bullet
// that best shows it. Deterministic.

export interface ProofCandidateSkill {
  key: string;
  coverage: Coverage;
  /** Wordings that count as naming the skill (name, aliases, JD phrasings). */
  terms: string[];
}

/**
 * The proof bullet of each covered skill: of the bullets that name the skill,
 * the strongest; ties go to the earlier bullet (resume order, so usually the
 * more recent role). A skill covered only by a skills-list or summary line
 * gets no proof bullet.
 */
export function selectProofBullets<B extends { id: string; text: string }>(
  skills: ProofCandidateSkill[],
  bullets: B[],
  strengthOf: (bullet: B) => number,
): Map<string, B> {
  const strengths = bullets.map(strengthOf);
  const proofs = new Map<string, B>();
  for (const skill of skills) {
    if (skill.coverage !== "covered") continue;
    let best = -1;
    bullets.forEach((bullet, i) => {
      const names = skill.terms.some((term) => findPhraseOffsets(bullet.text, term).length > 0);
      if (names && (best < 0 || strengths[i] > strengths[best])) best = i;
    });
    if (best >= 0) proofs.set(skill.key, bullets[best]);
  }
  return proofs;
}
