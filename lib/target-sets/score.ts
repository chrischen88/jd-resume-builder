import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import { gapAnswers, skillDemands, skills, type ResumeSections } from "@/db/schema";
import {
  coverageChanges,
  coverageScore,
  type ScoreChange,
  type ScoredSkill,
} from "@/lib/analysis/coverage-score";
import { MAX_PHRASE_USES } from "@/lib/analysis/reword";
import { findPhraseOffsets } from "@/lib/analysis/text";
import { ADDED_SKILLS_LABEL } from "@/lib/interview/store";
import { createResumeStore, type ResumeDetail } from "@/lib/resume/store";
import { resumeToText } from "@/lib/resume/text";

// Coverage before/after for a target set (SPEC F17, task 1.24). "After" is
// the resume as it is now; "before" is the same resume without what the
// interview added (generated bullets, the "Additional skills" line, and
// certifications added by a Yes), so edits to original lines count on both
// sides and re-analyzing the set doesn't move the baseline.

export interface TargetSetScore {
  /** 0–100; null when the set has no analyzed skills. */
  before: number | null;
  after: number | null;
  skillCount: number;
  /** Skills whose coverage the interview changed, most in demand first. */
  changes: ScoreChange[];
  /** Interview wordings used more than MAX_PHRASE_USES times on the resume. */
  overused: { phrase: string; uses: number }[];
  /** Certifications the interview added (a Yes), as named on the resume. */
  addedCertifications: string[];
}

/** The resume without the interview's additions. */
export function interviewBaseline(
  resume: Pick<ResumeDetail, "sections" | "roles">,
  addedCertifications: string[],
): Pick<ResumeDetail, "sections" | "roles"> {
  const added = new Set(addedCertifications.map((c) => c.toLowerCase()));
  const sections: ResumeSections = {
    ...resume.sections,
    skills: resume.sections.skills.filter((line) => !line.startsWith(`${ADDED_SKILLS_LABEL}:`)),
    certifications: resume.sections.certifications.filter((c) => !added.has(c.toLowerCase())),
  };
  return {
    sections,
    roles: resume.roles.map((role) => ({
      ...role,
      bullets: role.bullets.filter((b) => b.source !== "generated"),
    })),
  };
}

/**
 * JD wordings the interview wrote onto the resume that now appear more than
 * `cap` times in it (CLAUDE.md: cap each JD phrase at 3 uses). Wordings the
 * original resume uses on its own aren't flagged.
 */
export function overusedPhrases(
  resume: Pick<ResumeDetail, "sections" | "roles">,
  phrases: string[],
  cap = MAX_PHRASE_USES,
): { phrase: string; uses: number }[] {
  const text = resumeToText(resume);
  const added = [
    ...resume.roles.flatMap((r) =>
      r.bullets.filter((b) => b.source === "generated" && b.status === "accepted"),
    ).map((b) => b.text),
    ...resume.sections.skills.filter((line) => line.startsWith(`${ADDED_SKILLS_LABEL}:`)),
  ].join("\n");
  const seen = new Set<string>();
  const result: { phrase: string; uses: number }[] = [];
  for (const phrase of phrases) {
    const key = phrase.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (findPhraseOffsets(added, phrase).length === 0) continue;
    const uses = findPhraseOffsets(text, phrase).length;
    if (uses > cap) result.push({ phrase, uses });
  }
  return result.sort((a, b) => b.uses - a.uses);
}

export async function scoreTargetSet(
  db: Db,
  targetSetId: string,
  resumeId: string,
): Promise<TargetSetScore> {
  const [resume, demandRows, certAnswers] = await Promise.all([
    createResumeStore({ db }).get(resumeId),
    db
      .select({ demand: skillDemands, skill: skills })
      .from(skillDemands)
      .innerJoin(skills, eq(skills.id, skillDemands.skillId))
      .where(eq(skillDemands.targetSetId, targetSetId)),
    db
      .select({ name: skills.canonicalName })
      .from(gapAnswers)
      .innerJoin(skillDemands, eq(skillDemands.id, gapAnswers.skillDemandId))
      .innerJoin(skills, eq(skills.id, skillDemands.skillId))
      .where(
        and(
          eq(skillDemands.targetSetId, targetSetId),
          eq(skills.category, "certification"),
          eq(gapAnswers.response, "yes"),
          isNotNull(gapAnswers.completedAt),
        ),
      ),
  ]);
  if (!resume) {
    return {
      before: null,
      after: null,
      skillCount: 0,
      changes: [],
      overused: [],
      addedCertifications: [],
    };
  }

  const scored: ScoredSkill[] = demandRows.map(({ demand, skill }) => ({
    key: skill.key,
    name: skill.canonicalName,
    category: skill.category,
    terms: demand.terms.length > 0 ? demand.terms : [skill.canonicalName],
    demandScore: demand.demandScore,
  }));
  const certNames = new Set(certAnswers.map((c) => c.name.toLowerCase()));
  const baseline = interviewBaseline(resume, [...certNames]);
  const before = coverageScore(scored, resumeToText(baseline));
  const after = coverageScore(scored, resumeToText(resume));
  return {
    before: before.score,
    after: after.score,
    skillCount: scored.length,
    changes: coverageChanges(scored, before, after),
    overused: overusedPhrases(
      resume,
      scored.flatMap((s) => s.terms),
    ),
    addedCertifications: resume.sections.certifications.filter((c) =>
      certNames.has(c.toLowerCase()),
    ),
  };
}
