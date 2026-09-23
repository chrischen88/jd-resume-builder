import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import { keywordExtractions, type KeywordExtractionRow } from "@/db/schema";
import type { JobExtraction } from "@/lib/ai/extract-keywords";

import { hashText } from "./documents";

export type CachedExtraction = KeywordExtractionRow["result"];

/** Which prompt version and model an extraction came from. */
export interface ExtractionKey {
  promptVersion: string;
  model: string;
}

export type Extractor = (jdText: string) => Promise<JobExtraction>;

/**
 * A JD document and the text to extract from: the document text, or a job's
 * boilerplate-stripped `jd_clean`.
 */
export interface ExtractionSource {
  id: string;
  text: string;
}

const DEFAULT_CONCURRENCY = 3;

/**
 * Cache of keyword extractions per JD document and text, keyed by prompt
 * version and model, so each text costs one model call until the prompt or
 * model changes.
 */
export function createExtractionStore({ db }: { db: Db }) {
  /** Cached extractions of exactly these texts, by document id. */
  async function cached(
    docs: ExtractionSource[],
    key: ExtractionKey,
  ): Promise<Map<string, CachedExtraction>> {
    if (docs.length === 0) return new Map();
    const hashById = new Map(docs.map((d) => [d.id, hashText(d.text)]));
    const rows = await db.query.keywordExtractions.findMany({
      where: and(
        inArray(keywordExtractions.documentId, [...hashById.keys()]),
        inArray(keywordExtractions.textHash, [...new Set(hashById.values())]),
        eq(keywordExtractions.promptVersion, key.promptVersion),
        eq(keywordExtractions.model, key.model),
      ),
    });
    return new Map(
      rows
        .filter((row) => hashById.get(row.documentId) === row.textHash)
        .map((row) => [row.documentId, row.result]),
    );
  }

  return {
    cached,

    /**
     * Returns an extraction for every document, calling `extract` only for
     * the ones not cached yet. Results are saved as each call finishes, so a
     * failure part-way keeps the finished ones; the first failure is rethrown.
     */
    async ensure(
      docs: ExtractionSource[],
      key: ExtractionKey,
      extract: Extractor,
      {
        concurrency = DEFAULT_CONCURRENCY,
        onExtracted,
      }: {
        concurrency?: number;
        /**
         * Called once per document as its extraction becomes available (for
         * progress): cached ones right away, new ones after they're saved.
         */
        onExtracted?: (documentId: string) => void;
      } = {},
    ): Promise<Map<string, CachedExtraction>> {
      const results = await cached(docs, key);
      for (const id of results.keys()) onExtracted?.(id);
      const queue = docs.filter((d) => !results.has(d.id));
      let failure: unknown;

      async function worker() {
        for (let doc = queue.shift(); doc && failure === undefined; doc = queue.shift()) {
          try {
            const { job, keywords, dropped } = await extract(doc.text);
            const result: CachedExtraction = { job, keywords, dropped };
            await db
              .insert(keywordExtractions)
              .values({
                id: randomUUID(),
                documentId: doc.id,
                textHash: hashText(doc.text),
                ...key,
                result,
              })
              .onConflictDoUpdate({
                target: [
                  keywordExtractions.documentId,
                  keywordExtractions.textHash,
                  keywordExtractions.promptVersion,
                  keywordExtractions.model,
                ],
                set: { result, createdAt: new Date() },
              });
            results.set(doc.id, result);
            onExtracted?.(doc.id);
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
