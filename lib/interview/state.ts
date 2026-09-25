import type { GapAnswerRow, SkillRow } from "@/db/schema";

// The gap interview as a state machine (SPEC step 5, task 1.16). Everything
// is derived from the gap_answers row, which is saved after every answer, so
// an interview can stop and resume at any step.

/** SPEC: 2–4 follow-ups per Yes/Somewhat. */
export const MIN_FOLLOW_UPS = 2;
export const MAX_FOLLOW_UPS = 4;

export type Stage =
  /** "Have you done this?" Yes / Somewhat / No / Skip. */
  | "ask"
  /** Which role was it in? */
  | "role"
  /** A follow-up question is waiting for the user's answer. */
  | "follow_up"
  /** The model should ask the next follow-up (or decide there's enough). */
  | "needs_question"
  /** Follow-ups are done; the model should draft the bullet. */
  | "needs_draft"
  /** Drafts are ready: accept, edit, or regenerate. */
  | "draft"
  | "done";

type AnswerState = Pick<
  GapAnswerRow,
  "response" | "followUps" | "roleId" | "draft" | "completedAt"
>;

/** Stages that need a model call before the user can continue. */
export const MODEL_STAGES: Stage[] = ["needs_question", "needs_draft"];

export function answeredFollowUps(answer: Pick<AnswerState, "followUps">): number {
  return answer.followUps.filter((f) => f.answer !== null).length;
}

export function gapStage(answer: AnswerState | undefined): Stage {
  if (!answer) return "ask";
  if (answer.completedAt || answer.response === "no") return "done";
  if (!answer.roleId) return "role";
  if (answer.followUps.some((f) => f.answer === null)) return "follow_up";
  if (answer.draft) return "draft";
  return answeredFollowUps(answer) >= MAX_FOLLOW_UPS ? "needs_draft" : "needs_question";
}

/** Certifications skip follow-ups and bullets: a Yes adds them to the certifications section. */
export function isCertification(category: SkillRow["category"]): boolean {
  return category === "certification";
}

/**
 * The gap to work on: the first unfinished one in interview order. Gaps
 * already started come back first only through their place in the order.
 */
export function nextGap<G extends { demandId: string }>(
  ordered: G[],
  stageOf: (gap: G) => Stage,
): G | undefined {
  return ordered.find((gap) => stageOf(gap) !== "done");
}
