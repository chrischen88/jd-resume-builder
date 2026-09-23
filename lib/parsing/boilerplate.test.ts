import { describe, expect, it } from "vitest";

import { stripBoilerplate } from "./boilerplate";

// Enough real content that the "kept too little" fail-safe doesn't apply.
const MORE_REQUIREMENTS = [
  "- Experience building and deploying production ML models end to end",
  "- Strong SQL and data modeling skills across large analytical datasets",
  "- Familiarity with experiment design, A/B testing, and statistical analysis",
  "- Clear written communication with product, design, and engineering partners",
].join("\n");

const posting = `About Acme
Acme builds payroll software for 10,000 small businesses.

About the Role
You will build ML systems for fraud detection.

Requirements:
- 3+ years of Python
- Experience designing compensation systems for gig workers
- Knowledge of health equity research
${MORE_REQUIREMENTS}

Benefits
- Medical, dental, and vision
- Unlimited PTO
- Home office stipend

Nice to have
- Kubernetes

Acme is an equal opportunity employer. We welcome applicants without regard to race, religion, or gender.
The base salary range for this role is $150,000 - $190,000.`;

describe("stripBoilerplate", () => {
  it("removes company, benefits, EEO, and pay text and keeps the role content", () => {
    const { text, removed, keptOriginal } = stripBoilerplate(posting);
    expect(keptOriginal).toBe(false);
    expect(text).toBe(`About the Role
You will build ML systems for fraud detection.

Requirements:
- 3+ years of Python
- Experience designing compensation systems for gig workers
- Knowledge of health equity research
${MORE_REQUIREMENTS}

Nice to have
- Kubernetes`);
    expect(removed.map((r) => r.kind)).toEqual(["company", "benefits", "eeo", "benefits"]);
    expect(removed[0].text).toBe(
      "About Acme\nAcme builds payroll software for 10,000 small businesses.",
    );
  });

  it("returns only lines from the input", () => {
    const { text } = stripBoilerplate(posting);
    for (const line of text.split("\n")) expect(posting.split("\n")).toContain(line);
  });

  it("drops unheaded funding and pay lines but not skill lines that share words", () => {
    const content = [
      "Build pricing models in Python and SQL for our marketplace, working closely with product.",
      "Experience with salary benchmarking data is a plus.",
      MORE_REQUIREMENTS,
    ];
    const jd = [
      "We raised a $25 million Series A led by Big Ventures.",
      ...content,
      "Anticipated base salary: 140k - 180k, plus an annual incentive bonus.",
    ].join("\n");
    const { text, removed } = stripBoilerplate(jd);
    expect(text).toBe(content.join("\n"));
    expect(removed.map((r) => r.kind)).toEqual(["company", "benefits"]);
  });

  it("treats 'About the team' and 'About you' as content, not company blurbs", () => {
    const jd = "About the team\nWe run the data platform.\n\nAbout you\nYou know SQL.";
    expect(stripBoilerplate(jd)).toEqual({ text: jd, removed: [], keptOriginal: false });
  });

  it("strips a posting that is mostly boilerplate when real content remains", () => {
    const jd = [
      "About Acme",
      "Acme is a great company with great people and a great culture. ".repeat(20),
      "About the role",
      "You will build ML systems for fraud detection.",
      MORE_REQUIREMENTS,
      "Our Benefits",
      "Medical, dental, vision, and a generous home office stipend for everyone. ".repeat(10),
      "Diversity & Accommodations",
      "We welcome everyone and provide accommodations on request.",
    ].join("\n");
    const { text, removed, keptOriginal } = stripBoilerplate(jd);
    expect(keptOriginal).toBe(false);
    expect(text).toBe(
      `About the role\nYou will build ML systems for fraud detection.\n${MORE_REQUIREMENTS}`,
    );
    expect(removed.map((r) => r.kind)).toEqual(["company", "benefits", "eeo"]);
  });

  it("keeps the original when stripping would remove most of it", () => {
    const jd =
      "About Us\n" + "We are a great company with great people. ".repeat(20) + "\nYou know Python.";
    expect(stripBoilerplate(jd)).toEqual({ text: jd, removed: [], keptOriginal: true });
  });
});
