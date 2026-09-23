import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/db/client";
import { gapAnswers, jobs, skillDemands, skills } from "@/db/schema";
import { AiOutputError } from "@/lib/ai/client";
import type { ExtractedKeyword } from "@/lib/analysis/types";
import { createLibrary, type Library } from "@/lib/library/documents";
import type { CachedExtraction } from "@/lib/library/extractions";
import { createResumeStore } from "@/lib/resume/store";
import type { KeywordVectorStore } from "@/lib/vector/job-keywords";

import { AnalysisError, analyzeTargetSet, type AnalyzeDeps } from "./analyze";
import { createTargetSetStore, TargetSetError, type TargetSetStore } from "./store";

let dataDir: string;
let db: Db;
let library: Library;
let store: TargetSetStore;
let setId: string;

const PYTHON_QUOTE = "You will build and deploy ML systems in Python for our fraud and risk products.";
const K8S_QUOTE = "- Kubernetes and containerized deployment of model services";
const AB_QUOTE = "- Experiment design, A/B testing, and statistical analysis";

const jdText = (n: number) =>
  [
    `Role ${n}`,
    PYTHON_QUOTE,
    "Requirements",
    "- SQL and data modeling across large analytical datasets",
    K8S_QUOTE,
    AB_QUOTE,
    "- Clear communication with product, design, and engineering partners",
    "- Monitoring model performance and retraining in production",
    "",
    "The base salary range is $150,000 - $190,000.",
  ].join("\n");

const keyword = (
  canonical: string,
  quote: string,
  importance: ExtractedKeyword["importance"] = "required",
): ExtractedKeyword => ({
  jd_phrase: canonical,
  canonical_skill: canonical,
  category: "hard_skill",
  importance,
  evidence_quote: quote,
});

/** Python and Kubernetes in every JD; A/B testing only in "Role 2". */
function fakeExtraction(text: string, { withAb = true } = {}): CachedExtraction {
  const role = text.split("\n")[0];
  const keywords = [keyword("Python", PYTHON_QUOTE), keyword("Kubernetes", K8S_QUOTE)];
  if (withAb && role === "Role 2") keywords.push(keyword("A/B testing", AB_QUOTE, "preferred"));
  return {
    job: { company: `Company ${role}`, title: "ML Engineer", seniority: "senior", years_experience_min: 5 },
    keywords,
    dropped: { quoteNotFound: 0, phraseNotFound: 0, empty: 0, duplicates: 0 },
  };
}

/**
 * Fake embeddings: one-hot vectors, so texts are unrelated (cosine 0) unless
 * they share a group in `similar`, which gives them the same vector.
 */
function fakeEmbed(similar: string[][] = []) {
  const dims = new Map<string, number>();
  return vi.fn(async (texts: string[]) =>
    texts.map((text) => {
      const group = similar.findIndex((g) => g.includes(text));
      const key = group >= 0 ? `group ${group}` : text;
      if (!dims.has(key)) dims.set(key, dims.size);
      const vector = new Array<number>(256).fill(0);
      vector[dims.get(key)!] = 1;
      return vector;
    }),
  );
}

/** In-memory stand-in for the job_keywords collection. */
function fakeVectorStore() {
  const records = new Map<string, { text: string; metadata: Record<string, unknown> }>();
  const store: KeywordVectorStore = {
    upsertVectors: vi.fn(async (rows) => {
      for (const r of rows) records.set(r.id, { text: r.text, metadata: r.metadata ?? {} });
    }),
    deleteWhere: vi.fn(async () => {}),
    ids: vi.fn(async () => [...records.keys()]),
    delete: vi.fn(async (ids: string[]) => {
      for (const id of ids) records.delete(id);
    }),
  };
  return { store, records };
}

let vectors: ReturnType<typeof fakeVectorStore>;

function depsWith(
  extract = (text: string) => fakeExtraction(text),
  embed: AnalyzeDeps["embed"] = fakeEmbed(),
) {
  const texts: string[] = [];
  const deps: AnalyzeDeps = {
    db,
    embed,
    keywordVectors: vectors.store,
    ensureExtractions: async (docs, { onExtracted }) => {
      const out = new Map<string, CachedExtraction>();
      for (const doc of docs) {
        texts.push(doc.text);
        out.set(doc.id, extract(doc.text));
        onExtracted(doc.id);
      }
      return out;
    },
  };
  return { deps, texts };
}

