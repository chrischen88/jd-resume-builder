import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/db/client";
import { jobKeywords, resumes, skillDemands, skills, targetSets } from "@/db/schema";
import { createLibrary } from "@/lib/library/documents";
import { createResumeStore } from "@/lib/resume/store";
import { createTargetSetStore } from "@/lib/target-sets/store";

import { runStep, type InterviewAi, type StepEvent } from "./steps";
import { ADDED_SKILLS_LABEL, addSkillToSections, createInterviewStore } from "./store";

let dataDir: string;
let db: Db;
let setId: string;
let resumeId: string;

const EVIDENCE = {
  situation: "Checkout redesign",
  action: "Ran A/B tests on checkout changes",
  tools: ["Optimizely"],
  scale: null,
  result: "Lower drop-off",
  metric: null,
};

/** Asks the given questions in turn, then says it has enough. */
function fakeAi(questions: (string | null)[] = ["What did you test?", "What came of it?"]) {
  const queue = [...questions];
  const ai: InterviewAi = {
    askFollowUp: vi.fn(async () => ({ question: queue.length ? queue.shift()! : null })),
    writeBullet: vi.fn(async () => ({
      variants: [
        { text: "Ran A/B tests on checkout changes with Optimizely", claims: ["Ran A/B tests"] },
        { text: "Tested checkout changes in A/B tests, lifting conversion 4%", claims: [] },
      ],
      evidence: EVIDENCE,
      promptVersion: "1.0.0",
    })),
    checkClaims: vi.fn(async (bullet: string) => ({
      claims: ["claim"],
      unverified: bullet.includes("4%") ? ["The number 4 isn't in your answers"] : [],
    })),
  };
  return ai;
}

async function addGap(id: string, name: string, rank: number, category = "hard_skill") {
  await db.insert(skills).values({
    id,
    key: id,
    canonicalName: name,
    category: category as "hard_skill",
  });
  await db.insert(skillDemands).values({
    id: `d-${id}`,
    targetSetId: setId,
    skillId: id,
    jdCount: 2,
    requiredCount: 1,
    demandScore: 10 - rank,
    mustDo: true,
    rank,
    coverage: "missing",
  });
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "interview-test-"));
  db = await openDb(":memory:");
  const library = createLibrary({ db, dataDir });
  const resumeDoc = await library.add({ kind: "resume", text: "Jordan Rivera" });
  resumeId = await createResumeStore({ db }).create(resumeDoc, {
    sections: {
      contact: { name: null, email: null, phone: null, location: null, links: [] },
      summary: null,
      skills: ["Languages: Python, SQL"],
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
        endDate: "Present",
        bullets: ["Built reports"],
      },
    ],
  });
  const store = createTargetSetStore({ db });
  setId = await store.create({ name: "Set", resumeId });
  const docs = await Promise.all(
    [1, 2].map((n) => library.add({ kind: "jd", title: `JD ${n}`, text: `JD ${n}` })),
  );
  await store.addJobs(setId, docs);
  const jobId = (await store.get(setId))!.jobs[0].id;
  await addGap("ab", "A/B testing", 1);
  await addGap("k8s", "Kubernetes", 2, "tool");
  await db.insert(jobKeywords).values({
    id: "m1",
    jobId,
    skillId: "ab",
    jdPhrase: "A/B tests",
    evidenceQuote: "Design A/B tests.",
    importance: "required",
  });
  await db.update(targetSets).set({ status: "ready" });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("addSkillToSections", () => {
  const sections = {
    contact: { name: null, email: null, phone: null, location: null, links: [] },
    summary: null,
    skills: ["Languages: Python, SQL"],
    education: [],
    certifications: [],
    other: [],
  };

  it("adds to an 'Additional skills' line, once", () => {
    const once = addSkillToSections(sections, "Kubernetes");
    expect(once.skills).toEqual(["Languages: Python, SQL", `${ADDED_SKILLS_LABEL}: Kubernetes`]);
    const twice = addSkillToSections(once, "Go");
    expect(twice.skills[1]).toBe(`${ADDED_SKILLS_LABEL}: Kubernetes, Go`);
    expect(addSkillToSections(twice, "SQL")).toBe(twice);
  });
});

