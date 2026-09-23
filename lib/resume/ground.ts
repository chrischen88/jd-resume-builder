import type { ResumeSections } from "@/db/schema";
import type { ParseResumeOutput } from "@/lib/ai/prompts/parse-resume";
import { createVerbatimMatcher } from "@/lib/analysis/evidence";

// Truthfulness check for parsed resumes: every value must come from the
// resume text. Matched values are replaced by the resume's own wording;
// unmatched ones are kept but reported, so the confirm screen (task 1.7) can
// ask the user to fix them. Nothing is silently dropped or invented.

export interface ParsedRole {
  employer: string;
  title: string;
  location: string | null;
  /** As written ("Mar 2022"); null if not stated. */
  startDate: string | null;
  /** As written, including "Present"; null if not stated. */
  endDate: string | null;
  bullets: string[];
}

export interface ParsedResume {
  sections: ResumeSections;
  roles: ParsedRole[];
}

export interface ParseIssue {
  /** Where the value is, e.g. "roles[1].bullets[0]". */
  path: string;
  value: string;
}

export interface GroundedResume {
  resume: ParsedResume;
  /** Values not found verbatim in the resume text. */
  issues: ParseIssue[];
  /** How many values were checked. */
  checked: number;
}

/** Collapses whitespace so a bullet that wrapped across lines is one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function groundParsedResume(resumeText: string, parsed: ParseResumeOutput): GroundedResume {
  const find = createVerbatimMatcher(resumeText);
  const issues: ParseIssue[] = [];
  let checked = 0;

  function ground(value: string, path: string): string {
    checked++;
    const match = find(value);
    if (match) return oneLine(match.exact);
    issues.push({ path, value });
    return oneLine(value);
  }
  function groundNullable(value: string | null, path: string): string | null {
    return value === null || !value.trim() ? null : ground(value, path);
  }
  function groundList(values: string[], path: string): string[] {
    const result: string[] = [];
    values.forEach((value, i) => {
      if (value.trim()) result.push(ground(value, `${path}[${i}]`));
    });
    return result;
  }

  const { contact } = parsed;
  const sections: ResumeSections = {
    contact: {
      name: groundNullable(contact.name, "contact.name"),
      email: groundNullable(contact.email, "contact.email"),
      phone: groundNullable(contact.phone, "contact.phone"),
      location: groundNullable(contact.location, "contact.location"),
      links: groundList(contact.links, "contact.links"),
    },
    summary: groundNullable(parsed.summary, "summary"),
    skills: groundList(parsed.skills, "skills"),
    education: parsed.education.map((e, i) => ({
      institution: ground(e.institution, `education[${i}].institution`),
      degree: groundNullable(e.degree, `education[${i}].degree`),
      field: groundNullable(e.field, `education[${i}].field`),
      location: groundNullable(e.location, `education[${i}].location`),
      startDate: groundNullable(e.start_date, `education[${i}].start_date`),
      endDate: groundNullable(e.end_date, `education[${i}].end_date`),
      details: groundList(e.details, `education[${i}].details`),
    })),
    certifications: groundList(parsed.certifications, "certifications"),
    other: parsed.other.map((section, i) => ({
      heading: ground(section.heading, `other[${i}].heading`),
      lines: groundList(section.lines, `other[${i}].lines`),
    })),
  };

  const roles: ParsedRole[] = parsed.roles.map((role, i) => ({
    employer: ground(role.employer, `roles[${i}].employer`),
    title: ground(role.title, `roles[${i}].title`),
    location: groundNullable(role.location, `roles[${i}].location`),
    startDate: groundNullable(role.start_date, `roles[${i}].start_date`),
    endDate: groundNullable(role.end_date, `roles[${i}].end_date`),
    bullets: groundList(role.bullets, `roles[${i}].bullets`),
  }));

  return { resume: { sections, roles }, issues, checked };
}

/** Stored resume shape needed to re-check values (ids let the UI mark each field). */
export interface CheckableResume {
  sections: ResumeSections;
  roles: {
    id: string;
    employer: string;
    title: string;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
    bullets: { id: string; text: string }[];
  }[];
}

export const ROLE_FIELDS = ["employer", "title", "location", "startDate", "endDate"] as const;
export type RoleField = (typeof ROLE_FIELDS)[number];

/** Keys for values that can be flagged on the review screen. */
export const unsupportedKey = {
  role: (roleId: string, field: RoleField) => `role:${roleId}:${field}`,
  bullet: (bulletId: string) => `bullet:${bulletId}`,
  section: (path: string) => `section:${path}`,
};

/**
 * Keys of stored values that don't appear verbatim in the resume text:
 * values the parser changed, or the user typed in. Recomputed on demand, so
 * nothing extra is stored.
 */
export function findUnsupportedValues(resumeText: string, resume: CheckableResume): Set<string> {
  const find = createVerbatimMatcher(resumeText);
  const unsupported = new Set<string>();
  const check = (value: string | null, key: string) => {
    if (value && value.trim() && !find(value)) unsupported.add(key);
  };

  for (const role of resume.roles) {
    for (const field of ROLE_FIELDS) check(role[field], unsupportedKey.role(role.id, field));
    for (const bullet of role.bullets) check(bullet.text, unsupportedKey.bullet(bullet.id));
  }
  const { sections } = resume;
  check(sections.summary, unsupportedKey.section("summary"));
  sections.skills.forEach((line, i) => check(line, unsupportedKey.section(`skills[${i}]`)));
  sections.certifications.forEach((line, i) =>
    check(line, unsupportedKey.section(`certifications[${i}]`)),
  );
  sections.education.forEach((e, i) => {
    for (const field of [
      "institution",
      "degree",
      "field",
      "location",
      "startDate",
      "endDate",
    ] as const) {
      check(e[field], unsupportedKey.section(`education[${i}].${field}`));
    }
    e.details.forEach((line, j) =>
      check(line, unsupportedKey.section(`education[${i}].details[${j}]`)),
    );
  });
  return unsupported;
}
