import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/db/client";
import type { ResumeSections } from "@/db/schema";
import type { ResumeParse } from "@/lib/ai/parse-resume";
import { createLibrary, type Library } from "@/lib/library/documents";

import type { ParsedResume } from "./ground";
import { importResumeDocument, ResumeImportError } from "./import";
import { createResumeStore, type ResumeStore } from "./store";

const sections: ResumeSections = {
  contact: { name: "Jordan Rivera", email: null, phone: null, location: null, links: [] },
  summary: "Backend engineer.",
  skills: ["Go | Python"],
  education: [],
  certifications: [],
  other: [],
};

const parsed: ParsedResume = {
  sections,
  roles: [
    {
      employer: "Northwind",
      title: "Senior Engineer",
      location: "Seattle, WA",
      startDate: "Mar 2022",
      endDate: "Present",
      bullets: ["Built the serving platform.", "Ran A/B tests."],
    },
    {
      employer: "Brightline",
      title: "Engineer",
      location: null,
      startDate: "Jun 2019",
      endDate: "Feb 2022",
      bullets: [],
    },
  ],
};

let dataDir: string;
let db: Db;
let library: Library;
let store: ResumeStore;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "resume-test-"));
  db = await openDb(":memory:");
  library = createLibrary({ db, dataDir });
  store = createResumeStore({ db });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("resume store", () => {
  it("saves roles and original bullets in order and reads them back", async () => {
    const doc = await library.add({ kind: "resume", text: "Jordan Rivera resume" });
    const id = await store.create(doc, parsed);

    const resume = await store.get(id);
    expect(resume).toMatchObject({
      title: doc.title,
      documentId: doc.id,
      sections,
      isMaster: true,
    });
    expect(resume!.roles.map((r) => [r.position, r.employer, r.endDate])).toEqual([
      [0, "Northwind", "Present"],
      [1, "Brightline", "Feb 2022"],
    ]);
    expect(resume!.roles[0].bullets.map((b) => [b.position, b.text, b.source, b.status])).toEqual([
      [0, "Built the serving platform.", "original", "accepted"],
      [1, "Ran A/B tests.", "original", "accepted"],
    ]);
    expect(resume!.roles[1].bullets).toEqual([]);
  });

  it("makes only the first resume the master", async () => {
    const doc = await library.add({ kind: "resume", text: "resume" });
    const first = await store.create(doc, parsed);
    const second = await store.create(doc, parsed);
    expect((await store.get(first))!.isMaster).toBe(true);
    expect((await store.get(second))!.isMaster).toBe(false);
    expect((await store.findByDocument(doc.id)).map((r) => r.id).sort()).toEqual(
      [first, second].sort(),
    );
  });

  it("removes a resume with its roles and bullets", async () => {
    const doc = await library.add({ kind: "resume", text: "resume" });
    const id = await store.create(doc, parsed);
    expect(await store.remove(id)).toBe(true);
    expect(await store.get(id)).toBeUndefined();
    expect(await db.query.roles.findMany()).toEqual([]);
    expect(await db.query.bullets.findMany()).toEqual([]);
  });
});

describe("editing roles", () => {
  async function seeded() {
    const doc = await library.add({ kind: "resume", text: "resume" });
    const id = await store.create(doc, {
      ...parsed,
      roles: [{ ...parsed.roles[0], bullets: ["One.", "Two.", "Three."] }],
    });
    const resume = (await store.get(id))!;
    return { id, role: resume.roles[0], ids: resume.roles[0].bullets.map((b) => b.id) };
  }
  const fields = {
    employer: "Northwind Logistics",
    title: "Staff Engineer",
    location: null,
    startDate: "Mar 2022",
    endDate: "Present",
  };

  it("updates role fields and keeps ids of unchanged bullets when one is removed", async () => {
    const { id, role, ids } = await seeded();
    expect(await store.updateRole(role.id, fields, ["One.", "Three."])).toBe(id);
    const [updated] = (await store.get(id))!.roles;
    expect(updated).toMatchObject(fields);
    expect(updated.bullets.map((b) => [b.id, b.text, b.position])).toEqual([
      [ids[0], "One.", 0],
      [ids[2], "Three.", 1],
    ]);
  });

  it("reuses ids for edited lines, inserts extra lines, and keeps moved lines' ids", async () => {
    const { id, role, ids } = await seeded();
    await store.updateRole(role.id, fields, ["Three.", "One (edited).", "Two.", "Four."]);
    const [updated] = (await store.get(id))!.roles;
    expect(updated.bullets.map((b) => b.text)).toEqual([
      "Three.",
      "One (edited).",
      "Two.",
      "Four.",
    ]);
    expect(updated.bullets.slice(0, 3).map((b) => b.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(ids).not.toContain(updated.bullets[3].id);
  });

  it("adds a role at the end, removes a role, and confirms", async () => {
    const { id, role } = await seeded();
    const added = await store.addRole(id, { ...fields, title: "Advisor" }, ["Advised."]);
    let resume = (await store.get(id))!;
    expect(resume.roles.map((r) => [r.id, r.position])).toEqual([
      [role.id, 0],
      [added, 1],
    ]);
    expect(resume.confirmedAt).toBeNull();

    expect(await store.removeRole(role.id)).toBe(id);
    expect(await store.confirm(id)).toBe(true);
    resume = (await store.get(id))!;
    expect(resume.roles.map((r) => r.title)).toEqual(["Advisor"]);
    expect(resume.confirmedAt).toBeInstanceOf(Date);
  });

  it("returns null for roles that no longer exist", async () => {
    expect(await store.updateRole("missing", fields, [])).toBeNull();
    expect(await store.removeRole("missing")).toBeNull();
  });
});

describe("importResumeDocument", () => {
  function parser(issues: ResumeParse["issues"] = []) {
    return vi.fn(async (): Promise<ResumeParse> => ({
      resume: parsed,
      issues,
      checked: 10,
      promptVersion: "test",
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
  }

  it("parses the document's text and saves the resume", async () => {
    const doc = await library.add({ kind: "resume", text: "Jordan Rivera resume" });
    const parse = parser([{ path: "roles[0].title", value: "Staff Engineer" }]);
    const result = await importResumeDocument({ library, store, parse }, doc.id);

    expect(parse).toHaveBeenCalledWith("Jordan Rivera resume");
    expect(result.issues).toEqual([{ path: "roles[0].title", value: "Staff Engineer" }]);
    expect((await store.get(result.resumeId))!.roles).toHaveLength(2);
  });

  it("rejects missing documents and job descriptions without calling the model", async () => {
    const jd = await library.add({ kind: "jd", text: "A job" });
    const parse = parser();
    await expect(importResumeDocument({ library, store, parse }, jd.id)).rejects.toMatchObject({
      code: "not_resume",
    });
    await expect(
      importResumeDocument({ library, store, parse }, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(ResumeImportError);
    expect(parse).not.toHaveBeenCalled();
  });
});
