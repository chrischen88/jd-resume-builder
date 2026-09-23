import "server-only";

import { eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { targetSets, type TargetSetRow } from "@/db/schema";
import { AiOutputError } from "@/lib/ai/client";

import {
  AnalysisError,
  loadJobsForAnalysis,
  type AnalysisProgress,
  type AnalysisResult,
  type analyzeTargetSet,
} from "./analyze";
import { TargetSetError } from "./store";

// Runs target-set analyses in the Next.js process (no job queue). One run per
// set at a time; progress lives in memory, status and errors in target_sets.

export interface AnalysisStatus {
  status: TargetSetRow["status"];
  /** Set while a run is in progress. */
  progress: AnalysisProgress | null;
  /** User-facing reason when status is "failed". */
  error: string | null;
  analyzedAt: Date | null;
}

type Analyze = (
  targetSetId: string,
  options: { onProgress: (progress: AnalysisProgress) => void },
) => ReturnType<typeof analyzeTargetSet>;

const INTERRUPTED = "Analysis was interrupted (the app restarted). Analyze again to continue.";
const UNEXPECTED = "Analysis failed unexpectedly. Try again.";

export function createAnalysisRunner({ db, analyze }: { db: Db; analyze: Analyze }) {
  const running = new Map<string, { progress: AnalysisProgress | null }>();

  async function setStatus(id: string, values: Partial<TargetSetRow>) {
    await db.update(targetSets).set(values).where(eq(targetSets.id, id));
  }

  async function run(id: string, entry: { progress: AnalysisProgress | null }) {
    const started = Date.now();
    try {
      const result: AnalysisResult = await analyze(id, {
        onProgress: (progress) => (entry.progress = progress),
      });
      await setStatus(id, { status: "ready", analysisError: null, analyzedAt: new Date() });
      console.info("Target set analyzed", {
        event: "analysis_done",
        targetSetId: id,
        latencyMs: Date.now() - started,
        ...result,
      });
    } catch (err) {
      const cause = err instanceof AnalysisError ? err.cause : err;
      // Error names and prompt ids only; never JD or resume text.
      console.error("Target set analysis failed", {
        event: "analysis_failed",
        targetSetId: id,
        latencyMs: Date.now() - started,
        error: cause instanceof Error ? cause.name : "unknown",
        promptId: cause instanceof AiOutputError ? cause.promptId : undefined,
      });
      const message =
        err instanceof AnalysisError || err instanceof TargetSetError ? err.message : UNEXPECTED;
      await setStatus(id, { status: "failed", analysisError: message }).catch(() => {});
    } finally {
      running.delete(id);
    }
  }

  return {
    /**
     * Validates the set, marks it analyzing, and starts the run. Resolves once
     * the run has started; `done` settles when it ends (it never rejects).
     * Throws TargetSetError: not_found, too_few, or busy if a run is going.
     */
    async start(id: string): Promise<{ done: Promise<void> }> {
      if (running.has(id)) {
        throw new TargetSetError("This target set is already being analyzed.", "busy");
      }
      // Claim the slot before any await so two requests can't both start.
      const entry = { progress: null };
      running.set(id, entry);
      try {
        await loadJobsForAnalysis(db, id);
        await setStatus(id, { status: "analyzing", analysisError: null });
      } catch (err) {
        running.delete(id);
        throw err;
      }
      return { done: run(id, entry) };
    },

    async status(id: string): Promise<AnalysisStatus | undefined> {
      const set = await db.query.targetSets.findFirst({ where: eq(targetSets.id, id) });
      if (!set) return undefined;
      const entry = running.get(id);
      if (entry) {
        return { status: "analyzing", progress: entry.progress, error: null, analyzedAt: set.analyzedAt };
      }
      if (set.status === "analyzing") {
        return { status: "failed", progress: null, error: INTERRUPTED, analyzedAt: set.analyzedAt };
      }
      return {
        status: set.status,
        progress: null,
        error: set.status === "failed" ? set.analysisError : null,
        analyzedAt: set.analyzedAt,
      };
    },

    isRunning(id: string): boolean {
      return running.has(id);
    },
  };
}

export type AnalysisRunner = ReturnType<typeof createAnalysisRunner>;
