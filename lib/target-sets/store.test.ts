import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "@/db/client";
import { createLibrary, type Library } from "@/lib/library/documents";
import { createResumeStore } from "@/lib/resume/store";

import { createTargetSetStore, MAX_JOBS, TargetSetError, type TargetSetStore } from "./store";

let dataDir: string;
let db: Db;
let library: Library;
let store: TargetSetStore;
let resumeId: string;

const jdText = (n: number) =>
  `Role ${n}\nYou will build ML systems in Python.\nRequirements\n- SQL\n- Kubernetes\n\nThe base salary range is $150,000 - $190,000.`;

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

  it("drops a JD from sets when it's deleted from the library", async () => {
    const id = await store.create({ name: "Set", resumeId });
    const a = await library.add({ kind: "jd", text: jdText(1) });
    await store.addJobs(id, [a]);
    await library.remove(a.id);
    expect((await store.get(id))!.jobs).toEqual([]);
  });
});
