import type { Where } from "chromadb";

import type { UserScopedVectorStore } from "./index";

// JobKeyword vectors (SPEC "Embeddings"): one per job_keywords row, text is
// the JD requirement line (evidence_quote), id is the row id. The metadata
// names every row that owns the keyword, so a delete anywhere up the chain
// (job, target set, library JD, resume) can remove its vectors by filter.

export interface JobKeywordMetadata {
  target_set_id: string;
  job_id: string;
  document_id: string;
  resume_id: string;
  skill_id: string;
  importance: string;
}

/** The rows whose deletion cascades to job_keywords. */
export type KeywordVectorScope =
  | { target_set_id: string }
  | { job_id: string }
  | { document_id: string }
  | { resume_id: string };

export type KeywordVectorStore = Pick<
  UserScopedVectorStore,
  "upsertVectors" | "deleteWhere" | "ids" | "delete"
>;

/** Called by the stores after deleting rows that own job keywords. */
export type RemoveKeywordVectors = (scope: KeywordVectorScope) => Promise<void>;

/**
 * Best-effort delete: SQLite is the source of truth, so a failed Chroma call
 * (e.g. Chroma not running) is logged, not thrown. The next analysis prunes
 * anything left behind (pruneKeywordVectors).
 */
export function keywordVectorRemover(store: () => KeywordVectorStore): RemoveKeywordVectors {
  return async (scope) => {
    try {
      await store().deleteWhere(scope as Where);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "vector_delete_failed",
          collection: "job_keywords",
          scope: Object.keys(scope)[0],
          error: err instanceof Error ? err.name : "unknown",
        }),
      );
    }
  };
}

/** Deletes this user's keyword vectors whose rows no longer exist. Returns how many. */
export async function pruneKeywordVectors(
  store: KeywordVectorStore,
  liveIds: Set<string>,
): Promise<number> {
  const orphans = (await store.ids()).filter((id) => !liveIds.has(id));
  await store.delete(orphans);
  return orphans.length;
}
