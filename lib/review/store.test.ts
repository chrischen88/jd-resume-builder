import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "@/db/client";
import { bullets, targetSets } from "@/db/schema";
import { createLibrary } from "@/lib/library/documents";
import { createResumeStore } from "@/lib/resume/store";
import { createTargetSetStore } from "@/lib/target-sets/store";

import { createReviewStore, ReviewError } from "./store";

let dataDir: string;
let db: Db;
let resumeId: string;
let setId: string;
let originalId: string;
const GENERATED = "b0000000-0000-4000-8000-000000000001";

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "review-test-"));
  db = await openDb(":memory:");
  const library = createLibrary({ db, dataDir });
  const doc = await library.add({ kind: "resume", text: "Jordan Rivera" });
  const resumes = createResumeStore({ db });
  resumeId = await resumes.create(doc, {
    sections: {
      contact: { name: null, email: null, phone: null, location: null, links: [] },
      summary: "Analyst.",
      skills: ["Languages: Python", "Additional skills: A/B testing"],
      education: [],
      certifications: [],
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
  const role = (await resumes.get(resumeId))!.roles[0];
  originalId = role.bullets[0].id;
  await db.insert(bullets).values({
    id: GENERATED,
    roleId: role.id,
    position: 1,
    text: "Ran A/B tests with Optimizely",
    source: "generated",
    status: "accepted",
    keywordsHit: ["A/B tests", "Optimizely"],
    unverifiedClaims: ["Used Optimizely"],
  });
  setId = await createTargetSetStore({ db }).create({ name: "Set", resumeId });
  await db.update(targetSets).set({ status: "ready" });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const setStatus = async () =>
  (await db.query.targetSets.findFirst({ where: eq(targetSets.id, setId) }))!.status;
const bullet = async (id: string) =>
  db.query.bullets.findFirst({ where: eq(bullets.id, id) });

describe("review store", () => {
  it("edits a bullet, keeps only keyword tags still in it, and marks the set out of date", async () => {
    const store = createReviewStore({ db });
    await store.editBullet(resumeId, GENERATED, "Ran A/B tests on checkout");
    expect(await bullet(GENERATED)).toMatchObject({
      text: "Ran A/B tests on checkout",
      keywordsHit: ["A/B tests"],
      // Still the user's to confirm or clear.
      unverifiedClaims: ["Used Optimizely"],
    });
    expect(await setStatus()).toBe("draft");
  });

  it("clears a claim the user resolved", async () => {
    await createReviewStore({ db }).resolveClaim(resumeId, GENERATED, "Used Optimizely");
    expect((await bullet(GENERATED))!.unverifiedClaims).toEqual([]);
  });

  it("removes interview bullets only", async () => {
    const store = createReviewStore({ db });
    await expect(store.removeGeneratedBullet(resumeId, originalId)).rejects.toBeInstanceOf(
      ReviewError,
    );
    await store.removeGeneratedBullet(resumeId, GENERATED);
    expect(await bullet(GENERATED)).toBeUndefined();
  });

  it("refuses bullets from another resume", async () => {
    const other = "00000000-0000-4000-8000-000000000000";
    await expect(
      createReviewStore({ db }).editBullet(other, GENERATED, "x"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("edits the summary and skills lines; empty removes them", async () => {
    const store = createReviewStore({ db });
    await store.editSummary(resumeId, "");
    await store.editSkillLine(resumeId, 0, "Languages: Python", "Languages: Python, SQL");
    await store.editSkillLine(resumeId, 1, "Additional skills: A/B testing", "");
    const { sections } = (await createResumeStore({ db }).get(resumeId))!;
    expect(sections.summary).toBeNull();
    expect(sections.skills).toEqual(["Languages: Python, SQL"]);
  });

  it("refuses a skills edit from a stale page", async () => {
    await expect(
      createReviewStore({ db }).editSkillLine(resumeId, 0, "Languages: Go", "x"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