async function demandsByName() {
  const rows = await db
    .select({ demand: skillDemands, name: skills.canonicalName })
    .from(skillDemands)
    .innerJoin(skills, eq(skills.id, skillDemands.skillId))
    .where(eq(skillDemands.targetSetId, setId));
  return new Map(rows.map((r) => [r.name, r.demand]));
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "analyze-test-"));
  db = await openDb(":memory:");
  library = createLibrary({ db, dataDir });
  store = createTargetSetStore({ db });
  const resumeDoc = await library.add({ kind: "resume", text: "Jordan Rivera" });
  const resumeId = await createResumeStore({ db }).create(resumeDoc, {
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
        title: "Engineer",
        location: null,
        startDate: null,
        endDate: null,
        bullets: ["Ran A/B tests on the checkout flow"],
      },
    ],
  });
  setId = await store.create({ name: "ML roles", resumeId });
  vectors = fakeVectorStore();
  const docs = await Promise.all(
    [1, 2].map((n) => library.add({ kind: "jd", title: `JD ${n}`, text: jdText(n) })),
  );
  await store.addJobs(setId, docs);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("analyzeTargetSet", () => {
  it("extracts from the cleaned JD text and writes keywords, scores, and demands", async () => {
    const { deps, texts } = depsWith();
    const progress = vi.fn();
    const result = await analyzeTargetSet(deps, setId, { onProgress: progress });

    expect(texts).toHaveLength(2);
    for (const text of texts) expect(text).not.toContain("salary");
    expect(progress).toHaveBeenLastCalledWith({ stage: "saving", extracted: 2, total: 2 });
    expect(result).toEqual({ skills: 3, covered: 2, weak: 0, missing: 1 });

    const demands = await demandsByName();
    expect(demands.get("Python")).toMatchObject({
      jdCount: 2,
      requiredCount: 2,
      mustDo: true,
      coverage: "covered",
      coverageEvidence: ["Languages: Python, SQL"],
    });
    expect(demands.get("Kubernetes")).toMatchObject({ jdCount: 2, coverage: "missing" });
    expect(demands.get("A/B testing")).toMatchObject({
      jdCount: 1,
      requiredCount: 0,
      coverage: "covered",
      coverageEvidence: ["Ran A/B tests on the checkout flow"],
    });
    expect([...demands.values()].map((d) => d.rank).sort()).toEqual([1, 2, 3]);

    expect(await db.query.jobKeywords.findMany()).toHaveLength(5);
    const scores = await db.query.jobSkillScores.findMany();
    expect(scores).toHaveLength(5);
    expect(scores.every((s) => s.inTitle === false && s.score > 0)).toBe(true);

    const jobRows = await db.query.jobs.findMany({ where: eq(jobs.targetSetId, setId) });
    expect(jobRows.map((j) => j.title)).toEqual(["ML Engineer", "ML Engineer"]);
    expect(jobRows[0]).toMatchObject({ seniority: "senior", yearsExperienceMin: 5 });
  });

  it("keeps user-set job details", async () => {
    const [job] = await db.query.jobs.findMany({ where: eq(jobs.targetSetId, setId) });
    await db.update(jobs).set({ title: "Staff Engineer" }).where(eq(jobs.id, job.id));
    await analyzeTargetSet(depsWith().deps, setId);
    const after = (await db.query.jobs.findFirst({ where: eq(jobs.id, job.id) }))!;
    expect(after).toMatchObject({ title: "Staff Engineer", seniority: "senior" });
  });

  it("re-analyzing replaces results but keeps overrides and answers for remaining skills", async () => {
    await analyzeTargetSet(depsWith().deps, setId);
    const first = await demandsByName();
    const k8s = first.get("Kubernetes")!;
    await db
      .update(skillDemands)
      .set({ userRank: 1, dismissed: true })
      .where(eq(skillDemands.id, k8s.id));
    await db.insert(gapAnswers).values({ id: "answer-1", skillDemandId: k8s.id, response: "no" });

    await analyzeTargetSet(
      depsWith((text) => fakeExtraction(text, { withAb: false })).deps,
      setId,
    );

    const second = await demandsByName();
    expect([...second.keys()].sort()).toEqual(["Kubernetes", "Python"]);
    expect(second.get("Kubernetes")).toMatchObject({ id: k8s.id, userRank: 1, dismissed: true });
    expect(await db.query.gapAnswers.findMany()).toHaveLength(1);
    expect(await db.query.jobKeywords.findMany()).toHaveLength(4);
    expect(await db.query.jobSkillScores.findMany()).toHaveLength(4);
    // Skills are shared across sets, so the dropped one stays.
    expect(await db.query.skills.findMany()).toHaveLength(3);
  });

  it("merges using the user's synonyms and keeps an existing skill's name", async () => {
    await db.insert(skills).values({
      id: "skill-k8s",
      key: "kubernetes",
      canonicalName: "Kubernetes",
      category: "tool",
      synonyms: ["Container orchestration"],
    });
    await analyzeTargetSet(
      depsWith((text) => ({
        ...fakeExtraction(text),
        keywords: [keyword("Container orchestration", K8S_QUOTE)],
      })).deps,
      setId,
    );
    const demands = await demandsByName();
    expect([...demands.keys()]).toEqual(["Kubernetes"]);
    expect(demands.get("Kubernetes")!.skillId).toBe("skill-k8s");
    expect((await db.query.skills.findMany())[0].category).toBe("tool");
  });

  it("refuses a set with fewer than two JDs", async () => {
    const set = (await store.get(setId))!;
    await store.removeJob(setId, set.jobs[0].id);
    await expect(analyzeTargetSet(depsWith().deps, setId)).rejects.toMatchObject({
      name: "TargetSetError",
      code: "too_few",
    });
    await expect(analyzeTargetSet(depsWith().deps, "missing")).rejects.toBeInstanceOf(
      TargetSetError,
    );
  });

  it("wraps extraction failures in a user-facing error and writes nothing", async () => {
    const deps: AnalyzeDeps = {
      ...depsWith().deps,
      ensureExtractions: async () => {
        throw new AiOutputError("bad", "extract-keywords", "invalid_output");
      },
    };
    const err = await analyzeTargetSet(deps, setId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnalysisError);
    expect((err as Error).message).toContain("unusable output (invalid_output)");
    expect(await db.query.skillDemands.findMany()).toEqual([]);
  });

  it("stores one vector per keyword row, with the rows that own it", async () => {
    await analyzeTargetSet(depsWith().deps, setId);
    const keywords = await db.query.jobKeywords.findMany();
    const set = (await store.get(setId))!;

    expect([...vectors.records.keys()].sort()).toEqual(keywords.map((k) => k.id).sort());
    const k = keywords[0];
    const job = set.jobs.find((j) => j.id === k.jobId)!;
    expect(vectors.records.get(k.id)).toEqual({
      text: k.evidenceQuote,
      metadata: {
        target_set_id: setId,
        job_id: k.jobId,
        document_id: job.documentId,
        resume_id: set.resumeId,
        skill_id: k.skillId,
        importance: k.importance,
      },
    });
  });

  it("re-analyzing replaces the vectors and prunes orphans", async () => {
    await analyzeTargetSet(depsWith().deps, setId);
    const firstIds = new Set(vectors.records.keys());
    vectors.records.set("orphan", { text: "left behind", metadata: {} });

    await analyzeTargetSet(depsWith().deps, setId);

    const liveIds = (await db.query.jobKeywords.findMany()).map((k) => k.id).sort();
    expect([...vectors.records.keys()].sort()).toEqual(liveIds);
    expect(liveIds.some((id) => firstIds.has(id))).toBe(false);
  });

  it("marks a missing skill weak when its requirement line embeds close to a bullet", async () => {
    const bullet = "Ran A/B tests on the checkout flow";
    await analyzeTargetSet(depsWith(undefined, fakeEmbed([[K8S_QUOTE, bullet]])).deps, setId);
    expect((await demandsByName()).get("Kubernetes")).toMatchObject({
      coverage: "weak",
      matchedTerm: null,
      coverageEvidence: [bullet],
    });
  });

  it("writes nothing when the vector store fails", async () => {
    vectors.store.upsertVectors = async () => {
      throw new Error("ECONNREFUSED");
    };
    const err = await analyzeTargetSet(depsWith().deps, setId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnalysisError);
    expect((err as Error).message).toContain("npm run chroma");
    expect(await db.query.jobKeywords.findMany()).toEqual([]);
    expect(await db.query.skillDemands.findMany()).toEqual([]);
  });

  it("fails with a user-facing error when embedding fails", async () => {
    const embed = async () => {
      throw new Error("401");
    };
    await expect(analyzeTargetSet(depsWith(undefined, embed).deps, setId)).rejects.toThrow(
      /Embedding the JD requirements failed/,
    );
  });

  it("still succeeds when pruning fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vectors.store.ids = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(analyzeTargetSet(depsWith().deps, setId)).resolves.toMatchObject({ skills: 3 });
    expect(error.mock.calls[0][0]).toContain("vector_prune_failed");
    error.mockRestore();
  });

  it("links each covered skill to its strongest bullet and reads strengths back", async () => {
    await analyzeTargetSet(depsWith().deps, setId);
    const demands = await demandsByName();
    const [bullet] = await db.query.bullets.findMany();

    // A/B testing is named in a bullet; Python only in the skills list.
    expect(demands.get("A/B testing")).toMatchObject({ proofBulletId: bullet.id });
    expect(demands.get("A/B testing")!.terms).toContain("A/B testing");
    expect(demands.get("Python")).toMatchObject({ coverage: "covered", proofBulletId: null });
    expect(demands.get("Kubernetes")!.proofBulletId).toBeNull();

    const strengths = (await store.strengths(setId))!;
    expect(strengths.jobCount).toBe(2);
    expect(strengths.covered.map((c) => [c.name, c.proof?.bulletId ?? null])).toEqual([
      ["Python", null],
      ["A/B testing", bullet.id],
    ]);
    expect(strengths.strongest).toEqual([
      expect.objectContaining({
        bulletId: bullet.id,
        text: "Ran A/B tests on the checkout flow",
        employer: "Acme",
        roleTitle: "Engineer",
        // Neutral verb (0.5) + keywords 1.5 × min(1, 1 of 2 JDs).
        strength: expect.objectContaining({ score: 1.25, skills: ["A/B testing"] }),
      }),
    ]);
    expect(await store.strengths("missing")).toBeUndefined();
  });
});
