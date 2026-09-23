import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/db/client";
import type { JobExtraction } from "@/lib/ai/extract-keywords";

import { createLibrary, type Library } from "./documents";
import { createExtractionStore, type ExtractionStore, type Extractor } from "./extractions";

const key = { promptVersion: "1.0.0", model: "anthropic:test" };

function extraction(title: string): JobExtraction {
  return {
    job: { company: null, title, seniority: null, years_experience_min: null },
    keywords: [],
    dropped: { quoteNotFound: 0, phraseNotFound: 0, empty: 0, duplicates: 0 },
    promptVersion: key.promptVersion,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

let dataDir: string;
let db: Db;
let library: Library;
let store: ExtractionStore;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "extractions-test-"));
  db = await openDb(":memory:");
  library = createLibrary({ db, dataDir });
  store = createExtractionStore({ db });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("extraction store", () => {
  it("extracts uncached documents once and reuses the result", async () => {
    const a = await library.add({ kind: "jd", text: "Job A" });
    const b = await library.add({ kind: "jd", text: "Job B" });
    const extract = vi.fn<Extractor>(async (text) => extraction(text));

    const first = await store.ensure([a, b], key, extract);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(first.get(a.id)?.job.title).toBe("Job A");

    const second = await store.ensure([a, b], key, extract);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(second.get(b.id)?.job.title).toBe("Job B");
    // Only the cached fields are stored, not usage.
    expect(second.get(b.id)).not.toHaveProperty("usage");
  });

  it("re-extracts when the prompt version or model changes", async () => {
    const a = await library.add({ kind: "jd", text: "Job A" });
    const extract = vi.fn<Extractor>(async (text) => extraction(text));
    await store.ensure([a], key, extract);
    await store.ensure([a], { ...key, promptVersion: "1.1.0" }, extract);
    await store.ensure([a], { ...key, model: "openai:test" }, extract);
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it("keeps finished extractions when one fails, then rethrows", async () => {
    const a = await library.add({ kind: "jd", text: "Job A" });
    const b = await library.add({ kind: "jd", text: "Job B" });
    const extract = vi.fn<Extractor>(async (text) => {
      if (text === "Job B") throw new Error("model down");
      return extraction(text);
    });

    await expect(store.ensure([a, b], key, extract, { concurrency: 1 })).rejects.toThrow(
      "model down",
    );
    const cached = await store.cached([a.id, b.id], key);
    expect([...cached.keys()]).toEqual([a.id]);
  });

  it("deletes cached extractions with their document", async () => {
    const a = await library.add({ kind: "jd", text: "Job A" });
    await store.ensure([a], key, async (text) => extraction(text));
    await library.remove(a.id);
    expect((await store.cached([a.id], key)).size).toBe(0);
    expect(await db.query.keywordExtractions.findMany()).toEqual([]);
  });
});
