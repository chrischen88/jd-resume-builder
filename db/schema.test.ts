import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "./client";
import {
  bullets,
  documents,
  evidence,
  gapAnswers,
  jobKeywords,
  jobs,
  jobSkillScores,
  learningItems,
  LOCAL_PROFILE_ID,
  profile,
  resumes,
  roles,
  skillDemands,
  skills,
  targetSets,
  type ResumeSections,
} from "./schema";

const sections: ResumeSections = {
  contact: {
    name: "Jordan Rivera",
    email: null,
    phone: null,
    location: null,
    links: [],
  },
  summary: null,
  skills: ["Go | Python"],
  education: [],
  certifications: [],
  other: [],
};

let db: Db;

/** A resume with one role and bullet, a target set with one JD, and an answered gap. */
async function seed() {
  await db.insert(documents).values([
    {
      id: "doc-resume",
      kind: "resume",
      title: "Resume",
      text: "r",
      contentHash: "h1",
    },
    { id: "doc-jd", kind: "jd", title: "JD", text: "j", contentHash: "h2" },
  ]);
  await db.insert(resumes).values({
    id: "resume",
    documentId: "doc-resume",
    title: "Resume",
    sections,
  });
  await db.insert(roles).values({
    id: "role",
    resumeId: "resume",
    position: 0,
    employer: "Acme",
    title: "Engineer",
  });
  await db.insert(skills).values({
    id: "skill",
    key: "kafka",
    canonicalName: "Apache Kafka",
    category: "tool",
  });
  await db.insert(evidence).values({ id: "ev", roleId: "role", action: "Built a Kafka pipeline" });
  await db.insert(bullets).values([
    {
      id: "b-orig",
      roleId: "role",
      position: 0,
      text: "Built APIs.",
      source: "original",
      status: "accepted",
    },
    {
      id: "b-gen",
      roleId: "role",
      position: 1,
      text: "Built a Kafka pipeline.",
      source: "generated",
      status: "draft",
      evidenceId: "ev",
    },
  ]);
  await db.insert(targetSets).values({ id: "set", name: "ML roles", resumeId: "resume" });
  await db.insert(jobs).values({
    id: "job",
    targetSetId: "set",
    documentId: "doc-jd",
    title: "ML Engineer",
  });
  await db.insert(jobKeywords).values({
    id: "kw",
    jobId: "job",
    skillId: "skill",
    jdPhrase: "Kafka",
    evidenceQuote: "Kafka.",
    importance: "required",
  });
  await db.insert(jobSkillScores).values({
    jobId: "job",
    skillId: "skill",
    importance: "required",
    frequency: 1,
    inTitle: false,
    inFirstThird: true,
    score: 4.2,
  });
  await db.insert(skillDemands).values({
    id: "demand",
    targetSetId: "set",
    skillId: "skill",
    jdCount: 1,
    requiredCount: 1,
    demandScore: 4.2,
    mustDo: true,
    rank: 1,
    coverage: "missing",
    proofBulletId: "b-orig",
  });
  await db.insert(gapAnswers).values({
    id: "answer",
    skillDemandId: "demand",
    response: "yes",
    evidenceId: "ev",
  });
  await db
    .insert(learningItems)
    .values({ id: "learn", skillId: "skill", targetSetId: "set", jdCount: 1 });
}

const count: Db["$count"] = (...args) => db.$count(...args);

beforeEach(async () => {
  db = await openDb(":memory:");
});

describe("schema", () => {
  it("fills defaults for json lists and statuses", async () => {
    await seed();
    const [row] = await db.select().from(bullets).where(eq(bullets.id, "b-orig"));
    expect(row).toMatchObject({
      keywordsHit: [],
      claims: [],
      unverifiedClaims: [],
    });
    const [set] = await db.select().from(targetSets);
    expect(set.status).toBe("draft");
    const [item] = await db.select().from(learningItems);
    expect(item).toMatchObject({
      status: "to_learn",
      resources: [],
      keywords: [],
    });
  });

  it("creates the single local profile with default preferences", async () => {
    await db.insert(profile).values({ name: "Jordan" });
    const [row] = await db.select().from(profile);
    expect(row).toMatchObject({
      id: LOCAL_PROFILE_ID,
      preferences: { pageLength: null, tone: null },
      links: [],
    });
  });

  it("deleting a target set removes its analysis and answers but keeps evidence and learning items", async () => {
    await seed();
    await db.delete(targetSets).where(eq(targetSets.id, "set"));
    expect(await count(jobs)).toBe(0);
    expect(await count(jobKeywords)).toBe(0);
    expect(await count(jobSkillScores)).toBe(0);
    expect(await count(skillDemands)).toBe(0);
    expect(await count(gapAnswers)).toBe(0);
    expect(await count(evidence)).toBe(1);
    const [item] = await db.select().from(learningItems);
    expect(item.targetSetId).toBeNull();
  });

  it("deleting a resume removes its roles, bullets, and target sets; evidence loses its role", async () => {
    await seed();
    await db.delete(resumes).where(eq(resumes.id, "resume"));
    expect(await count(roles)).toBe(0);
    expect(await count(bullets)).toBe(0);
    expect(await count(targetSets)).toBe(0);
    const [ev] = await db.select().from(evidence);
    expect(ev.roleId).toBeNull();
  });

  it("deleting a library JD removes it from target sets; deleting a resume document keeps the resume", async () => {
    await seed();
    await db.delete(documents).where(eq(documents.id, "doc-jd"));
    expect(await count(jobs)).toBe(0);
    expect(await count(targetSets)).toBe(1);

    await db.delete(documents).where(eq(documents.id, "doc-resume"));
    const [resume] = await db.select().from(resumes);
    expect(resume.documentId).toBeNull();
  });

  it("deleting a bullet clears it as a proof bullet", async () => {
    await seed();
    await db.delete(bullets).where(eq(bullets.id, "b-orig"));
    const [demand] = await db.select().from(skillDemands);
    expect(demand.proofBulletId).toBeNull();
  });

  it("refuses to delete a skill that is still referenced", async () => {
    await seed();
    await expect(db.delete(skills).where(eq(skills.id, "skill"))).rejects.toThrow();
  });

  it("allows one answer per gap and one learning item per skill", async () => {
    await seed();
    await expect(
      db.insert(gapAnswers).values({ id: "answer2", skillDemandId: "demand", response: "no" }),
    ).rejects.toThrow();
    await expect(
      db.insert(learningItems).values({ id: "learn2", skillId: "skill", jdCount: 2 }),
    ).rejects.toThrow();
  });
});
