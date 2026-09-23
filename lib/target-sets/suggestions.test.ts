import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/db/client";
import { bullets, jobKeywords, skillDemands, skills, targetSets } from "@/db/schema";
import { createLibrary } from "@/lib/library/documents";
import { createResumeStore } from "@/lib/resume/store";

import { createTargetSetStore } from "./store";
import { createSuggestionStore, type Reworder } from "./suggestions";

const BULLET = "Queried and analyzed complex datasets using SQL";
const REWORDED = "Applied analytical skills to query and analyze complex datasets using SQL";

let dataDir: string;
let db: Db;
let setId: string;
let bulletId: string;

/** Rewords every candidate with REWORDED. */
function reworder(): Reworder & ReturnType<typeof vi.fn> {
  return vi.fn<Reworder>(async (candidates) => ({
    rewordings: candidates.map((c) => ({ ...c, suggestion: REWORDED })),
    promptVersion: "1.0.0",
  })) as Reworder & ReturnType<typeof vi.fn>;
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "suggestions-test-"));
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
    roles: [
      {
        employer: "Acme",
        title: "Analyst",
        location: null,
        startDate: null,
        endDate: null,
        bullets: [BULLET],
      },
    ],
  });
  bulletId = (await db.query.bullets.findMany())[0].id;

  const store = createTargetSetStore({ db });
  setId = await store.create({ name: "Set", resumeId });
  const docs = await Promise.all(
    ["JD one", "JD two"].map((text) => library.add({ kind: "jd", text })),
  );
  await store.addJobs(setId, docs);
  const jobIds = (await store.get(setId))!.jobs.map((j) => j.id);

  await db.insert(skills).values({
    id: "s-analytics",
    key: "analytical skills",
    canonicalName: "Analytical skills",
    category: "soft_skill",
  });
  await db.insert(skillDemands).values({
    id: "d1",
    targetSetId: setId,
    skillId: "s-analytics",
    jdCount: 2,
    requiredCount: 1,
    demandScore: 4,
    mustDo: true,
    rank: 1,
    coverage: "weak",
    coverageEvidence: [BULLET],
    terms: ["Analytical skills"],
  });
  // "analytical skills" is the phrasing two JDs use; one says "data analysis skills".
  await db.insert(jobKeywords).values(
    [
      [jobIds[0], "analytical skills"],
      [jobIds[1], "analytical skills"],
      [jobIds[1], "data analysis skills"],
    ].map(([jobId, jdPhrase], i) => ({
      id: `k${i}`,
      jobId,
      skillId: "s-analytics",
      jdPhrase,
      evidenceQuote: jdPhrase,
      importance: "required" as const,
    })),
  );
  await db.update(targetSets).set({ status: "ready" }).where(eq(targetSets.id, setId));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("suggestion store", () => {
  it("asks for rewordings of the set's candidates once, and lists them", async () => {
    const store = createSuggestionStore({ db });
    const reword = reworder();

    expect(await store.generate(setId, reword)).toEqual({ candidates: 1, added: 1 });
    expect(reword.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        bulletId,
        phrase: "analytical skills",
        skillName: "Analytical skills",
      }),
    ]);
    expect(await store.list(setId)).toEqual([
      expect.objectContaining({
        skillName: "Analytical skills",
        originalText: BULLET,
        suggestedText: REWORDED,
        employer: "Acme",
        roleTitle: "Analyst",
      }),
    ]);

    // Already suggested for this bullet text: no second call.
    expect(await store.generate(setId, reword)).toEqual({ candidates: 0, added: 0 });
    expect(reword).toHaveBeenCalledTimes(1);
    expect(await store.generate("missing", reword)).toBeUndefined();
  });

  it("applies a suggestion only when accepted, and marks the set out of date", async () => {
    const store = createSuggestionStore({ db });
    await store.generate(setId, reworder());
    const [suggestion] = await store.list(setId);
    expect((await db.query.bullets.findFirst())!.text).toBe(BULLET);

    expect(await store.accept(suggestion.id)).toBe("accepted");
    expect((await db.query.bullets.findFirst())!.text).toBe(REWORDED);
    expect((await db.query.targetSets.findFirst())!.status).toBe("draft");
    expect(await store.list(setId)).toEqual([]);
    expect(await store.accept(suggestion.id)).toBe("not_found");
  });

  it("won't apply a suggestion to a bullet edited since, and suggests again", async () => {
    const store = createSuggestionStore({ db });
    const reword = reworder();
    await store.generate(setId, reword);
    const [suggestion] = await store.list(setId);
    const edited = "Queried and analyzed complex datasets using SQL and dbt";
    await db.update(bullets).set({ text: edited }).where(eq(bullets.id, bulletId));
    await db.update(skillDemands).set({ coverageEvidence: [edited] });

    expect(await store.list(setId)).toEqual([]);
    expect(await store.accept(suggestion.id)).toBe("stale");
    expect((await db.query.bullets.findFirst())!.text).toBe(edited);

    expect(await store.generate(setId, reword)).toEqual({ candidates: 1, added: 1 });
    expect(await store.list(setId)).toEqual([expect.objectContaining({ originalText: edited })]);
    expect(await db.query.rewordSuggestions.findMany()).toHaveLength(1);
  });

  it("dismisses a suggestion without touching the bullet", async () => {
    const store = createSuggestionStore({ db });
    const reword = reworder();
    await store.generate(setId, reword);
    const [suggestion] = await store.list(setId);

    expect(await store.dismiss(suggestion.id)).toBe(true);
    expect(await store.dismiss(suggestion.id)).toBe(false);
    expect(await store.list(setId)).toEqual([]);
    expect((await db.query.bullets.findFirst())!.text).toBe(BULLET);
    // Dismissed stays dismissed.
    await store.generate(setId, reword);
    expect(reword).toHaveBeenCalledTimes(1);
  });
});
