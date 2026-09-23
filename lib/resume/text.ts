import type { BulletRow, ResumeSections, RoleRow } from "@/db/schema";

// Plain-text rendering of a stored resume, one fact per line, for coverage
// matching (lib/analysis/coverage matches line by line and quotes lines as
// evidence). Uses the structured rows, so the user's edits from the review
// screen count and the original upload doesn't.

export interface ResumeForText {
  sections: ResumeSections;
  roles: (Pick<RoleRow, "employer" | "title"> & { bullets: Pick<BulletRow, "text" | "status">[] })[];
}

/** Accepted experience bullets, the resume lines embedding coverage compares against. */
export function experienceBullets({ roles }: Pick<ResumeForText, "roles">): string[] {
  return roles.flatMap((role) =>
    role.bullets.filter((b) => b.status === "accepted").map((b) => b.text.trim()),
  ).filter(Boolean);
}

export function resumeToText({ sections, roles }: ResumeForText): string {
  const lines: (string | null)[] = [sections.summary, ...sections.skills];

  for (const role of roles) {
    lines.push(`${role.title}, ${role.employer}`);
    // Drafts aren't on the resume until the user accepts them.
    for (const bullet of role.bullets) if (bullet.status === "accepted") lines.push(bullet.text);
  }

  for (const entry of sections.education) {
    lines.push([entry.degree, entry.field, entry.institution].filter(Boolean).join(", "));
    lines.push(...entry.details);
  }
  lines.push(...sections.certifications);
  for (const section of sections.other) lines.push(...section.lines);

  return lines
    .flatMap((line) => (line ?? "").split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
