import { existsSync } from "node:fs";

import { PDFParse } from "pdf-parse";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import { renderHtml } from "./html";
import { exportModel } from "./model";
import { htmlToPdf } from "./pdf";

// Runs real headless Chromium; skipped where Playwright's browser isn't installed.
const hasBrowser = existsSync(chromium.executablePath());

describe.skipIf(!hasBrowser)("htmlToPdf", () => {
  it("renders selectable text in reading order", { timeout: 30_000 }, async () => {
    const html = renderHtml(
      exportModel({
        title: "resume",
        sections: {
          contact: { name: "Jordan Rivera", email: null, phone: null, location: null, links: [] },
          summary: "Analyst.",
          skills: ["Python, SQL"],
          education: [],
          certifications: [],
          other: [],
        },
        roles: [
          {
            title: "Analyst",
            employer: "Acme",
            location: null,
            startDate: "2021",
            endDate: null,
            bullets: [{ text: "Ran A/B tests on checkout", status: "accepted" }],
          },
        ],
      } as unknown as Parameters<typeof exportModel>[0]),
    );
    const pdf = await htmlToPdf(html);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    const { text } = await parser.getText();
    await parser.destroy();
    const order = ["Jordan Rivera", "Summary", "Experience", "Ran A/B tests on checkout", "Skills"];
    const at = order.map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});