describe("gap interview", () => {
  it("walks a Yes from the question to an accepted bullet", async () => {
    const store = createInterviewStore({ db });
    const ai = fakeAi();
    const events: StepEvent[] = [];

    let view = await store.view(setId);
    expect(view).toMatchObject({ total: 2, done: 0, position: 1, learningCount: 0 });
    expect(view.current).toMatchObject({ stage: "ask", gap: { name: "A/B testing" } });

    // One role on the resume: it's picked automatically.
    await store.answer(setId, "d-ab", "yes");
    expect((await store.view(setId)).current!.stage).toBe("needs_question");

    await runStep(store, ai, setId, "d-ab", (e) => events.push(e));
    expect(events.at(-1)).toEqual({ type: "question", question: "What did you test?" });
    await store.answerFollowUp(setId, "d-ab", "Checkout changes, in Optimizely");
    await runStep(store, ai, setId, "d-ab", () => {});
    await store.answerFollowUp(setId, "d-ab", "Drop-off went down");

    // The model has enough after two answers: draft and claim-check.
    await runStep(store, ai, setId, "d-ab", (e) => events.push(e));
    expect(events.at(-1)).toEqual({ type: "draft" });
    view = await store.view(setId);
    expect(view.current!.stage).toBe("draft");
    const [first, second] = view.current!.answer!.draft!.variants;
    expect(first).toMatchObject({ keywordsHit: ["A/B testing"], unverifiedClaims: [] });
    expect(second.unverifiedClaims).toEqual(["The number 4 isn't in your answers"]);
    // The writer got the JD phrase and past answers; the checker got the answers.
    expect(vi.mocked(ai.writeBullet).mock.calls[0][0]).toMatchObject({
      phrase: "A/B tests",
      currentRole: true,
      otherSkills: ["Kubernetes"],
    });
    expect(vi.mocked(ai.checkClaims).mock.calls[0][2]).toContain(
      "What did you test? Checkout changes, in Optimizely",
    );

    const evidence = await store.accept(setId, "d-ab", 0);
    expect(evidence).toMatchObject({ action: EVIDENCE.action, tools: ["Optimizely"] });

    const resume = (await createResumeStore({ db }).get(resumeId))!;
    expect(resume.roles[0].bullets.map((b) => [b.text, b.source, b.status])).toEqual([
      ["Built reports", "original", "accepted"],
      ["Ran A/B tests on checkout changes with Optimizely", "generated", "accepted"],
    ]);
    expect(resume.roles[0].bullets[1].evidenceId).toBe(evidence.id);
    expect(resume.sections.skills).toContain(`${ADDED_SKILLS_LABEL}: A/B testing`);
    expect((await db.query.evidenceSkills.findMany())).toEqual([
      { evidenceId: evidence.id, skillId: "ab" },
    ]);
    expect((await db.query.targetSets.findFirst())!.status).toBe("draft");

    view = await store.view(setId);
    expect(view).toMatchObject({ done: 1, position: 2 });
    expect(view.current!.gap.name).toBe("Kubernetes");
  });

  it("adds a No to the learning plan and can undo it", async () => {
    const store = createInterviewStore({ db });
    await store.answer(setId, "d-ab", "no");
    let view = await store.view(setId);
    expect(view).toMatchObject({ done: 1, learningCount: 1 });
    expect(await db.query.learningItems.findFirst()).toMatchObject({
      skillId: "ab",
      keywords: ["A/B tests"],
      jdCount: 2,
    });
    await expect(store.answer(setId, "d-ab", "yes")).rejects.toMatchObject({ code: "wrong_stage" });

    await store.undo(setId, "d-ab");
    view = await store.view(setId);
    expect(view).toMatchObject({ done: 0, learningCount: 0, current: { stage: "ask" } });
  });

  it("writes a Somewhat honestly: learning item, bullet, but no skills-section entry", async () => {
    const store = createInterviewStore({ db });
    const ai = fakeAi([null, null]);
    await store.answer(setId, "d-ab", "somewhat");
    expect((await store.view(setId)).learningCount).toBe(1);

    // The model stopped early: fallback questions keep the minimum of two.
    await runStep(store, ai, setId, "d-ab", () => {});
    let followUps = (await store.view(setId)).current!.answer!.followUps;
    expect(followUps[0].question).toMatch(/closest you've come to A\/B testing/);
    await store.answerFollowUp(setId, "d-ab", "I supported a colleague's tests");
    await runStep(store, ai, setId, "d-ab", () => {});
    await store.answerFollowUp(setId, "d-ab", "");
    followUps = (await store.view(setId)).current!.answer!.followUps;
    expect(followUps.map((f) => f.answer)).toEqual(["I supported a colleague's tests", ""]);

    await runStep(store, ai, setId, "d-ab", () => {});
    await store.accept(setId, "d-ab", 0);
    const resume = (await createResumeStore({ db }).get(resumeId))!;
    expect(resume.sections.skills).toEqual(["Languages: Python, SQL"]);
    await expect(store.undo(setId, "d-ab")).rejects.toMatchObject({ code: "wrong_stage" });
  });

  it("adds a certification on Yes, with no questions", async () => {
    const store = createInterviewStore({ db });
    await addGap("aws", "AWS Certified Developer", 0, "certification");
    await expect(store.answer(setId, "d-aws", "somewhat")).rejects.toMatchObject({
      code: "bad_input",
    });
    await store.answer(setId, "d-aws", "yes");
    const resume = await db.query.resumes.findFirst({ where: eq(resumes.id, resumeId) });
    expect(resume!.sections.certifications).toEqual(["AWS Certified Developer"]);
    expect((await store.view(setId)).current!.gap.name).toBe("A/B testing");
  });

  it("asks which role when there are several, and only accepts roles on the resume", async () => {
    const store = createInterviewStore({ db });
    await createResumeStore({ db }).addRole(
      resumeId,
      { employer: "Beta", title: "Intern", location: null, startDate: null, endDate: "2020" },
      [],
    );
    await store.answer(setId, "d-ab", "yes");
    const view = await store.view(setId);
    expect(view.current!.stage).toBe("role");
    expect(view.roles.map((r) => r.employer)).toEqual(["Acme", "Beta"]);
    await expect(store.chooseRole(setId, "d-ab", "not-a-role")).rejects.toMatchObject({
      code: "bad_input",
    });
    await store.chooseRole(setId, "d-ab", view.roles[1].id);
    expect((await store.view(setId)).current!.stage).toBe("needs_question");
  });

  it("skips a gap to the end of the order", async () => {
    const store = createInterviewStore({ db });
    await store.skip(setId, "d-ab");
    const view = await store.view(setId);
    expect(view.current!.gap.name).toBe("Kubernetes");
    const demand = await db.query.skillDemands.findFirst({ where: eq(skillDemands.id, "d-ab") });
    expect(demand!.userRank).toBe(3);
  });

  it("regenerates drafts and keeps unverified claims on accepted bullets", async () => {
    const store = createInterviewStore({ db });
    const ai = fakeAi([]);
    await store.answer(setId, "d-ab", "yes");
    for (let i = 0; i < 2; i++) {
      await runStep(store, ai, setId, "d-ab", () => {});
      await store.answerFollowUp(setId, "d-ab", `answer ${i}`);
    }
    await runStep(store, ai, setId, "d-ab", () => {});
    // Nothing to do without regenerate; with it, the drafts are rewritten.
    await runStep(store, ai, setId, "d-ab", () => {});
    expect(ai.writeBullet).toHaveBeenCalledTimes(1);
    await runStep(store, ai, setId, "d-ab", () => {}, { regenerate: true });
    expect(ai.writeBullet).toHaveBeenCalledTimes(2);

    await store.accept(setId, "d-ab", 1);
    const [blocker] = await store.exportBlockers(resumeId);
    expect(blocker.unverified).toEqual(["The number 4 isn't in your answers"]);
    expect(await store.confirmBulletClaim(resumeId, blocker.id, "made up")).toBe(false);
    expect(await store.confirmBulletClaim(resumeId, blocker.id, blocker.unverified[0])).toBe(true);
    expect(await store.exportBlockers(resumeId)).toEqual([]);
  });

  it("confirms a claim on a draft and records it with the answers", async () => {
    const store = createInterviewStore({ db });
    const ai = fakeAi([]);
    await store.answer(setId, "d-ab", "yes");
    for (let i = 0; i < 2; i++) {
      await runStep(store, ai, setId, "d-ab", () => {});
      await store.answerFollowUp(setId, "d-ab", `answer ${i}`);
    }
    await runStep(store, ai, setId, "d-ab", () => {});
    await store.confirmClaim(setId, "d-ab", 1, "The number 4 isn't in your answers");
    const answer = (await store.view(setId)).current!.answer!;
    expect(answer.draft!.variants[1].unverifiedClaims).toEqual([]);
    expect(answer.followUps.at(-1)).toEqual({
      question: "Confirmed in review",
      answer: "The number 4 isn't in your answers",
    });
  });

  it("treats a repeated question as enough once two are answered", async () => {
    const store = createInterviewStore({ db });
    const ai = fakeAi(["What did you test?", "What came of it?", "What came of it, then?"]);
    await store.answer(setId, "d-ab", "yes");
    for (let i = 0; i < 2; i++) {
      await runStep(store, ai, setId, "d-ab", () => {});
      await store.answerFollowUp(setId, "d-ab", `answer ${i}`);
    }
    await runStep(store, ai, setId, "d-ab", () => {});
    expect((await store.view(setId)).current!.stage).toBe("draft");
    expect(ai.writeBullet).toHaveBeenCalledTimes(1);
  });
});
