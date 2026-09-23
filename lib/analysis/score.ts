import { DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from "./config";
import type { MergedSkill } from "./merge";
import { findPhraseOffsets } from "./text";
import type { Importance } from "./types";

// Deterministic demand scoring (SPEC §AI design 2, F7). Never the model.

/** The JD text a skill was extracted from. */
export interface JobText {
  jobId: string;
  /** Job title, when known (e.g. "Senior ML Engineer"). */
  title?: string;
  text: string;
}

export interface JobSkillScore {
  jobId: string;
  /** Highest importance among this JD's mentions. */
  importance: Importance;
  frequency: number;
  inTitle: boolean;
  inFirstThird: boolean;
  score: number;
}

export interface SkillDemand {
  key: string;
  name: string;
  /** Number of JDs that ask for the skill ("asked by n of N"). */
  jdCount: number;
  /** Number of JDs where it is required. */
  requiredCount: number;
  demandScore: number;
  /** Asked for by at least half the JDs in the set. */
  mustDo: boolean;
  /** 1-based, by demand. */
  rank: number;
  perJob: JobSkillScore[];
}

const IMPORTANCE_ORDER: Importance[] = ["required", "preferred", "mentioned"];

function scoreJob(
  skill: MergedSkill,
  job: JobText,
  weights: ScoringWeights,
): JobSkillScore {
  const mentions = skill.mentions.filter((m) => m.jobId === job.jobId);
  const importance = IMPORTANCE_ORDER.find((level) =>
    mentions.some((m) => m.importance === level),
  )!;

  const phrases = new Set(
    [skill.name, ...skill.variants, ...mentions.map((m) => m.jdPhrase)]
      .map((p) => p.trim())
      .filter(Boolean),
  );

  // Distinct match offsets, so overlapping phrases ("Python", "Python 3") count once.
  const offsets = new Set<number>();
  for (const phrase of phrases) {
    for (const offset of findPhraseOffsets(job.text, phrase)) offsets.add(offset);
  }
  // The model may paraphrase, so never count fewer than it extracted.
  const frequency = Math.max(offsets.size, mentions.length);

  const quoteOffsets = mentions
    .map((m) => job.text.indexOf(m.evidenceQuote))
    .filter((i) => i >= 0);
  const firstOffset = Math.min(...offsets, ...quoteOffsets);
  const inFirstThird = Number.isFinite(firstOffset) && firstOffset < job.text.length / 3;

  const inTitle =
    !!job.title && [...phrases].some((p) => findPhraseOffsets(job.title!, p).length > 0);

  const score =
    (importance === "required" ? weights.required : 0) +
    (importance === "preferred" ? weights.preferred : 0) +
    weights.frequency * Math.log(1 + frequency) +
    (inTitle ? weights.inTitle : 0) +
    (inFirstThird ? weights.inFirstThird : 0);

  return { jobId: job.jobId, importance, frequency, inTitle, inFirstThird, score };
}

/**
 * Scores every merged skill against the JDs that mention it and ranks them.
 * Order: demand, then JD count, then required count, then name, so ties are
 * stable across runs.
 */
export function scoreSkills(
  skills: MergedSkill[],
  jobs: JobText[],
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): SkillDemand[] {
  const jobsById = new Map(jobs.map((job) => [job.jobId, job]));
  const totalJobs = jobs.length;

  const demands = skills.map((skill) => {
    const perJob = skill.jobIds.map((jobId) => {
      const job = jobsById.get(jobId);
      if (!job) throw new Error(`Skill "${skill.name}" references unknown job ${jobId}`);
      return scoreJob(skill, job, weights);
    });
    return {
      key: skill.key,
      name: skill.name,
      jdCount: perJob.length,
      requiredCount: perJob.filter((j) => j.importance === "required").length,
      demandScore: perJob.reduce((sum, j) => sum + j.score, 0),
      mustDo: totalJobs > 0 && perJob.length * 2 >= totalJobs,
      rank: 0,
      perJob,
    };
  });

  demands.sort(
    (a, b) =>
      b.demandScore - a.demandScore ||
      b.jdCount - a.jdCount ||
      b.requiredCount - a.requiredCount ||
      a.name.localeCompare(b.name, "en"),
  );
  demands.forEach((d, i) => (d.rank = i + 1));
  return demands;
}
