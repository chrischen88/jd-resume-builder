import type { ResumeDetail } from "@/lib/resume/store";

// What an exported resume contains (SPEC F18, task 1.25), before it's
// rendered as DOCX or PDF. ATS-safe by construction: one column of sections
// under standard headings, real text only, accepted bullets only.

export type ExportBlock =
  | { kind: "text"; text: string }
  | { kind: "entry"; title: string; meta: string | null; bullets: string[] }
  | { kind: "list"; items: string[] };

export interface ExportSection {
  heading: string;
  blocks: ExportBlock[];
}

export interface ExportResume {
  name: string;
  /** Email, phone, location, links: one line under the name. */
  contact: string[];
  sections: ExportSection[];
}

/** Zero-width and other invisible characters: nothing hidden goes into an export. */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/g;

export function clean(text: string | null | undefined): string {
  return (text ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

const nonEmpty = (items: (string | null | undefined)[]) => items.map(clean).filter(Boolean);

function dates(start: string | null, end: string | null): string {
  return nonEmpty([start, end]).join(" – ");
}

export function exportModel(resume: Pick<ResumeDetail, "title" | "sections" | "roles">): ExportResume {
  const { sections: s } = resume;
  const out: ExportSection[] = [];
  const add = (heading: string, blocks: ExportBlock[]) => {
    if (blocks.length > 0) out.push({ heading, blocks });
  };

  const summary = clean(s.summary);
  add("Summary", summary ? [{ kind: "text", text: summary }] : []);

  add(
    "Experience",
    resume.roles.map((role) => ({
      kind: "entry",
      title: nonEmpty([role.title, role.employer]).join(", "),
      meta: nonEmpty([role.location, dates(role.startDate, role.endDate)]).join(" | ") || null,
      bullets: nonEmpty(role.bullets.filter((b) => b.status === "accepted").map((b) => b.text)),
    })),
  );

  add(
    "Skills",
    nonEmpty(s.skills).map((text) => ({ kind: "text", text })),
  );

  add(
    "Education",
    s.education.map((e) => ({
      kind: "entry",
      title: nonEmpty([nonEmpty([e.degree, e.field]).join(", "), e.institution]).join(", "),
      meta: nonEmpty([e.location, dates(e.startDate, e.endDate)]).join(" | ") || null,
      bullets: nonEmpty(e.details),
    })),
  );

  const certifications = nonEmpty(s.certifications);
  add("Certifications", certifications.length > 0 ? [{ kind: "list", items: certifications }] : []);

  for (const section of s.other) {
    const lines = nonEmpty(section.lines);
    const heading = clean(section.heading);
    if (heading && lines.length > 0) add(heading, [{ kind: "list", items: lines }]);
  }

  return {
    name: clean(s.contact.name) || clean(resume.title),
    contact: nonEmpty([s.contact.email, s.contact.phone, s.contact.location, ...s.contact.links]),
    sections: out,
  };
}

/** A safe download name, e.g. "jordan-rivera-resume.docx". */
export function exportFilename(name: string, extension: "docx" | "pdf"): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  if (!slug) return `resume.${extension}`;
  return `${slug}${slug.endsWith("resume") ? "" : "-resume"}.${extension}`;
}
