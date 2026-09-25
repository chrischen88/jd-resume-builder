import type { ExportBlock, ExportResume } from "./model";

// Print HTML for the PDF export (task 1.25): the same single column and
// headings as the DOCX, real text, a common font, no images or scripts.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.35;
    color: #000; margin: 0; }
  h1 { font-size: 16pt; text-align: center; margin: 0 0 2pt; }
  .contact { text-align: center; margin: 0 0 8pt; }
  h2 { font-size: 12pt; margin: 12pt 0 4pt; padding-bottom: 1pt; border-bottom: 0.75pt solid #999;
    break-after: avoid; }
  p { margin: 0 0 3pt; }
  .entry { margin-top: 6pt; break-inside: avoid-page; }
  .title { font-weight: bold; margin: 0; }
  .meta { font-style: italic; margin: 0; }
  ul { margin: 2pt 0 0; padding-left: 16pt; }
  li { margin: 0 0 2pt; }
`;

function block(b: ExportBlock): string {
  const list = (items: string[]) =>
    items.length > 0 ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
  switch (b.kind) {
    case "text":
      return `<p>${escapeHtml(b.text)}</p>`;
    case "list":
      return list(b.items);
    case "entry":
      return [
        `<div class="entry">`,
        `<p class="title">${escapeHtml(b.title)}</p>`,
        b.meta ? `<p class="meta">${escapeHtml(b.meta)}</p>` : "",
        list(b.bullets),
        `</div>`,
      ].join("");
  }
}

export function renderHtml(resume: ExportResume): string {
  const body = [
    `<h1>${escapeHtml(resume.name)}</h1>`,
    resume.contact.length > 0
      ? `<p class="contact">${resume.contact.map(escapeHtml).join(" | ")}</p>`
      : "",
    ...resume.sections.map(
      (s) => `<section><h2>${escapeHtml(s.heading)}</h2>${s.blocks.map(block).join("")}</section>`,
    ),
  ].join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(resume.name)}</title>
<style>${STYLE}</style></head>
<body>
${body}
</body></html>`;
}
