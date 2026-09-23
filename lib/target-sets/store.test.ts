import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/db/client";
import { skillDemands, skills, targetSets } from "@/db/schema";
import { createLibrary, type Library } from "@/lib/library/documents";
import { createResumeStore } from "@/lib/resume/store";

import { createTargetSetStore, MAX_JOBS, TargetSetError, type TargetSetStore } from "./store";

let dataDir: string;
let db: Db;
let library: Library;
let store: TargetSetStore;
let resumeId: string;

// Long enough (50+ words of content) that boilerplate stripping applies.
const jdText = (n: number) =>
  [
    `Role ${n}`,
    "You will build and deploy ML systems in Python for our fraud and risk products.",
    "Requirements",
    "- SQL and data modeling across large analytical datasets",
    "- Kubernetes and containerized deployment of model services",
    "- Experiment design, A/B testing, and statistical analysis",
    "- Clear communication with product, design, and engineering partners",
    "- Monitoring model performance and retraining in production",
    "",
    "The base salary range is $150,000 - $190,000.",
  ].join("\n");

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "target-set-test-"));
  db = await openDb(":memory:");
  library = createLibrary({ db, dataDir });
  store = createTargetSetStore({ db });
  const resumeDoc = await library.add({ kind: "resume", text: "Jordan Rivera" });
  resumeId = await createResumeStore({ db }).create(resumeDoc, {
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
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("target set store", () => {
  it("creates a set and adds JDs with boilerplate stripped", async () => {
    const id = await store.create({ name: "  ML roles ", resumeId });
    const [a, b] = await Promise.all(
      [1, 2].map((n) => library.add({ kind: "jd", title: `JD ${n}`, text: jdText(n) })),
    );

    expect(await store.addJobs(id, [a, b])).toEqual({ added: ["JD 1", "JD 2"], alreadyInSet: [] });
    const set = (await store.get(id))!;
    expect(set).toMatchObject({ name: "ML roles", status: "draft", resumeTitle: "Jordan Rivera" });
    expect(set.jobs.map((j) => j.documentTitle).sort()).toEqual(["JD 1", "JD 2"]);
    expect(set.jobs[0].jdClean).not.toContain("salary");
    expect(set.jobs[0].jdClean).toContain("- Kubernetes");
    // "The base salary range is $150,000 - $190,000." is stripped.
    const { original, clean } = set.jobs[0].wordCounts;
    expect(original - clean).toBe(8);
  });

  it("lists a set's analyzed skills by rank", async () => {
    const id = await store.create({ name: "Set", resumeId });
    expect(await store.demands(id)).toEqual([]);
    await db.insert(skills).values([
      { id: "s-sql", key: "sql", canonicalName: "SQL", category: "tool" },
      { id: "s-py", key: "python", canonicalName: "Python", category: "tool" },
    ]);
    const demand = { targetSetId: id, jdCount: 2, requiredCount: 1, demandScore: 5 };
    await db.insert(skillDemands).values([
      { ...demand, id: "d-sql", skillId: "s-sql", mustDo: false, rank: 2, coverage: "missing" },
      { ...demand, id: "d-py", skillId: "s-py", mustDo: true, rank: 1, coverage: "covered" },
    ]);
    expect(await store.demands(id)).toEqual([
      expect.objectContaining({ name: "Python", rank: 1, mustDo: true, coverage: "covered" }),
      expect.objectContaining({ name: "SQL", rank: 2, category: "tool", coverage: "missing" }),
    ]);
  });

  it("copies an imported JD's source URL onto the job", async () => {
    const id = await store.create({ name: "Set", resumeId });
    const url = "https://www.linkedin.com/jobs/view/4012345678/";
    const doc = await library.add({ kind: "jd", text: jdText(1), sourceUrl: url });
    await store.addJobs(id, [doc]);
    expect((await store.get(id))!.jobs[0].sourceUrl).toBe(url);
  });

  it("skips JDs already in the set, including duplicates in one call", async () => {
    const id = await store.create({ name: "Set", resumeId });
    const a = await library.add({ kind: "jd", title: "JD 1", text: jdText(1) });
    await store.addJobs(id, [a]);
    expect(await store.addJobs(id, [a, a])).toEqual({ added: [], alreadyInSet: ["JD 1"] });
    expect((await store.get(id))!.jobs).toHaveLength(1);
  });

  it("rejects resumes and more than the maximum, adding nothing", async () => {
    const id = await store.create({ name: "Set", resumeId });
    const resumeDoc = (await library.list("resume"))[0];
    await expect(store.addJobs(id, [resumeDoc])).rejects.toMatchObject({ code: "not_jd" });

    const docs = await Promise.all(
      Array.from({ length: MAX_JOBS + 1 }, (_, n) => library.add({ kind: "jd", text: jdText(n) })),
    );
    await expect(store.addJobs(id, docs)).rejects.toMatchObject({ code: "too_many" });
    expect((await store.get(id))!.jobs).toHaveLength(0);
    await expect(store.addJobs(id, docs.slice(0, MAX_JOBS))).resolves.toMatchObject({
      alreadyInSet: [],
    });
  });

  it("errors for a missing resume or set", async () => {
    await expect(store.create({ name: "Set", resumeId: "missing" })).rejects.toBeInstanceOf(
      TargetSetError,
    );
    await expect(store.addJobs("missing", [])).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists sets with job counts, renames, removes a job, and deletes", async () => {
    const id = await store.create({ name: "Set", resumeId });
    const empty = await store.create({ name: "Empty", resumeId });
    const a = await library.add({ kind: "jd", text: jdText(1) });
    const b = await library.add({ kind: "jd", text: jdText(2) });
    await store.addJobs(id, [a, b]);

    const counts = Object.fromEntries((await store.list()).map((s) => [s.id, s.jobCount]));
    expect(counts).toEqual({ [id]: 2, [empty]: 0 });

    expect(await store.rename(id, "Renamed")).toBe(true);
    const job = (await store.get(id))!.jobs[0];
    expect(await store.removeJob(empty, job.id)).toBe(false);
    expect(await store.removeJob(id, job.id)).toBe(true);
    expect((await store.get(id))!).toMatchObject({ name: "Renamed", jobs: [expect.anything()] });

    expect(await store.remove(id)).toBe(true);
    expect(await store.get(id)).toBeUndefined();
    expect(await library.get(a.id)).toBeDefined();
  });

  it("removes job-keyword vectors when rows that own them are deleted", async () => {
    const removeKeywordVectors = vi.fn(async () => {});
    const sets = createTargetSetStore({ db, removeKeywordVectors });
    const docs = createLibrary({ db, dataDir, removeKeywordVectors });
    const resumes = createResumeStore({ db, removeKeywordVectors });
    const id = await sets.create({ name: "Set", resumeId });
    const [a, b] = await Promise.all([1, 2].map((n) => docs.add({ kind: "jd", text: jdText(n) })));
    await sets.addJobs(id, [a, b]);
    const job = (await sets.get(id))!.jobs.find((j) => j.documentId === a.id)!;

    await sets.removeJob(id, "not-a-job");
    await sets.removeJob(id, job.id);
    await docs.remove(b.id);
    await sets.remove(id);
    await resumes.remove(resumeId);

    expect(removeKeywordVectors.mock.calls).toEqual([
      [{ job_id: job.id }],
      [{ document_id: b.id }],
      [{ target_set_id: id }],
      [{ resume_id: resumeId }],
    ]);
  });

  it("drops a JD from sets when it's deleted from the library", async () => {
    const id = await store.create({ name: "Set", resumeId });
    const a = await library.add({ kind: "jd", text: jdText(1) });
    await store.addJobs(id, [a]);
    await library.remove(a.id);
    expect((await store.get(id))!.jobs).toEqual([]);
  });

  it("marks an analyzed set out of date when its JDs change", async () => {
    const id = await store.create({ name: "Set", resumeId });
    const [a, b, c] = await Promise.all(
      [1, 2, 3].map((n) => library.add({ kind: "jd", title: `JD ${n}`, text: jdText(n) })),
    );
    await store.addJobs(id, [a, b]);
    const setStatus = (status: "ready" | "analyzing") =>
      db.update(targetSets).set({ status }).where(eq(targetSets.id, id));

    await setStatus("ready");
    await store.addJobs(id, [c]);
    expect((await store.get(id))!.status).toBe("draft");

    await setStatus("ready");
    await store.removeJob(id, (await store.get(id))!.jobs[0].id);
    expect((await store.get(id))!.status).toBe("draft");

    // A running analysis owns the status.
    await setStatus("analyzing");
    await store.addJobs(id, [a]);
    expect((await store.get(id))!.status).toBe("analyzing");
  });
});
