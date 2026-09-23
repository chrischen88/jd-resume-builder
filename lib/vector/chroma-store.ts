import "server-only";

import { randomUUID } from "node:crypto";

import { Document, type DocumentInterface } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { VectorStore } from "@langchain/core/vectorstores";
import type { ChromaClient, Collection, Metadata, Where } from "chromadb";

// A LangChain VectorStore over the `chromadb` v3 client. Written here rather
// than taken from @langchain/community, whose required peer dependencies
// conflict with zod 4.

export interface ChromaStoreConfig {
  client: ChromaClient;
  collectionName: string;
}

export class ChromaVectorStore extends VectorStore {
  declare FilterType: Where;

  private readonly client: ChromaClient;
  private readonly collectionName: string;
  private collectionPromise?: Promise<Collection>;

  constructor(embeddings: EmbeddingsInterface, config: ChromaStoreConfig) {
    super(embeddings, config);
    this.client = config.client;
    this.collectionName = config.collectionName;
  }

  _vectorstoreType(): string {
    return "chroma";
  }

  private collection(): Promise<Collection> {
    this.collectionPromise ??= this.client
      .getOrCreateCollection({
        name: this.collectionName,
        // Cosine space so scores line up with the spec's cosine ≥ 0.80 threshold.
        configuration: { hnsw: { space: "cosine" } },
        // Embeddings are computed by LangChain, never by Chroma.
        embeddingFunction: null,
      })
      .catch((err: unknown) => {
        // Don't cache a failure (e.g. Chroma not started yet): retry next call.
        this.collectionPromise = undefined;
        throw err;
      });
    return this.collectionPromise;
  }

  async addVectors(
    vectors: number[][],
    documents: DocumentInterface[],
    options?: { ids?: string[] },
  ): Promise<string[]> {
    if (vectors.length !== documents.length) {
      throw new Error("addVectors: vectors and documents must have the same length");
    }
    if (documents.length === 0) return [];
    const ids = options?.ids ?? documents.map((doc) => doc.id ?? randomUUID());
    const collection = await this.collection();
    await collection.upsert({
      ids,
      embeddings: vectors,
      documents: documents.map((doc) => doc.pageContent),
      metadatas: documents.map((doc) => doc.metadata as Metadata),
    });
    return ids;
  }

  async addDocuments(
    documents: DocumentInterface[],
    options?: { ids?: string[] },
  ): Promise<string[]> {
    const vectors = await this.embeddings.embedDocuments(documents.map((doc) => doc.pageContent));
    return this.addVectors(vectors, documents, options);
  }

  /**
   * Returns [document, cosine similarity] pairs, highest first. Chroma reports
   * cosine distance; this converts it to similarity (1 - distance) so callers
   * can compare against a similarity threshold directly.
   */
  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: Where,
  ): Promise<[DocumentInterface, number][]> {
    const collection = await this.collection();
    const result = await collection.query({
      queryEmbeddings: [query],
      nResults: k,
      ...(filter ? { where: filter } : {}),
      include: ["documents", "metadatas", "distances"],
    });
    return (result.rows()[0] ?? []).map((row) => [
      new Document({
        id: row.id,
        pageContent: row.document ?? "",
        metadata: row.metadata ?? {},
      }),
      1 - (row.distance ?? 1),
    ]);
  }

  /** Ids of the records matching `filter`, paged so large collections aren't read in one call. */
  async ids(filter?: Where, pageSize = 1000): Promise<string[]> {
    const collection = await this.collection();
    const ids: string[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await collection.get({
        ...(filter ? { where: filter } : {}),
        limit: pageSize,
        offset,
        include: [],
      });
      ids.push(...page.ids);
      if (page.ids.length < pageSize) return ids;
    }
  }

  async delete(params: { ids?: string[]; filter?: Where }): Promise<void> {
    const collection = await this.collection();
    await collection.delete({ ids: params.ids, where: params.filter });
  }
}
