import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "@/db/client";
import { bullets, gapAnswers, resumes, skillDemands, skills } from "@/db/schema";
import { createLibrary } from "@/lib/library/documents";
import { createResumeStore } from "@/lib/resume/store";

import { interviewBaseline, overusedPhrases, scoreTargetSet } from "./score";
import { createTargetSetStore } from "./store";

let dataDir: string;
let db: Db;
let setId: string;
let resumeId: string;

async function addSkill(
  id: string,
  name: string,
  demandScore: number,
  terms: string[],
  category: "hard_skill" | "tool" | "certification" = "hard_skill",
) {
  await db.insert(skills).values({ id, key: id, canonicalName: name, category });
  await db.insert(skillDemands).values({
    id: `d-${id}`,
    targetSetId: setId,
    skillId: id,
    jdCount: 1,
    requiredCount: 1,
    demandScore,
    mustDo: true,
    rank: 1,
    coverage: "missing",
    terms,
  });
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "score-test-"));
  db = await openDb(":memory:");
  const library = createLibrary({ db, dataDir });
  const doc = await library.add({ kind: "resume", text: "Jordan Rivera" });
  resumeId = await createResumeStore({ db }).create(doc, {
    sections: {
      contact: { name: null, email: null, phone: null, location: null, links: [] },
      summary: null,
      skills: ["Languages: Python"],
      education: [],
      certifications: ["First Aid"],
      other: [],
    },
    roles: [
      {
        employer: "Acme",
        title: "Analyst",
        location: null,
        startDate: "2021",
        endDate: null,
        bullets: ["Built reports"],
      },
    ],
  });
  setId = await createTargetSetStore({ db }).create({ name: "Set", resumeId });
  await addSkill("python", "Python", 4, ["Python"], "tool");
  await addSkill("ab", "A/B testing", 3, ["A/B testing", "A/B tests"]);
  await addSkill("k8s", "Kubernetes", 2, ["Kubernetes"], "tool");
  await addSkill("cka", "CKA", 1, ["CKA"], "certification");
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** What the interview writes: a generated bullet, an added skill, an added certification. */
async function interviewChanges() {
  const resume = (await createResumeStore({ db }).get(resumeId))!;
  await db.insert(bullets).values({
    id: "b-gen",
    roleId: resume.roles[0].id,
    position: 1,
    text: "Designed A/B tests for checkout",
    source: "generated",
    status: "accepted",
  });
  await db
    .update(resumes)
    .set({
      sections: {
        ...resume.sections,
        skills: [...resume.sections.skills, "Additional skills: Kubernetes"],
        certifications: [...resume.sections.certifications, "CKA"],
      },
    })
    .where(eq(resumes.id, resumeId));
  await db.insert(gapAnswers).values([
    { id: "a-ab", skillDemandId: "d-ab", response: "yes", completedAt: new Date() },
    { id: "a-cka", skillDemandId: "d-cka", response: "yes", completedAt: new Date() },
  ]);
}

describe("scoreTargetSet", () => {
  it("scores the resume before and after the interview's additions", async () => {
    // Nothing added yet: before and after match (Python only, 4 of 10).
    expect(await scoreTargetSet(db, setId, resumeId)).toMatchObject({
      before: 40,
      after: 40,
      skillCount: 4,
      changes: [],
    });

    await interviewChanges();
    const score = await scoreTargetSet(db, setId, resumeId);
    expect(score).toMatchObject({
      before: 40,
      after: 100,
      overused: [],
      addedCertifications: ["CKA"],
    });
    expect(score.changes.map((c) => [c.name, c.before, c.after])).toEqual([
      ["A/B testing", "missing", "covered"],
      ["Kubernetes", "missing", "covered"],
      ["CKA", "missing", "covered"],
    ]);
  });

  it("keeps the user's edits to original lines on both sides", async () => {
    await db.update(bullets).set({ text: "Built Kubernetes reports" });
    const score = await scoreTargetSet(db, setId, resumeId);
    expect(score.before).toBe(60);
    expect(score.after).toBe(60);
  });
});

describe("interviewBaseline", () => {
  it("drops generated bullets, the added skills line, and added certifications only", async () => {
    await interviewChanges();
    const resume = (await createResumeStore({ db }).get(resumeId))!;
    const baseline = interviewBaseline(resume, ["cka"]);
    expect(baseline.sections.skills).toEqual(["Languages: Python"]);
    expect(baseline.sections.certifications).toEqual(["First Aid"]);
    expect(baseline.roles[0].bullets.map((b) => b.text)).toEqual(["Built reports"]);
  });
});

describe("overusedPhrases", () => {
  it("flags interview wordings used more than 3 times, not the resume's own", async () => {
    const resume = (await createResumeStore({ db }).get(resumeId))!;
    const line = (text: string, source: "original" | "generated") =>
      ({ text, source, status: "accepted" }) as (typeof resume.roles)[0]["bullets"][0];
    const stuffed = {
      ...resume,
      roles: [
        {
          ...resume.roles[0],
          bullets: [
            line("Python reports", "original"),
            line("Python models", "original"),
            line("Python jobs", "original"),
            line("Python pipelines", "original"),
            line("Ran A/B tests", "generated"),
            line("Planned A/B tests", "generated"),
            line("Scaled A/B tests", "generated"),
            line("Reviewed A/B tests", "generated"),
          ],
        },
      ],
    };
    expect(overusedPhrases(stuffed, ["Python", "A/B tests", "a/b tests"])).toEqual([
      { phrase: "A/B tests", uses: 4 },
    ]);
  });
});
