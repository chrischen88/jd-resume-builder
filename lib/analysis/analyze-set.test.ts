import { describe, expect, it } from "vitest";

import { analyzeSet, type AnalyzedJob } from "./analyze-set";
import type { ExtractedKeyword } from "./types";

function kw(
  canonical_skill: string,
  evidence_quote: string,
  overrides: Partial<ExtractedKeyword> = {},
): ExtractedKeyword {
  return {
    jd_phrase: canonical_skill,
    canonical_skill,
    category: "tool",
    importance: "required",
    evidence_quote,
    ...overrides,
  };
}

const jobs: AnalyzedJob[] = [
  {
    jobId: "a",
    title: "ML Engineer",
    text: "You have Python and Kubernetes experience.",
    keywords: [
      kw("Python", "You have Python and Kubernetes experience."),
      kw("Kubernetes", "You have Python and Kubernetes experience."),
    ],
  },
  {
    jobId: "b",
    text: "Strong python skills. Terraform is a plus.",
    keywords: [
      kw("Python", "Strong python skills.", { jd_phrase: "python" }),
      kw("Terraform", "Terraform is a plus.", { importance: "preferred" }),
    ],
  },
];

const resume = "Built data pipelines in Python.\nManaged infra with Terraform.";

describe("analyzeSet", () => {
  it("ranks merged skills and attaches coverage", () => {
    const rows = analyzeSet(jobs, resume);
    expect(rows.map((r) => [r.name, r.jdCount, r.coverage])).toEqual([
      ["Python", 2, "covered"],
      ["Kubernetes", 1, "missing"],
      ["Terraform", 1, "covered"],
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("carries category, matched term, and resume evidence", () => {
    const terraform = analyzeSet(jobs, resume).find((r) => r.name === "Terraform")!;
    expect(terraform).toMatchObject({
      category: "tool",
      matchedTerm: "Terraform",
      resumeEvidence: ["Managed infra with Terraform."],
      mustDo: true,
    });
  });

  it("handles an empty set", () => {
    expect(analyzeSet([], resume)).toEqual([]);
  });
});
