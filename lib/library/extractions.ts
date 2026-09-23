import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import { keywordExtractions, type DocumentRow, type KeywordExtractionRow } from "@/db/schema";
import type { JobExtraction } from "@/lib/ai/extract-keywords";

export type CachedExtraction = KeywordExtractionRow["result"];

/** Which prompt version and model an extraction came from. */
export interface ExtractionKey {
  promptVersion: string;
  model: string;
}

export type Extractor = (jdText: string) => Promise<JobExtraction>;

const DEFAULT_CONCURRENCY = 3;

/**
 * Cache of keyword extractions per JD document, keyed by prompt version and
 * model, so each JD costs one model call until the prompt or model changes.
 */
export function createExtractionStore({ db }: { db: Db }) {
  async function cached(
    documentIds: string[],
    key: ExtractionKey,
  ): Promise<Map<string, CachedExtraction>> {
    if (documentIds.length === 0) return new Map();
    const rows = await db.query.keywordExtractions.findMany({
      where: and(
        inArray(keywordExtractions.documentId, documentIds),
        eq(keywordExtractions.promptVersion, key.promptVersion),
        eq(keywordExtractions.model, key.model),
      ),
    });
    return new Map(rows.map((row) => [row.documentId, row.result]));
  }

  return {
    cached,

    /**
     * Returns an extraction for every document, calling `extract` only for
     * the ones not cached yet. Results are saved as each call finishes, so a
     * failure part-way keeps the finished ones; the first failure is rethrown.
     */
    async ensure(
      docs: Pick<DocumentRow, "id" | "text">[],
      key: ExtractionKey,
      extract: Extractor,
      { concurrency = DEFAULT_CONCURRENCY }: { concurrency?: number } = {},
    ): Promise<Map<string, CachedExtraction>> {
      const results = await cached(
        docs.map((d) => d.id),
        key,
      );
      const queue = docs.filter((d) => !results.has(d.id));
      let failure: unknown;

      async function worker() {
        for (let doc = queue.shift(); doc && failure === undefined; doc = queue.shift()) {
          try {
            const { job, keywords, dropped } = await extract(doc.text);
            const result: CachedExtraction = { job, keywords, dropped };
            await db
              .insert(keywordExtractions)
              .values({ id: randomUUID(), documentId: doc.id, ...key, result })
              .onConflictDoUpdate({
                target: [
                  keywordExtractions.documentId,
                  keywordExtractions.promptVersion,
                  keywordExtractions.model,
                ],
                set: { result, createdAt: new Date() },
              });
            results.set(doc.id, result);
          } catch (err) {
            failure ??= err;
          }
        }
      }

      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
      if (failure !== undefined) throw failure;
      return results;
    },
  };
}

export type ExtractionStore = ReturnType<typeof createExtractionStore>;
