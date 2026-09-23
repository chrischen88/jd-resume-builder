import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { ChromaClient, Where } from "chromadb";
import { describe, expect, it, vi } from "vitest";

import { ChromaVectorStore } from "./chroma-store";
import { UserScopedVectorStore } from "./index";

// Deterministic fake embeddings: the vector is just the text length.
const embeddings = {
  embedDocuments: vi.fn(async (texts: string[]) => texts.map((t) => [t.length])),
  embedQuery: vi.fn(async (text: string) => [text.length]),
} as unknown as EmbeddingsInterface;

function fakeChroma(rows: { id: string; document: string; metadata: object; distance: number }[]) {
  const collection = {
    upsert: vi.fn(async () => {}),
    delete: vi.fn(async () => ({ deleted: 0 })),
    query: vi.fn<(args: { where?: Where }) => Promise<{ rows: () => (typeof rows)[] }>>(
      async () => ({ rows: () => [rows] }),
    ),
  };
  const getOrCreateCollection = vi.fn(async () => collection);
  const client = { getOrCreateCollection } as unknown as ChromaClient;
  return { client, collection, getOrCreateCollection };
}

describe("ChromaVectorStore", () => {
  it("creates a cosine collection once, with no Chroma-side embedding function", async () => {
    const { client, getOrCreateCollection } = fakeChroma([]);
    const store = new ChromaVectorStore(embeddings, { client, collectionName: "evidence" });

    await store.similaritySearchVectorWithScore([1], 3);
    await store.similaritySearchVectorWithScore([1], 3);

    expect(getOrCreateCollection).toHaveBeenCalledTimes(1);
    expect(getOrCreateCollection).toHaveBeenCalledWith({
      name: "evidence",
      configuration: { hnsw: { space: "cosine" } },
      embeddingFunction: null,
    });
  });

  it("embeds documents with LangChain and upserts them", async () => {
    const { client, collection } = fakeChroma([]);
    const store = new ChromaVectorStore(embeddings, { client, collectionName: "evidence" });

    const ids = await store.addDocuments(
      [{ pageContent: "Built dashboards", metadata: { role_id: "r1" } }],
      { ids: ["e1"] },
    );

    expect(ids).toEqual(["e1"]);
    expect(collection.upsert).toHaveBeenCalledWith({
      ids: ["e1"],
      embeddings: [[16]],
      documents: ["Built dashboards"],
      metadatas: [{ role_id: "r1" }],
    });
  });

  it("returns cosine similarity (1 - distance)", async () => {
    const { client, collection } = fakeChroma([
      { id: "e1", document: "SQL reporting", metadata: { user_id: "u1" }, distance: 0.15 },
    ]);
    const store = new ChromaVectorStore(embeddings, { client, collectionName: "evidence" });

    const [[doc, score]] = await store.similaritySearchVectorWithScore([1], 5, { user_id: "u1" });

    expect(collection.query).toHaveBeenCalledWith({
      queryEmbeddings: [[1]],
      nResults: 5,
      where: { user_id: "u1" },
      include: ["documents", "metadatas", "distances"],
    });
    expect(doc).toMatchObject({ id: "e1", pageContent: "SQL reporting" });
    expect(score).toBeCloseTo(0.85);
  });
});

describe("UserScopedVectorStore", () => {
  function scoped(userId: string) {
    const chroma = fakeChroma([
      { id: "k1", document: "A/B testing", metadata: { user_id: userId }, distance: 0.1 },
    ]);
    const store = new ChromaVectorStore(embeddings, {
      client: chroma.client,
      collectionName: "job_keywords",
    });
    return { ...chroma, scopedStore: new UserScopedVectorStore(store, userId) };
  }

  it("stamps user_id on every record and cannot be overridden", async () => {
    const { collection, scopedStore } = scoped("u1");

    await scopedStore.upsert([
      { id: "k1", text: "A/B testing", metadata: { user_id: "someone-else", job_id: "j1" } },
    ]);

    expect(collection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ ids: ["k1"], metadatas: [{ user_id: "u1", job_id: "j1" }] }),
    );
  });

  it("always filters searches to the user", async () => {
    const { collection, scopedStore } = scoped("u1");

    const plain = await scopedStore.search("experimentation", 3);
    await scopedStore.search("experimentation", 3, { job_id: "j1" });

    expect(collection.query.mock.calls[0][0]).toMatchObject({ where: { user_id: "u1" } });
    expect(collection.query.mock.calls[1][0]).toMatchObject({
      where: { $and: [{ user_id: "u1" }, { job_id: "j1" }] },
    });
    expect(plain).toEqual([
      { id: "k1", text: "A/B testing", metadata: { user_id: "u1" }, similarity: 0.9 },
    ]);
  });

  it("scopes deletes to the user", async () => {
    const { collection, scopedStore } = scoped("u1");
    await scopedStore.delete(["k1"]);
    expect(collection.delete).toHaveBeenCalledWith({ ids: ["k1"], where: { user_id: "u1" } });
  });

  it("requires a user id", () => {
    const { client } = fakeChroma([]);
    const store = new ChromaVectorStore(embeddings, { client, collectionName: "evidence" });
    expect(() => new UserScopedVectorStore(store, "")).toThrow(/userId/);
  });
});
