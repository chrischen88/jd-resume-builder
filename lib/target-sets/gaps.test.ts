import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "@/db/client";
import { gapAnswers, jobKeywords, skillDemands, skills } from "@/db/schema";
import { createLibrary } from "@/lib/library/documents";
import { createResumeStore } from "@/lib/resume/store";

import { createGapStore, gapOrder, moveInOrder } from "./gaps";
import { createTargetSetStore } from "./store";

describe("gapOrder", () => {
  it("uses the user's order where set, demand rank otherwise", () => {
    const gaps = [
      { id: "a", rank: 1, userRank: 3 },
      { id: "b", rank: 2, userRank: 1 },
      { id: "c", rank: 5, userRank: null },
      { id: "d", rank: 2, userRank: null },
    ];
    expect(gapOrder(gaps).map((g) => g.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("moveInOrder", () => {
  const list = ["a", "b", "c"].map((id) => ({ id }));
  const ids = (l: { id: string }[]) => l.map((g) => g.id);

  it("moves to the top, up, or down", () => {
    expect(ids(moveInOrder(list, "c", "top"))).toEqual(["c", "a", "b"]);
    expect(ids(moveInOrder(list, "b", "up"))).toEqual(["b", "a", "c"]);
    expect(ids(moveInOrder(list, "b", "down"))).toEqual(["a", "c", "b"]);
  });

  it("returns the same list when the move isn't possible", () => {
    expect(moveInOrder(list, "a", "up")).toBe(list);
    expect(moveInOrder(list, "a", "top")).toBe(list);
    expect(moveInOrder(list, "c", "down")).toBe(list);
    expect(moveInOrder(list, "zzz", "up")).toBe(list);
  });
});

let dataDir: string;
let db: Db;
let setId: string;
let jobIds: string[];

const demand = (
  skillId: string,
  rank: number,
  coverage: "covered" | "weak" | "missing",
  extra: Partial<typeof skillDemands.$inferInsert> = {},
) => ({
  id: `d-${skillId}`,
  targetSetId: setId,
  skillId,
  jdCount: 2,
  requiredCount: 1,
  demandScore: 10 - rank,
  mustDo: rank === 1,
  rank,
  coverage,
  ...extra,
});

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "gaps-test-"));
  db = await openDb(":memory:");
  const library = createLibrary({ db, dataDir });
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
  const store = createTargetSetStore({ db });
  setId = await store.create({ name: "Set", resumeId });
  const docs = await Promise.all(
    [1, 2].map((n) => library.add({ kind: "jd", title: `Acme JD ${n}`, text: `JD ${n}` })),
  );
  await store.addJobs(setId, docs);
  const set = (await store.get(setId))!;
  jobIds = docs.map((d) => set.jobs.find((j) => j.documentId === d.id)!.id);

  await db.insert(skills).values(
    ["k8s", "ab", "go", "python"].map((id) => ({
      id,
      key: id,
      canonicalName: id.toUpperCase(),
      category: "tool" as const,
    })),
  );
  await db.insert(skillDemands).values([
    demand("python", 1, "covered"),
    demand("k8s", 2, "missing"),
    demand("ab", 3, "weak", { coverageEvidence: ["Ran experiments on checkout"] }),
    demand("go", 4, "missing"),
  ]);
  const mention = (
    id: string,
    jobId: string,
    evidenceQuote: string,
    importance: "required" | "preferred" | "mentioned",
  ) => ({ id, jobId, skillId: "k8s", jdPhrase: "k8s", evidenceQuote, importance });
  await db.insert(jobKeywords).values([
    mention("m1", jobIds[0], "Nice: k8s.", "preferred"),
    mention("m2", jobIds[0], "Must know Kubernetes.", "required"),
    mention("m3", jobIds[1], "You'll run k8s.", "mentioned"),
  ]);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("gap store", () => {
  it("lists missing and weak skills in order, with why and any answer", async () => {
    await db.insert(gapAnswers).values({ id: "a1", skillDemandId: "d-go", response: "no" });
    const overview = await createGapStore({ db }).overview(setId);

    expect(overview.jobCount).toBe(2);
    expect(overview.active.map((g) => g.name)).toEqual(["K8S", "AB", "GO"]);
    const [k8s, ab, go] = overview.active;
    // One sentence per JD, the strongest; required first.
    expect(k8s.sources).toEqual([
      { jobTitle: "Acme JD 1", quote: "Must know Kubernetes.", importance: "required" },
      { jobTitle: "Acme JD 2", quote: "You'll run k8s.", importance: "mentioned" },
    ]);
    expect(ab).toMatchObject({ coverage: "weak", evidence: ["Ran experiments on checkout"] });
    expect(k8s.evidence).toEqual([]);
    expect(go.answer).toBe("no");
    expect(overview.dismissed).toEqual([]);
  });

  it("saves a reordering, which later analyses keep", async () => {
    const store = createGapStore({ db });
    expect(await store.move(setId, "d-go", "top")).toBe(true);
    expect(await store.move(setId, "d-ab", "up")).toBe(true);
    expect((await store.overview(setId)).active.map((g) => g.name)).toEqual(["GO", "AB", "K8S"]);
    expect(await store.move(setId, "d-go", "up")).toBe(false);
    expect(await store.move(setId, "d-python", "down")).toBe(false);

    // A later analysis adds a skill with no user order: it slots in by rank.
    await db
      .insert(skills)
      .values({ id: "sql", key: "sql", canonicalName: "SQL", category: "tool" });
    await db.insert(skillDemands).values(demand("sql", 2, "missing"));
    expect((await store.overview(setId)).active.map((g) => g.name)).toEqual([
      "GO",
      "AB",
      "SQL",
      "K8S",
    ]);
  });

  it("dismisses and restores gaps", async () => {
    const store = createGapStore({ db });
    expect(await store.setDismissed(setId, "d-k8s", true)).toBe(true);
    let overview = await store.overview(setId);
    expect(overview.active.map((g) => g.name)).toEqual(["AB", "GO"]);
    expect(overview.dismissed.map((g) => g.name)).toEqual(["K8S"]);
    // Dismissed gaps don't take part in reordering.
    expect(await store.move(setId, "d-k8s", "top")).toBe(false);

    expect(await store.setDismissed(setId, "d-k8s", false)).toBe(true);
    overview = await store.overview(setId);
    expect(overview.active.map((g) => g.name)).toEqual(["K8S", "AB", "GO"]);
    expect(await store.setDismissed("other-set", "d-k8s", true)).toBe(false);
  });
});
