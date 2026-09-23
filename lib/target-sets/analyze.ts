import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  documents,
  jobKeywords,
  jobs,
  jobSkillScores,
  skillDemands,
  skills,
  targetSets,
} from "@/db/schema";
import { AiOutputError } from "@/lib/ai/client";
import { analyzeSet, type SkillAnalysisRow } from "@/lib/analysis/analyze-set";
import { semanticWeakMatches } from "@/lib/analysis/coverage";
import { selectProofBullets } from "@/lib/analysis/proof";
import { scoreBullet } from "@/lib/analysis/strength";
import type { SynonymMap } from "@/lib/analysis/merge";
import type { CachedExtraction, ExtractionSource } from "@/lib/library/extractions";
import { experienceBullets, resumeToText } from "@/lib/resume/text";
import {
  pruneKeywordVectors,
  type JobKeywordMetadata,
  type KeywordVectorStore,
} from "@/lib/vector/job-keywords";
import { createResumeStore } from "@/lib/resume/store";

import { MIN_JOBS, TargetSetError } from "./store";

// Analysis of one target set (SPEC step 3, tasks 1.9–1.10): extract keywords
// from each job's boilerplate-stripped text → merge → score → coverage
// (lexical, then embeddings) → proof bullets (1.12), then write skills,
// job_keywords, job_skill_scores, skill_demands, and the job_keywords vectors
// in Chroma.
// Re-running it replaces the previous results but keeps the user's gap
// overrides (user_rank, dismissed) and answers for skills still in the set.

export interface AnalysisProgress {
  stage: "extracting" | "embedding" | "saving";
  /** JDs with an extraction so far (cached ones count from the start). */
  extracted: number;
  total: number;
}

export interface AnalysisResult {
  skills: number;
  covered: number;
  weak: number;
  missing: number;
}

export interface AnalyzeDeps {
  db: Db;
  /** Returns an extraction per document id, calling the model only for uncached texts. */
  ensureExtractions: (
    docs: ExtractionSource[],
    options: { onExtracted: (documentId: string) => void },
  ) => Promise<Map<string, CachedExtraction>>;
  /** One vector per text, in order (embedTexts in lib/ai/client). */
  embed: (texts: string[]) => Promise<number[][]>;
  /** The user's job_keywords collection in Chroma. */
  keywordVectors: KeywordVectorStore;
}

/** Thrown when a step fails; `message` is safe to show the user. */
export class AnalysisError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnalysisError";
  }
}

interface PreparedJob {
  id: string;
  documentId: string;
  text: string;
  title: string | null;
}

/**
 * Checks that a set can be analyzed and returns its jobs with the text to
 * extract from. Throws TargetSetError (not_found, too_few).
 */
export async function loadJobsForAnalysis(db: Db, targetSetId: string): Promise<PreparedJob[]> {
  const set = await db.query.targetSets.findFirst({ where: eq(targetSets.id, targetSetId) });
  if (!set) throw new TargetSetError("That target set no longer exists.", "not_found");
  const rows = await db
    .select({ job: jobs, documentText: documents.text })
    .from(jobs)
    .innerJoin(documents, eq(documents.id, jobs.documentId))
    .where(eq(jobs.targetSetId, targetSetId));
  if (rows.length < MIN_JOBS) {
    throw new TargetSetError(
      `Add at least ${MIN_JOBS} job descriptions before analyzing.`,
      "too_few",
    );
  }
  return rows.map(({ job, documentText }) => ({
    id: job.id,
    documentId: job.documentId,
    text: job.jdClean ?? documentText,
    title: job.title,
  }));
}

/** User-added synonyms from the skills table, as a mergeSkills override map. */
async function userSynonyms(db: Db): Promise<SynonymMap> {
  const rows = await db.query.skills.findMany({
    where: sql`json_array_length(${skills.synonyms}) > 0`,
  });
  return Object.fromEntries(rows.map((s) => [s.canonicalName, s.synonyms]));
}

function extractionFailureMessage(err: unknown): string {
  const reason =
    err instanceof AiOutputError
      ? `the model returned unusable output (${err.reason})`
      : "the model call failed";
  return `Keyword extraction stopped: ${reason}. JDs that finished are saved; analyze again to continue.`;
}

/**
 * Runs the analysis and saves the results in one transaction. Does not touch
 * the set's status; the runner (analysis-runner.ts) owns that.
 */
