import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractText, isSupportedFile, normalizeText, UnsupportedFileError } from "./extract-text";

const fixtures = path.join(process.cwd(), "tests/fixtures");
const jdTxt = path.join(fixtures, "jds/jd1.txt");
// Fixtures are git-ignored, so tests that read them skip when absent.
const resumeDocx = path.join(fixtures, "resumes/resume1.docx");

/** Builds a minimal one-page PDF with one line of text per entry. */
function makePdf(lines: string[]): Uint8Array {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = [
    "BT /F1 12 Tf 72 720 Td 14 TL",
    ...lines.map((line) => `(${escape(line)}) Tj T*`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("normalizeText", () => {
  it("normalizes line endings, BOM, nbsp, trailing spaces, and blank runs", () => {
    expect(normalizeText("﻿Title  \r\n\r\n\r\n\r\nLine two\t\r\n")).toBe(
      "Title\n\nLine two",
    );
  });
});

describe("isSupportedFile", () => {
  it("accepts supported extensions case-insensitively", () => {
    expect(isSupportedFile("a.PDF")).toBe(true);
    expect(isSupportedFile("a.docx")).toBe(true);
    expect(isSupportedFile("a.doc")).toBe(false);
    expect(isSupportedFile("a")).toBe(false);
  });
});

describe("extractText", () => {
  it("reads a .txt file", async () => {
    const text = await extractText("jd.txt", new TextEncoder().encode("Role\r\n\r\n\r\nPython  \r\n"));
    expect(text).toBe("Role\n\nPython");
  });

  it.skipIf(!existsSync(jdTxt))("reads a .txt JD (local fixture)", async () => {
    const bytes = readFileSync(jdTxt);
    const text = await extractText("jd1.txt", bytes);
    expect(text.length).toBeGreaterThan(500);
    expect(text).not.toMatch(/\r/);
  });

  it("reads a .pdf and drops page markers", async () => {
    const text = await extractText(
      "resume.pdf",
      makePdf(["Senior Data Analyst", "Built A/B testing (experimentation) platform"]),
    );
    expect(text).toContain("Senior Data Analyst");
    expect(text).toContain("Built A/B testing (experimentation) platform");
    expect(text).not.toMatch(/-- \d+ of \d+ --/);
  });

  it("returns empty text for a PDF with no text layer", async () => {
    expect(await extractText("scan.pdf", makePdf([]))).toBe("");
  });

  it.skipIf(!existsSync(resumeDocx))("reads a .docx resume (local fixture)", async () => {
    const text = await extractText("resume1.docx", readFileSync(resumeDocx));
    expect(text).toMatch(/EXPERIENCE/i);
  });

  it("rejects unsupported files", async () => {
    await expect(extractText("resume.doc", new Uint8Array())).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
  });
});
