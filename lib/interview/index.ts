import "server-only";

import { getDb } from "@/db/client";
import { askFollowUp, checkClaims, writeBullet } from "@/lib/ai/interview";
import { evidenceRecord, evidenceVectors } from "@/lib/vector";

import { checkVariant, runStep, type InterviewAi, type StepEvent } from "./steps";
import { createInterviewStore, type InterviewStore } from "./store";

export { InterviewError, roleLabel } from "./store";
export type { CurrentGap, InterviewRole, InterviewView } from "./store";
export { MODEL_STAGES, type Stage } from "./state";
export type { StepEvent } from "./steps";

export const interviewAi: InterviewAi = {
  askFollowUp: (ctx) => askFollowUp(ctx),
  writeBullet: (ctx) => writeBullet(ctx),
  checkClaims: (bullet, claims, sources) => checkClaims(bullet, claims, sources),
};

export async function getInterviewStore(): Promise<InterviewStore> {
  return createInterviewStore({ db: await getDb() });
}

/** Runs whatever model step the gap is waiting on (see steps.ts). */
export async function runInterviewStep(
  targetSetId: string,
  demandId: string,
  emit: (event: StepEvent) => void,
  options?: { regenerate?: boolean },
) {
  return runStep(await getInterviewStore(), interviewAi, targetSetId, demandId, emit, options);
}

/**
 * Accepts a drafted bullet, then indexes its evidence in Chroma (SPEC F19)
 * best-effort: the evidence is saved in SQLite either way.
 */
export async function acceptDraft(targetSetId: string, demandId: string, index: number) {
  const store = await getInterviewStore();
  const row = await store.accept(targetSetId, demandId, index);
  const db = await getDb();
  const skillRows = await db.query.evidenceSkills.findMany({
    where: (t, { eq }) => eq(t.evidenceId, row.id),
  });
  const skills = await Promise.all(
    skillRows.map((s) => db.query.skills.findFirst({ where: (t, { eq }) => eq(t.id, s.skillId) })),
  );
  try {
    await evidenceVectors().upsert([
      evidenceRecord(
        row,
        skills.map((s) => s?.canonicalName ?? "").filter(Boolean),
      ),
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "vector_upsert_failed",
        collection: "evidence",
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
  }
}

/** Claim-checks an edited draft version and saves it. */
export async function editDraft(
  targetSetId: string,
  demandId: string,
  index: number,
  text: string,
) {
  const store = await getInterviewStore();
  const ctx = await store.stepContext(targetSetId, demandId);
  const variant = await checkVariant(interviewAi, ctx, text.trim(), []);
  await store.saveVariant(targetSetId, demandId, index, variant);
}
