import "server-only";

import type { DocumentInterface } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { ChromaClient, type Metadata, type Where } from "chromadb";

import { embeddingsFromEnv } from "../ai/models";
import { ChromaVectorStore } from "./chroma-store";

// Per SPEC: one embedding per JD requirement line (JobKeyword) and one per
// Evidence record, so retrieval goes JD requirement → user evidence.
export const COLLECTIONS = {
  jobKeywords: "job_keywords",
  evidence: "evidence",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

type Env = Record<string, string | undefined>;

/** Parses CHROMA_URL (default http://localhost:8000) into client args. */
export function chromaClientFromEnv(env: Env = process.env): ChromaClient {
  const url = new URL(env.CHROMA_URL?.trim() || "http://localhost:8000");
  const ssl = url.protocol === "https:";
  return new ChromaClient({
    host: url.hostname,
    port: url.port ? Number(url.port) : ssl ? 443 : 80,
    ssl,
    ...(env.CHROMA_TENANT ? { tenant: env.CHROMA_TENANT } : {}),
    ...(env.CHROMA_DATABASE ? { database: env.CHROMA_DATABASE } : {}),
  });
}

export interface UserVectorRecord {
  /** Postgres row id (JobKeyword.id or Evidence.id); reused as the Chroma id. */
  id: string;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Every read and write is pinned to one user's `user_id` metadata, the vector
 * equivalent of the per-user row checks on Postgres queries. Callers never
 * get an unscoped store.
 */
export class UserScopedVectorStore {
  constructor(
    private readonly store: ChromaVectorStore,
    readonly userId: string,
  ) {
    if (!userId) throw new Error("UserScopedVectorStore requires a userId");
  }

  async upsert(records: UserVectorRecord[]): Promise<string[]> {
    const documents: DocumentInterface[] = records.map((record) => ({
      id: record.id,
      pageContent: record.text,
      metadata: { ...record.metadata, user_id: this.userId },
    }));
    return this.store.addDocuments(documents, { ids: records.map((r) => r.id) });
  }

  /** Returns matches with cosine similarity, highest first. */
  async search(
    query: string,
    k: number,
    filter?: Where,
  ): Promise<{ id: string; text: string; metadata: Metadata; similarity: number }[]> {
    const results = await this.store.similaritySearchWithScore(query, k, this.scope(filter));
    return results.map(([doc, similarity]) => ({
      id: doc.id ?? "",
      text: doc.pageContent,
      metadata: doc.metadata as Metadata,
      similarity,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.store.delete({ ids, filter: this.scope() });
  }

  scope(filter?: Where): Where {
    const own: Where = { user_id: this.userId };
    return filter ? { $and: [own, filter] } : own;
  }
}

let sharedClient: ChromaClient | undefined;
let sharedEmbeddings: EmbeddingsInterface | undefined;
const stores = new Map<CollectionName, ChromaVectorStore>();

export function vectorStoreForUser(collection: CollectionName, userId: string) {
  let store = stores.get(collection);
  if (!store) {
    sharedClient ??= chromaClientFromEnv();
    sharedEmbeddings ??= embeddingsFromEnv();
    store = new ChromaVectorStore(sharedEmbeddings, {
      client: sharedClient,
      collectionName: collection,
    });
    stores.set(collection, store);
  }
  return new UserScopedVectorStore(store, userId);
}
