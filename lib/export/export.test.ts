import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import mammoth from "mammoth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/db/client";
import { bullets, type ResumeSections } from "@/db/schema";
import { createLibrary } from "@/lib/library/documents";
import { createResumeStore, type ResumeDetail } from "@/lib/resume/store";
import { createTargetSetStore } from "@/lib/target-sets/store";

import { renderDocx } from "./docx";
import { escapeHtml, renderHtml } from "./html";
import { exportFilename, exportModel } from "./model";
import { ExportError, exportResume } from "./run";

const SECTIONS: ResumeSections = {
  contact: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: null,
    location: "Austin, TX",
    links: ["github.com/jrivera"],
  },
  summary: "Data analyst​ who ships.",
  skills: ["Languages: Python, SQL", "Additional skills: A/B testing"],
  education: [
    {
      institution: "UT Austin",
      degree: "BS",
      field: "Statistics",
      location: null,
      startDate: null,
      endDate: "2019",
      details: ["Dean's list"],
    },
  ],
  certifications: ["CKA"],
  other: [{ heading: "Volunteering", lines: ["Tutored <kids> & teens"] }],
};

const RESUME = {
  title: "resume.docx",
  sections: SECTIONS,
  roles: [
    {
      title: "Analyst",
      employer: "Acme",
      location: "Remote",
      startDate: "2021",
      endDate: "Present",
      bullets: [
        { text: "Built reports", status: "accepted" },
        { text: "A draft nobody accepted", status: "draft" },
        { text: "Ran A/B tests on checkout", status: "accepted" },
      ],
    },
  ],
} as unknown as ResumeDetail;

describe("exportModel", () => {
  it("lays out standard sections in order with accepted bullets only", () => {
    const model = exportModel(RESUME);
    expect(model.name).toBe("Jordan Rivera");
    expect(model.contact).toEqual(["jordan@example.com", "Austin, TX", "github.com/jrivera"]);
    expect(model.sections.map((s) => s.heading)).toEqual([
      "Summary",
      "Experience",
      "Skills",
      "Education",
      "Certifications",
      "Volunteering",
    ]);
    expect(model.sections[0].blocks).toEqual([{ kind: "text", text: "Data analyst who ships." }]);
    expect(model.sections[1].blocks).toEqual([
      {
        kind: "entry",
        title: "Analyst, Acme",
        meta: "Remote | 2021 – Present",
        bullets: ["Built reports", "Ran A/B tests on checkout"],
      },
    ]);
    expect(model.sections[3].blocks[0]).toMatchObject({
      title: "BS, Statistics, UT Austin",
      meta: "2019",
    });
  });

  it("leaves out empty sections", () => {
    const model = exportModel({
      ...RESUME,
      sections: { ...SECTIONS, summary: " ", certifications: [], other: [] },
      roles: [],
    });
    expect(model.sections.map((s) => s.heading)).toEqual(["Skills", "Education"]);
  });
});

describe("exportFilename", () => {
  it("makes a safe name", () => {
    expect(exportFilename("Renée O'Brien", "pdf")).toBe("renee-o-brien-resume.pdf");
    expect(exportFilename("../../etc", "docx")).toBe("etc-resume.docx");
    expect(exportFilename("", "docx")).toBe("resume.docx");
  });
});

describe("renderHtml", () => {
  it("escapes text and uses no scripts, images, or tables", () => {
    const html = renderHtml(exportModel(RESUME));
    expect(html).toContain("<li>Tutored &lt;kids&gt; &amp; teens</li>");
    expect(html).toContain("<h2>Experience</h2>");
    expect(html).not.toMatch(/<(script|img|table|iframe)/i);
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
});

describe("renderDocx", () => {
  it("writes real text under standard headings, with no tables or images", async () => {
    const buffer = await renderDocx(exportModel(RESUME));
    const { value: text } = await mammoth.extractRawText({ buffer });
    const order = ["Jordan Rivera", "Summary", "Experience", "Ran A/B tests", "Skills", "Education"];
    const at = order.map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).not.toContain("A draft nobody accepted");
    const { value: html } = await mammoth.convertToHtml({ buffer });
    expect(html).toContain("<h1>Summary</h1>");
    expect(html).toContain("<li>Built reports</li>");
    expect(html).not.toMatch(/<(table|img)/);
  });
});

describe("exportResume", () => {
  let dataDir: string;
  let db: Db;
  let setId: string;
  let roleId: string;
  const htmlToPdf = vi.fn(async (html: string) => Buffer.from(`%PDF ${html.length}`));

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "export-test-"));
    db = await openDb(":memory:");
    const library = createLibrary({ db, dataDir });
    const doc = await library.add({ kind: "resume", text: "Jordan Rivera" });
    const resumeId = await createResumeStore({ db }).create(doc, {
      sections: SECTIONS,
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
    roleId = (await createResumeStore({ db }).get(resumeId))!.roles[0].id;
    setId = await createTargetSetStore({ db }).create({ name: "Set", resumeId });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("refuses while a bullet has unverified claims", async () => {
    await db.insert(bullets).values({
      id: "b1",
      roleId,
      position: 1,
      text: "Lifted conversion 4%",
      source: "generated",
      status: "accepted",
      unverifiedClaims: ["The number 4 isn't in your answers"],
    });
    const err = await exportResume({ db, dataDir, htmlToPdf }, setId, "docx").catch((e) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect(err.code).toBe("blocked");
    expect(existsSync(path.join(dataDir, "exports"))).toBe(false);
  });

  it("saves the file and records it on the set's resume version", async () => {
    const docx = await exportResume({ db, dataDir, htmlToPdf }, setId, "docx");
    expect(docx.filename).toBe("jordan-rivera-resume.docx");
    const pdf = await exportResume({ db, dataDir, htmlToPdf }, setId, "pdf");
    expect(pdf.contentType).toBe("application/pdf");
    expect(htmlToPdf).toHaveBeenCalledWith(expect.stringContaining("<h2>Experience</h2>"));

    const versions = await db.query.resumeVersions.findMany();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      targetSetId: setId,
      jobId: null,
      docxPath: path.join("exports", setId, "resume.docx"),
      pdfPath: path.join("exports", setId, "resume.pdf"),
      skills: SECTIONS.skills,
    });
    expect(versions[0].bulletIds).toHaveLength(1);
    expect(readFileSync(path.join(dataDir, versions[0].pdfPath!)).toString()).toMatch(/^%PDF/);
  });

  it("fails for an unknown set", async () => {
    await expect(
      exportResume({ db, dataDir, htmlToPdf }, "00000000-0000-4000-8000-000000000000", "pdf"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