export async function analyzeTargetSet(
  deps: AnalyzeDeps,
  targetSetId: string,
  { onProgress }: { onProgress?: (progress: AnalysisProgress) => void } = {},
): Promise<AnalysisResult> {
  const { db } = deps;
  const prepared = await loadJobsForAnalysis(db, targetSetId);
  const set = (await db.query.targetSets.findFirst({ where: eq(targetSets.id, targetSetId) }))!;
  const resume = await createResumeStore({ db }).get(set.resumeId);
  if (!resume) throw new TargetSetError("That resume no longer exists.", "not_found");

  // Jobs in one set have distinct documents (jobs_set_document_idx).
  const sources = prepared.map((j) => ({ id: j.documentId, text: j.text }));
  const total = sources.length;
  const done = new Set<string>();
  onProgress?.({ stage: "extracting", extracted: 0, total });

  let extractions: Map<string, CachedExtraction>;
  try {
    extractions = await deps.ensureExtractions(sources, {
      onExtracted: (documentId) => {
        done.add(documentId);
        onProgress?.({ stage: "extracting", extracted: done.size, total });
      },
    });
  } catch (err) {
    throw new AnalysisError(extractionFailureMessage(err), { cause: err });
  }
  const analyzed = prepared.map((job) => {
    const extraction = extractions.get(job.documentId);
    if (!extraction) throw new Error(`No extraction for job ${job.id}`);
    return { job, extraction };
  });

  const rows = analyzeSet(
    analyzed.map(({ job, extraction }) => ({
      jobId: job.id,
      title: job.title ?? extraction.job.title ?? undefined,
      text: job.text,
      keywords: extraction.keywords,
    })),
    resumeToText(resume),
    { synonyms: await userSynonyms(db) },
  );

  // One batch: every requirement line (stored in Chroma below) plus the
  // bullets the weak-coverage pass compares them with.
  onProgress?.({ stage: "embedding", extracted: total, total });
  const bullets = experienceBullets(resume);
  const texts = [
    ...new Set([...rows.flatMap((r) => r.mentions.map((m) => m.evidenceQuote)), ...bullets]),
  ];
  let vectors: number[][];
  try {
    vectors = await deps.embed(texts);
  } catch (err) {
    throw new AnalysisError(
      "Embedding the JD requirements failed (the embedding call errored). Analyze again to retry.",
      { cause: err },
    );
  }
  const vectorOf = new Map(texts.map((text, i) => [text, vectors[i]]));

  const weak = semanticWeakMatches(
    rows,
    bullets.map((text) => ({ text, vector: vectorOf.get(text)! })),
    (quote) => vectorOf.get(quote),
  );
  for (const row of rows) {
    const evidence = weak.get(row.key);
    if (!evidence) continue;
    row.coverage = "weak";
    row.matchedTerm = null;
    row.resumeEvidence = evidence;
  }
  // Proof bullet of each covered skill: its strongest accepted bullet.
  const accepted = resume.roles.flatMap((role) =>
    role.bullets.filter((b) => b.status === "accepted"),
  );
  const strength = new Map(
    accepted.map((b) => [b.id, scoreBullet(b.text, rows, prepared.length).score]),
  );
  const proofs = selectProofBullets(rows, accepted, (b) => strength.get(b.id)!);

  onProgress?.({ stage: "saving", extracted: total, total });
  const documentIds = new Map(prepared.map((j) => [j.id, j.documentId]));

  await db.transaction(async (tx) => {
    // Job details from the extraction (F5), only where the user hasn't set them.
    for (const { job, extraction } of analyzed) {
      const current = (await tx.query.jobs.findFirst({ where: eq(jobs.id, job.id) }))!;
      await tx
        .update(jobs)
        .set({
          company: current.company ?? extraction.job.company,
          title: current.title ?? extraction.job.title,
          seniority: current.seniority ?? extraction.job.seniority,
          yearsExperienceMin: current.yearsExperienceMin ?? extraction.job.years_experience_min,
        })
        .where(eq(jobs.id, job.id));
    }

    const skillIds = await upsertSkills(tx, rows);
    const jobIds = prepared.map((j) => j.id);

    await tx.delete(jobKeywords).where(inArray(jobKeywords.jobId, jobIds));
    await tx.delete(jobSkillScores).where(inArray(jobSkillScores.jobId, jobIds));

    const keywordRows = rows.flatMap((row) =>
      row.mentions.map((m) => ({
        id: randomUUID(),
        jobId: m.jobId,
        skillId: skillIds.get(row.key)!,
        jdPhrase: m.jdPhrase,
        evidenceQuote: m.evidenceQuote,
        importance: m.importance,
      })),
    );
    const scoreRows = rows.flatMap((row) =>
      row.perJob.map((j) => ({ ...j, skillId: skillIds.get(row.key)! })),
    );
    for (const chunk of chunks(keywordRows)) await tx.insert(jobKeywords).values(chunk);
    for (const chunk of chunks(scoreRows)) await tx.insert(jobSkillScores).values(chunk);

    // Inside the transaction so a Chroma failure rolls the whole save back.
    // The old rows' vectors are pruned after commit.
    try {
      for (const chunk of chunks(keywordRows, 500)) {
        await deps.keywordVectors.upsertVectors(
          chunk.map((k) => {
            const metadata: JobKeywordMetadata = {
              target_set_id: targetSetId,
              job_id: k.jobId,
              document_id: documentIds.get(k.jobId)!,
              resume_id: set.resumeId,
              skill_id: k.skillId,
              importance: k.importance,
            };
            return {
              id: k.id,
              text: k.evidenceQuote,
              vector: vectorOf.get(k.evidenceQuote)!,
              metadata: { ...metadata },
            };
          }),
        );
      }
    } catch (err) {
      throw new AnalysisError(
        "Couldn't save to the vector store. Start Chroma (npm run chroma), then analyze again.",
        { cause: err },
      );
    }

    // Skills no longer in the set lose their demand row (and its gap answer).
    const currentSkillIds = rows.map((row) => skillIds.get(row.key)!);
    await tx
      .delete(skillDemands)
      .where(
        and(
          eq(skillDemands.targetSetId, targetSetId),
          currentSkillIds.length > 0
            ? notInArray(skillDemands.skillId, currentSkillIds)
            : undefined,
        ),
      );

    const demandRows = rows.map((row) => ({
      id: randomUUID(),
      targetSetId,
      skillId: skillIds.get(row.key)!,
      jdCount: row.jdCount,
      requiredCount: row.requiredCount,
      demandScore: row.demandScore,
      mustDo: row.mustDo,
      rank: row.rank,
      coverage: row.coverage,
      matchedTerm: row.matchedTerm,
      coverageEvidence: row.resumeEvidence,
      terms: row.terms,
      proofBulletId: proofs.get(row.key)?.id ?? null,
    }));
    for (const chunk of chunks(demandRows)) {
      await tx
        .insert(skillDemands)
        .values(chunk)
        .onConflictDoUpdate({
          target: [skillDemands.targetSetId, skillDemands.skillId],
          set: {
            jdCount: sql`excluded.jd_count`,
            requiredCount: sql`excluded.required_count`,
            demandScore: sql`excluded.demand_score`,
            mustDo: sql`excluded.must_do`,
            rank: sql`excluded.rank`,
            coverage: sql`excluded.coverage`,
            matchedTerm: sql`excluded.matched_term`,
            coverageEvidence: sql`excluded.coverage_evidence`,
            terms: sql`excluded.terms`,
            proofBulletId: sql`excluded.proof_bullet_id`,
          },
        });
    }
  });

  await pruneStaleVectors(db, deps.keywordVectors);

  return {
    skills: rows.length,
    covered: rows.filter((r) => r.coverage === "covered").length,
    weak: rows.filter((r) => r.coverage === "weak").length,
    missing: rows.filter((r) => r.coverage === "missing").length,
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Deletes vectors whose job_keywords rows are gone: this set's previous
 * results, plus anything a failed best-effort delete left behind. A failure
 * here doesn't fail the analysis; the next run tries again.
 */
async function pruneStaleVectors(db: Db, store: KeywordVectorStore) {
  try {
    const live = await db.select({ id: jobKeywords.id }).from(jobKeywords);
    await pruneKeywordVectors(store, new Set(live.map((r) => r.id)));
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "vector_prune_failed",
        collection: "job_keywords",
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
  }
}

/**
 * Makes sure every analyzed skill has a row, returning ids by skill key. An
 * existing skill keeps its name and category (they're shared across sets).
 */
async function upsertSkills(tx: Tx, rows: SkillAnalysisRow[]): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();
  for (const chunk of chunks(rows)) {
    await tx
      .insert(skills)
      .values(
        chunk.map((row) => ({
          id: randomUUID(),
          key: row.key,
          canonicalName: row.name,
          category: row.category,
        })),
      )
      .onConflictDoNothing({ target: skills.key });
  }
  const keys = rows.map((row) => row.key);
  const found = [];
  for (const chunk of chunks(keys)) {
    found.push(...(await tx.query.skills.findMany({ where: inArray(skills.key, chunk) })));
  }
  return new Map(found.map((s) => [s.key, s.id]));
}

/** Keeps each statement well under SQLite's bound-variable limit. */
function chunks<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
