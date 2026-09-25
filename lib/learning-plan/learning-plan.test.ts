import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/db/client";
import { jobKeywords, skillDemands, skills } from "@/db/schema";
import { createInterviewStore } from "@/lib/interview/store";
import { createLibrary } from "@/lib/library/documents";
import { createResumeStore } from "@/lib/resume/store";
import { createTargetSetStore } from "@/lib/target-sets/store";

import { fillLearningPlans, type PlanLearning } from "./generate";
import { createLearningPlanStore } from "./store";

let dataDir: string;
let db: Db;
let setId: string;

async function addSkill(
  id: string,
  name: string,
  rank: number,
  coverage: "covered" | "missing",
) {
  await db.insert(skills).values({ id, key: id, canonicalName: name, category: "hard_skill" });
  await db.insert(skillDemands).values({
    id: `d-${id}`,
    targetSetId: setId,
    skillId: id,
    jdCount: 2,
    requiredCount: 1,
    demandScore: 10 - rank,
    mustDo: true,
    rank,
    coverage,
  });
}

const PLAN = {
  meaning: "Running experiments.",
  relatedSkills: ["Statistics"],
  resources: [{ kind: "course", description: "An intro statistics course." }],
  promptVersion: "1.0.0",
};

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "learning-plan-test-"));
  db = await openDb(":memory:");
  const library = createLibrary({ db, dataDir });
  const resumeDoc = await library.add({ kind: "resume", text: "Jordan Rivera" });
  const resumeId = await createResumeStore({ db }).create(resumeDoc, {
    sections: {
      contact: { name: null, email: null, phone: null, location: null, links: [] },
      summary: null,
      skills: ["SQL"],
      education: [],
      certifications: [],
      other: [],
    },
    roles: [],
  });
  const store = createTargetSetStore({ db });
  setId = await store.create({ name: "Set", resumeId });
  const docs = await Promise.all(
    [1, 2, 3].map((n) => library.add({ kind: "jd", title: `JD ${n}`, text: `JD ${n}` })),
  );
  await store.addJobs(setId, docs);
  const [job1, job2] = (await store.get(setId))!.jobs;
  await addSkill("sql", "SQL", 1, "covered");
  await addSkill("ab", "A/B testing", 2, "missing");
  await addSkill("k8s", "Kubernetes", 3, "missing");
  await db.insert(jobKeywords).values([
    {
      id: "m1",
      jobId: job1.id,
      skillId: "ab",
      jdPhrase: "experimentation",
      evidenceQuote: "Experimentation a plus.",
      importance: "mentioned",
    },
    {
      id: "m2",
      jobId: job2.id,
      skillId: "ab",
      jdPhrase: "A/B tests",
      evidenceQuote: "Design A/B tests.",
      importance: "required",
    },
  ]);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("learning plan", () => {
  it("fills the items No and Somewhat created, with the set's context", async () => {
    const interview = createInterviewStore({ db });
    await interview.answer(setId, "d-ab", "somewhat");
    await interview.answer(setId, "d-k8s", "no");
    const store = createLearningPlanStore({ db });
    expect(await store.pending(setId)).toHaveLength(2);

    const plan = vi.fn<PlanLearning>(async () => PLAN);
    expect(await fillLearningPlans(store, plan, setId)).toBe(2);

    const ctxFor = (skill: string) => plan.mock.calls.find(([c]) => c.skill === skill)![0];
    expect(ctxFor("A/B testing")).toEqual({
      skill: "A/B testing",
      category: "hard_skill",
      response: "somewhat",
      phrases: expect.arrayContaining(["experimentation", "A/B tests"]),
      jdSentences: ["Design A/B tests.", "Experimentation a plus."],
      jdCount: 2,
      jobCount: 3,
      nearbySkills: ["SQL"],
    });
    expect(ctxFor("Kubernetes")).toMatchObject({ response: "no" });
    expect(await db.query.learningItems.findMany()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meaning: "Running experiments.",
          relatedSkills: ["Statistics"],
          promptVersion: "1.0.0",
          status: "to_learn",
        }),
      ]),
    );
    expect(await store.pending(setId)).toEqual([]);
    // Nothing left to do: no more calls.
    expect(await fillLearningPlans(store, plan, setId)).toBe(0);
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it("leaves an item pending when the model call fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await createInterviewStore({ db }).answer(setId, "d-k8s", "no");
    const store = createLearningPlanStore({ db });
    const failing = vi.fn<PlanLearning>(async () => {
      throw new Error("boom");
    });
    expect(await fillLearningPlans(store, failing, setId)).toBe(0);
    expect(await store.pending(setId)).toHaveLength(1);
  });

  it("lists items with their set's job count and saves status changes", async () => {
    const interview = createInterviewStore({ db });
    await interview.answer(setId, "d-ab", "somewhat");
    await interview.answer(setId, "d-k8s", "no");
    const store = createLearningPlanStore({ db });
    await fillLearningPlans(store, async () => PLAN, setId);

    const items = await store.list({ targetSetId: setId });
    expect(items).toHaveLength(2);
    const ab = items.find((i) => i.name === "A/B testing")!;
    expect(ab).toMatchObject({
      jdCount: 2,
      jobCount: 3,
      targetSetName: "Set",
      keywords: expect.arrayContaining(["experimentation", "A/B tests"]),
      meaning: "Running experiments.",
      planned: true,
      status: "to_learn",
    });
    expect(await store.sets()).toEqual([{ id: setId, name: "Set" }]);
    expect(await store.list({ targetSetId: "00000000-0000-4000-8000-000000000000" })).toEqual([]);

    expect(await store.setStatus(ab.id, "learning")).toBe(true);
    expect((await store.list()).find((i) => i.id === ab.id)!.status).toBe("learning");
    expect(await store.setStatus("gone", "done")).toBe(false);
  });
});
