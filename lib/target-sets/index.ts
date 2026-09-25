import "server-only";

import { getDb } from "@/db/client";
import { embedTexts } from "@/lib/ai/client";
import { rewordBullets } from "@/lib/ai/reword-bullets";
import { ensureExtractions } from "@/lib/library";
import { jobKeywordVectors, removeKeywordVectors } from "@/lib/vector";

import { createAnalysisRunner, type AnalysisRunner } from "./analysis-runner";
import { createGapStore, type GapStore } from "./gaps";
import { analyzeTargetSet } from "./analyze";
import { createTargetSetStore, TargetSetError, type TargetSetStore } from "./store";
import { scoreTargetSet as score, type TargetSetScore } from "./score";
import { createSuggestionStore, type SuggestionStore } from "./suggestions";

export { MAX_JOBS, MIN_JOBS, STRONGEST_BULLETS, TargetSetError } from "./store";
export type {
  AddJobsResult,
  JobWithDocument,
  ScoredBullet,
  SkillDemandSummary,
  TargetSetDetail,
  TargetSetStrengths,
  TargetSetSummary,
} from "./store";
export type { AnalysisProgress, AnalysisResult } from "./analyze";
export type { AnalysisStatus } from "./analysis-runner";
export type { AcceptResult, SuggestionView } from "./suggestions";
export type { Direction, Gap, GapOverview, GapSource } from "./gaps";
export type { TargetSetScore } from "./score";

export async function getTargetSetStore(): Promise<TargetSetStore> {
  return createTargetSetStore({ db: await getDb(), removeKeywordVectors });
}

// On globalThis so dev-mode module reloads don't lose track of running analyses.
const globalRunner = globalThis as typeof globalThis & {
  __analysisRunner?: Promise<AnalysisRunner>;
};

/** The process-wide analysis runner (one run per target set at a time). */
export function getAnalysisRunner(): Promise<AnalysisRunner> {
  globalRunner.__analysisRunner ??= (async () => {
    const db = await getDb();
    return createAnalysisRunner({
      db,
      analyze: (id, options) =>
        analyzeTargetSet(
          { db, ensureExtractions, embed: embedTexts, keywordVectors: jobKeywordVectors() },
          id,
          options,
        ),
    });
  })();
  return globalRunner.__analysisRunner;
}

/**
 * Throws TargetSetError("busy") while the set is being analyzed, so its JDs
 * can't change under a running analysis.
 */
export async function ensureNotAnalyzing(targetSetId: string): Promise<void> {
  if ((await getAnalysisRunner()).isRunning(targetSetId)) {
    throw new TargetSetError("Wait for the analysis to finish before changing this set.", "busy");
  }
}

export async function getSuggestionStore(): Promise<SuggestionStore> {
  return createSuggestionStore({ db: await getDb() });
}

/** Asks the model for rewording suggestions for a set's bullets (never applied until accepted). */
export async function suggestRewordings(targetSetId: string) {
  return (await getSuggestionStore()).generate(targetSetId, (candidates) =>
    rewordBullets(candidates),
  );
}

export async function getGapStore(): Promise<GapStore> {
  return createGapStore({ db: await getDb() });
}

/** Coverage score before/after the interview (task 1.24). */
export async function scoreTargetSet(targetSetId: string, resumeId: string): Promise<TargetSetScore> {
  return score(await getDb(), targetSetId, resumeId);
}
