import { describe, expect, it } from "vitest";

import { coverageChanges, coverageScore, type ScoredSkill } from "./coverage-score";

const skills: ScoredSkill[] = [
  { key: "python", name: "Python", category: "tool", terms: ["Python"], demandScore: 6 },
  {
    key: "ab",
    name: "A/B testing",
    category: "hard_skill",
    terms: ["A/B testing", "experimentation"],
    demandScore: 3,
  },
  {
    key: "deploy",
    name: "Model deployment",
    category: "hard_skill",
    terms: ["model deployment"],
    demandScore: 1,
  },
];

describe("coverageScore", () => {
  it("weights each skill's coverage by its demand", () => {
    const result = coverageScore(skills, "Built Python services\nDeployed models to production");
    // Python covered (6), A/B missing (0), deployment weak (0.5 of 1): 6.5 / 10.
    expect(result.score).toBe(65);
    expect(result.counts).toEqual({ covered: 1, weak: 1, missing: 1 });
    expect(result.bySkill.get("deploy")).toBe("weak");
  });

  it("counts any of a skill's wordings", () => {
    expect(coverageScore(skills, "Python\nRan experimentation program").bySkill.get("ab")).toBe(
      "covered",
    );
  });

  it("is null for a set with no skills", () => {
    expect(coverageScore([], "Python").score).toBeNull();
  });

  it("lists what changed, most in demand first", () => {
    const before = coverageScore(skills, "Deployed models");
    const after = coverageScore(skills, "Python\nA/B testing\nDeployed models");
    expect(before.score).toBe(5);
    expect(after.score).toBe(95);
    expect(coverageChanges(skills, before, after)).toEqual([
      { key: "python", name: "Python", before: "missing", after: "covered" },
      { key: "ab", name: "A/B testing", before: "missing", after: "covered" },
    ]);
  });
});
