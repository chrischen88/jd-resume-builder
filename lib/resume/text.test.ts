import { describe, expect, it } from "vitest";

import { resumeToText } from "./text";

describe("resumeToText", () => {
  it("renders one fact per line and skips draft bullets", () => {
    const text = resumeToText({
      sections: {
        contact: { name: "Jordan", email: null, phone: null, location: null, links: [] },
        summary: "ML engineer.\nShips models.",
        skills: ["Languages: Python, SQL"],
        education: [
          {
            institution: "State University",
            degree: "BS",
            field: "Statistics",
            location: null,
            startDate: null,
            endDate: null,
            details: ["Thesis on Bayesian methods"],
          },
        ],
        certifications: ["AWS Certified ML – Specialty"],
        other: [{ heading: "Projects", lines: ["  Kaggle top 5%  ", ""] }],
      },
      roles: [
        {
          employer: "Acme",
          title: "Engineer",
          bullets: [
            { text: "Built fraud models", status: "accepted" },
            { text: "Drafted, not accepted", status: "draft" },
          ],
        },
      ],
    });
    expect(text.split("\n")).toEqual([
      "ML engineer.",
      "Ships models.",
      "Languages: Python, SQL",
      "Engineer, Acme",
      "Built fraud models",
      "BS, Statistics, State University",
      "Thesis on Bayesian methods",
      "AWS Certified ML – Specialty",
      "Kaggle top 5%",
    ]);
  });
});
