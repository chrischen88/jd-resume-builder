import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  documents,
  gapAnswers,
  jobKeywords,
  jobs,
  skillDemands,
  skills,
  type GapAnswerRow,
  type SkillDemandRow,
  type SkillRow,
} from "@/db/schema";

// Gap overview (SPEC step 5, Screen 4, task 1.15): the set's missing and
// weak skills in interview order, which the user can reorder and dismiss.

/** JD sentences shown under "Why this skill?", at most this many. */
export const MAX_SOURCES = 3;

export interface GapSource {
  jobTitle: string;
  quote: string;
  importance: "required" | "preferred" | "mentioned";
}

export interface Gap {
  demandId: string;
  skillId: string;
  name: string;
  category: SkillRow["category"];
  coverage: "missing" | "weak";
  jdCount: number;
  requiredCount: number;
  mustDo: boolean;
  /** Resume lines that partly show a weak skill. */
  evidence: string[];
  /** The wording that partly matched, when the match was by words. */
  matchedTerm: string | null;
  /** Up to MAX_SOURCES JD sentences asking for it, one per JD, required first. */
  sources: GapSource[];
  answer: GapAnswerRow["response"] | null;
}

export interface GapOverview {
  jobCount: number;
  /** In interview order. */
  active: Gap[];
  dismissed: Gap[];
}

export type Direction = "top" | "up" | "down";

type Orderable = Pick<SkillDemandRow, "id" | "rank" | "userRank">;

/**
 * Interview order: the user's order (user_rank) where set, otherwise demand
 * rank. A skill added by a later analysis (no user_rank) slots in by its
 * rank, after a gap the user put at the same position.
 */
export function gapOrder<T extends Orderable>(gaps: T[]): T[] {
  const placed = (g: T) => (g.userRank === null ? 1 : 0);
  return [...gaps].sort(
    (a, b) =>
      (a.userRank ?? a.rank) - (b.userRank ?? b.rank) || placed(a) - placed(b) || a.rank - b.rank,
  );
}

/** The new order after moving one gap; unchanged if it can't move that way. */
export function moveInOrder<T extends { id: string }>(
  ordered: T[],
  id: string,
  direction: Direction,
): T[] {
  const from = ordered.findIndex((g) => g.id === id);
  if (from < 0) return ordered;
  const to = direction === "top" ? 0 : direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ordered.length || to === from) return ordered;
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const IMPORTANCE_ORDER = { required: 0, preferred: 1, mentioned: 2 } as const;

export function createGapStore({ db }: { db: Db }) {
  async function gapRows(targetSetId: string) {
    return db
      .select({ demand: skillDemands, skill: skills, answer: gapAnswers.response })
      .from(skillDemands)
      .innerJoin(skills, eq(skills.id, skillDemands.skillId))
      .leftJoin(gapAnswers, eq(gapAnswers.skillDemandId, skillDemands.id))
      .where(
        and(
          eq(skillDemands.targetSetId, targetSetId),
          inArray(skillDemands.coverage, ["missing", "weak"]),
        ),
      );
  }

  return {
    async overview(targetSetId: string): Promise<GapOverview> {
      const [rows, jobRows] = await Promise.all([
        gapRows(targetSetId),
        db
          .select({ id: jobs.id, title: documents.title })
          .from(jobs)
          .innerJoin(documents, eq(documents.id, jobs.documentId))
          .where(eq(jobs.targetSetId, targetSetId)),
      ]);
      const titles = new Map(jobRows.map((j) => [j.id, j.title]));
      const skillIds = rows.map((r) => r.skill.id);
      const mentions =
        skillIds.length === 0 || jobRows.length === 0
          ? []
          : await db
              .select({
                skillId: jobKeywords.skillId,
                jobId: jobKeywords.jobId,
                quote: jobKeywords.evidenceQuote,
                importance: jobKeywords.importance,
              })
              .from(jobKeywords)
              .where(
                and(
                  inArray(jobKeywords.skillId, skillIds),
                  inArray(
                    jobKeywords.jobId,
                    jobRows.map((j) => j.id),
                  ),
                ),
              );

      const sourcesFor = (skillId: string): GapSource[] => {
        const best = new Map<string, (typeof mentions)[number]>();
        for (const m of mentions) {
          if (m.skillId !== skillId) continue;
          const current = best.get(m.jobId);
          if (!current || IMPORTANCE_ORDER[m.importance] < IMPORTANCE_ORDER[current.importance]) {
            best.set(m.jobId, m);
          }
        }
        return [...best.values()]
          .sort((a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance])
          .slice(0, MAX_SOURCES)
          .map((m) => ({
            jobTitle: titles.get(m.jobId) ?? "",
            quote: m.quote,
            importance: m.importance,
          }));
      };

      const toGap = (row: (typeof rows)[number]): Gap => ({
        demandId: row.demand.id,
        skillId: row.skill.id,
        name: row.skill.canonicalName,
        category: row.skill.category,
        coverage: row.demand.coverage as Gap["coverage"],
        jdCount: row.demand.jdCount,
        requiredCount: row.demand.requiredCount,
        mustDo: row.demand.mustDo,
        evidence: row.demand.coverage === "weak" ? row.demand.coverageEvidence : [],
        matchedTerm: row.demand.matchedTerm,
        sources: sourcesFor(row.skill.id),
        answer: row.answer,
      });

      const ordered = gapOrder(rows.map((r) => ({ ...r.demand, row: r }))).map((g) => g.row);
      return {
        jobCount: jobRows.length,
        active: ordered.filter((r) => !r.demand.dismissed).map(toGap),
        dismissed: ordered.filter((r) => r.demand.dismissed).map(toGap),
      };
    },

    /**
     * Moves a gap in the interview order and saves the whole active order as
     * user_rank (1..n), so it survives re-analysis. False if it isn't an
     * active gap of the set or can't move that way.
     */
    async move(targetSetId: string, demandId: string, direction: Direction): Promise<boolean> {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: skillDemands.id,
            rank: skillDemands.rank,
            userRank: skillDemands.userRank,
          })
          .from(skillDemands)
          .where(
            and(
              eq(skillDemands.targetSetId, targetSetId),
              eq(skillDemands.dismissed, false),
              inArray(skillDemands.coverage, ["missing", "weak"]),
            ),
          );
        const before = gapOrder(rows);
        const after = moveInOrder(before, demandId, direction);
        if (after === before) return false;
        for (const [i, gap] of after.entries()) {
          await tx
            .update(skillDemands)
            .set({ userRank: i + 1 })
            .where(eq(skillDemands.id, gap.id));
        }
        return true;
      });
    },

    /** Dismisses a gap (left out of the interview) or restores it. */
    async setDismissed(
      targetSetId: string,
      demandId: string,
      dismissed: boolean,
    ): Promise<boolean> {
      const [row] = await db
        .update(skillDemands)
        .set({ dismissed })
        .where(and(eq(skillDemands.id, demandId), eq(skillDemands.targetSetId, targetSetId)))
        .returning();
      return !!row;
    },
  };
}

export type GapStore = ReturnType<typeof createGapStore>;
