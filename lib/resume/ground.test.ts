import { describe, expect, it } from "vitest";

import type { ParseResumeOutput } from "@/lib/ai/prompts/parse-resume";

import { findUnsupportedValues, groundParsedResume, unsupportedKey } from "./ground";

const text = `JORDAN RIVERA
Seattle, WA · jordan.rivera@example.com

Summary
Backend engineer with 6 years of experience.

Senior Software Engineer — Northwind Logistics
Mar 2022 – Present
• Built the model-serving platform (Go, gRPC, k8s) that deployed 14 ranking
  models to production.
• Ran A/B tests with the pricing team.

Skills
Go | Python | SQL

Education
B.S. Computer Engineering, Oregon State University — 2019`;

function parsed(overrides: Partial<ParseResumeOutput> = {}): ParseResumeOutput {
  return {
    contact: {
      name: "JORDAN RIVERA",
      email: "jordan.rivera@example.com",
      phone: null,
      location: "Seattle, WA",
      links: [],
    },
    summary: "Backend engineer with 6 years of experience.",
    roles: [
      {
        employer: "Northwind Logistics",
        title: "Senior Software Engineer",
        location: null,
        start_date: "Mar 2022",
        end_date: "Present",
        bullets: [
          "Built the model-serving platform (Go, gRPC, k8s) that deployed 14 ranking models to production.",
          "Ran A/B tests with the pricing team.",
        ],
      },
    ],
    skills: ["Go | Python | SQL"],
    education: [
      {
        institution: "Oregon State University",
        degree: "B.S.",
        field: "Computer Engineering",
        location: null,
        start_date: null,
        end_date: "2019",
        details: [],
      },
    ],
    certifications: [],
    other: [],
    ...overrides,
  };
}

describe("groundParsedResume", () => {
  it("accepts values copied from the resume and maps them to the stored shape", () => {
    const { resume, issues, checked } = groundParsedResume(text, parsed());
    expect(issues).toEqual([]);
    expect(checked).toBe(15);
    expect(resume.roles).toEqual([
      {
        employer: "Northwind Logistics",
        title: "Senior Software Engineer",
        location: null,
        startDate: "Mar 2022",
        endDate: "Present",
        bullets: [
          // Joined across the line wrap, as one line.
          "Built the model-serving platform (Go, gRPC, k8s) that deployed 14 ranking models to production.",
          "Ran A/B tests with the pricing team.",
        ],
      },
    ]);
    expect(resume.sections.education[0]).toMatchObject({ degree: "B.S.", endDate: "2019" });
    expect(resume.sections.skills).toEqual(["Go | Python | SQL"]);
  });

  it("uses the resume's own wording when the model changes case or adds a period", () => {
    const { resume, issues } = groundParsedResume(
      text,
      parsed({
        contact: { ...parsed().contact, name: "Jordan Rivera" },
        skills: ["Go | Python | SQL."],
      }),
    );
    expect(issues).toEqual([]);
    expect(resume.sections.contact.name).toBe("JORDAN RIVERA");
    expect(resume.sections.skills).toEqual(["Go | Python | SQL"]);
  });

  it("reports reworded or invented values without dropping them", () => {
    const base = parsed();
    const { resume, issues } = groundParsedResume(
      text,
      parsed({
        roles: [
          {
            ...base.roles[0],
            title: "Senior Software Engineer II",
            bullets: [...base.roles[0].bullets, "Led a team of 12 engineers."],
          },
        ],
        certifications: ["AWS Certified Solutions Architect"],
      }),
    );
    expect(issues).toEqual([
      { path: "certifications[0]", value: "AWS Certified Solutions Architect" },
      { path: "roles[0].title", value: "Senior Software Engineer II" },
      { path: "roles[0].bullets[2]", value: "Led a team of 12 engineers." },
    ]);
    expect(resume.roles[0].bullets).toHaveLength(3);
  });

  it("treats blank values as absent", () => {
    const { resume, issues } = groundParsedResume(
      text,
      parsed({ summary: "  ", skills: ["", "Go | Python | SQL"] }),
    );
    expect(issues).toEqual([]);
    expect(resume.sections.summary).toBeNull();
    expect(resume.sections.skills).toEqual(["Go | Python | SQL"]);
  });
});

describe("findUnsupportedValues", () => {
  it("flags stored values that aren't in the resume text, by field", () => {
    const { resume } = groundParsedResume(text, parsed());
    const stored = {
      sections: { ...resume.sections, skills: ["Go | Python | SQL", "Rust"] },
      roles: resume.roles.map((role) => ({
        ...role,
        id: "r1",
        title: "Staff Software Engineer",
        bullets: [
          { id: "b1", text: role.bullets[0] },
          { id: "b2", text: "Led a team of 12 engineers." },
        ],
      })),
    };
    expect([...findUnsupportedValues(text, stored)].sort()).toEqual([
      unsupportedKey.bullet("b2"),
      unsupportedKey.role("r1", "title"),
      unsupportedKey.section("skills[1]"),
    ]);
  });
});
