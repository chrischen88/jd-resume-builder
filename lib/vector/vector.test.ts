import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { ChromaClient, Where } from "chromadb";
import { describe, expect, it, vi } from "vitest";

import { ChromaVectorStore } from "./chroma-store";
import { evidenceRecord } from "./evidence";
import { UserScopedVectorStore } from "./index";
import { keywordVectorRemover, pruneKeywordVectors, type KeywordVectorStore } from "./job-keywords";

// Deterministic fake embeddings: the vector is just the text length.
const embeddings = {
  embedDocuments: vi.fn(async (texts: string[]) => texts.map((t) => [t.length])),
  embedQuery: vi.fn(async (text: string) => [text.length]),
} as unknown as EmbeddingsInterface;

function fakeChroma(rows: { id: string; document: string; metadata: object; distance: number }[]) {
  const collection = {
    upsert: vi.fn(async () => {}),
    delete: vi.fn(async () => ({ deleted: 0 })),
    get: vi.fn(async ({ offset = 0, limit = 1000 }: { offset?: number; limit?: number }) => ({
      ids: rows.slice(offset, offset + limit).map((r) => r.id),
    })),
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

  it("retries opening the collection after a failure (Chroma started late)", async () => {
    const { client, getOrCreateCollection } = fakeChroma([]);
    getOrCreateCollection.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const store = new ChromaVectorStore(embeddings, { client, collectionName: "job_keywords" });

    await expect(store.similaritySearchVectorWithScore([1], 3)).rejects.toThrow("ECONNREFUSED");
    await expect(store.similaritySearchVectorWithScore([1], 3)).resolves.toEqual([]);
    expect(getOrCreateCollection).toHaveBeenCalledTimes(2);
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

  it("upserts precomputed vectors without embedding, stamped with the user", async () => {
    const { collection, scopedStore } = scoped("u1");
    vi.mocked(embeddings.embedDocuments).mockClear();

    await scopedStore.upsertVectors([
      { id: "k1", text: "A/B testing", vector: [0.1, 0.2], metadata: { job_id: "j1" } },
    ]);

    expect(embeddings.embedDocuments).not.toHaveBeenCalled();
    expect(collection.upsert).toHaveBeenCalledWith({
      ids: ["k1"],
      embeddings: [[0.1, 0.2]],
      documents: ["A/B testing"],
      metadatas: [{ job_id: "j1", user_id: "u1" }],
    });
  });

  it("scopes filtered deletes and id listings to the user", async () => {
    const { collection, scopedStore } = scoped("u1");
    await scopedStore.deleteWhere({ job_id: "j1" });
    expect(collection.delete).toHaveBeenCalledWith({
      ids: undefined,
      where: { $and: [{ user_id: "u1" }, { job_id: "j1" }] },
    });
    expect(await scopedStore.ids()).toEqual(["k1"]);
    expect(collection.get).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: "u1" }, include: [] }),
    );
  });

  it("requires a user id", () => {
    const { client } = fakeChroma([]);
    const store = new ChromaVectorStore(embeddings, { client, collectionName: "evidence" });
    expect(() => new UserScopedVectorStore(store, "")).toThrow(/userId/);
  });
});

describe("ChromaVectorStore.ids", () => {
  it("pages through the collection", async () => {
    const rows = ["a", "b", "c"].map((id) => ({ id, document: "", metadata: {}, distance: 0 }));
    const { client, collection } = fakeChroma(rows);
    const store = new ChromaVectorStore(embeddings, { client, collectionName: "job_keywords" });
    expect(await store.ids(undefined, 2)).toEqual(["a", "b", "c"]);
    expect(collection.get).toHaveBeenCalledTimes(2);
  });
});

describe("job keyword vector helpers", () => {
  function fakeStore(ids: string[]) {
    return {
      upsertVectors: vi.fn(async () => {}),
      deleteWhere: vi.fn(async () => {}),
      ids: vi.fn(async () => ids),
      delete: vi.fn(async () => {}),
    } satisfies KeywordVectorStore;
  }

  it("prunes vectors whose rows are gone", async () => {
    const store = fakeStore(["k1", "k2", "k3"]);
    expect(await pruneKeywordVectors(store, new Set(["k2"]))).toBe(2);
    expect(store.delete).toHaveBeenCalledWith(["k1", "k3"]);
  });

  it("deletes by scope, and logs instead of throwing when Chroma fails", async () => {
    const store = fakeStore([]);
    await keywordVectorRemover(() => store)({ job_id: "j1" });
    expect(store.deleteWhere).toHaveBeenCalledWith({ job_id: "j1" });

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = keywordVectorRemover(() => {
      throw new Error("Chroma not configured");
    });
    await expect(failing({ target_set_id: "s1" })).resolves.toBeUndefined();
    expect(JSON.parse(error.mock.calls[0][0] as string)).toEqual({
      event: "vector_delete_failed",
      collection: "job_keywords",
      scope: "target_set_id",
      error: "Error",
    });
    error.mockRestore();
  });
});

describe("evidenceRecord", () => {
  it("embeds the filled-in fields, one per line, keyed by the row id", () => {
    const record = evidenceRecord(
      {
        id: "e1",
        roleId: "r1",
        situation: "Checkout conversion was flat",
        action: "Ran A/B tests on the checkout flow",
        tools: ["Optimizely", "SQL"],
        scale: null,
        result: "Lifted conversion",
        metric: " 4% ",
      },
      ["A/B testing"],
    );
    expect(record).toEqual({
      id: "e1",
      text: [
        "Checkout conversion was flat",
        "Ran A/B tests on the checkout flow",
        "Tools: Optimizely, SQL",
        "Lifted conversion",
        "4%",
        "Skills: A/B testing",
      ].join("\n"),
      metadata: { role_id: "r1" },
    });
  });
});
