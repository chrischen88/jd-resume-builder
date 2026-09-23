import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/db/client";
import { targetSets } from "@/db/schema";
import { createLibrary } from "@/lib/library/documents";
import { createResumeStore } from "@/lib/resume/store";

import { createAnalysisRunner } from "./analysis-runner";
import { AnalysisError, type AnalysisProgress, type AnalysisResult } from "./analyze";
import { createTargetSetStore } from "./store";

let dataDir: string;
let db: Db;
let setId: string;

const RESULT: AnalysisResult = { skills: 1, covered: 1, weak: 0, missing: 0 };

/** A promise plus its resolve/reject, to hold a run open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "runner-test-"));
  db = await openDb(":memory:");
  const library = createLibrary({ db, dataDir });
  const store = createTargetSetStore({ db });
  const resumeDoc = await library.add({ kind: "resume", text: "Jordan Rivera" });
  const resumeId = await createResumeStore({ db }).create(resumeDoc, {
    sections: {
      contact: { name: null, email: null, phone: null, location: null, links: [] },
      summary: null,
      skills: [],
      education: [],
      certifications: [],
      other: [],
    },
    roles: [],
  });
  setId = await store.create({ name: "Set", resumeId });
  const docs = await Promise.all(
    ["JD one text", "JD two text"].map((text) => library.add({ kind: "jd", text })),
  );
  await store.addJobs(setId, docs);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("analysis runner", () => {
  it("reports progress while running, then ready", async () => {
    const gate = deferred<AnalysisResult>();
    let report!: (p: AnalysisProgress) => void;
    const runner = createAnalysisRunner({
      db,
      analyze: (_id, { onProgress }) => ((report = onProgress), gate.promise),
    });

    const { done } = await runner.start(setId);
    report({ stage: "extracting", extracted: 1, total: 2 });
    expect(await runner.status(setId)).toMatchObject({
      status: "analyzing",
      progress: { extracted: 1, total: 2 },
    });
    await expect(runner.start(setId)).rejects.toMatchObject({ code: "busy" });

    gate.resolve(RESULT);
    await done;
    const status = (await runner.status(setId))!;
    expect(status).toMatchObject({ status: "ready", progress: null, error: null });
    expect(status.analyzedAt).toBeInstanceOf(Date);
    expect(runner.isRunning(setId)).toBe(false);
  });

  it("stores a user-facing error on failure and hides unexpected ones", async () => {
    const runner = createAnalysisRunner({
      db,
      analyze: async () => {
        throw new AnalysisError("Keyword extraction stopped: the model call failed.");
      },
    });
    await (await runner.start(setId)).done;
    expect(await runner.status(setId)).toMatchObject({
      status: "failed",
      error: "Keyword extraction stopped: the model call failed.",
    });

    const crashing = createAnalysisRunner({
      db,
      analyze: async () => {
        throw new Error("SQLITE_BUSY: resume text here");
      },
    });
    await (await crashing.start(setId)).done;
    expect((await crashing.status(setId))!.error).toBe("Analysis failed unexpectedly. Try again.");
  });

  it("rejects before starting when the set can't be analyzed", async () => {
    const analyze = vi.fn(async () => RESULT);
    const runner = createAnalysisRunner({ db, analyze });
    await expect(runner.start("missing")).rejects.toMatchObject({ code: "not_found" });
    const set = (await createTargetSetStore({ db }).get(setId))!;
    await createTargetSetStore({ db }).removeJob(setId, set.jobs[0].id);
    await expect(runner.start(setId)).rejects.toMatchObject({ code: "too_few" });
    expect(analyze).not.toHaveBeenCalled();
    expect(runner.isRunning(setId)).toBe(false);
    expect((await runner.status(setId))!.status).toBe("draft");
  });

  it("reports a run cut off by a restart as failed", async () => {
    await db.update(targetSets).set({ status: "analyzing" }).where(eq(targetSets.id, setId));
    const runner = createAnalysisRunner({ db, analyze: async () => RESULT });
    expect(await runner.status(setId)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("interrupted"),
    });
    expect(await runner.status("missing")).toBeUndefined();
  });
});
