import { describe, expect, it } from "vitest";

import { hasResult, hasScope, scoreBullet, strongestBullets, verbStrength } from "./strength";

describe("verbStrength", () => {
  it.each([
    ["Led migration from a legacy system", "strong"],
    ["• Built the model-serving platform", "strong"],
    ["- Engineered CI/CD pipelines", "strong"],
    ["Leading a team of four", "strong"],
    ["Partnered with stakeholders on reviews", "neutral"],
    ["Wrote SQL reports", "neutral"],
    ["Responsible for the ETL pipeline", "weak"],
    ["Helped the team ship releases", "weak"],
    ["Worked on data pipelines", "weak"],
  ] as const)("%s → %s", (text, expected) => {
    expect(verbStrength(text)).toBe(expected);
  });
});

describe("hasScope", () => {
  it.each([
    "Designed an event pipeline processing 2B events/day",
    "Standardized deployment across 6+ projects",
    "Worked in a 10-person analytics team",
    "Dashboards used by hundreds of stakeholders",
    "Mentored three junior engineers",
    "Served 40k requests per second",
  ])("finds scope in %s", (text) => {
    expect(hasScope(text)).toBe(true);
  });

  it.each(["Migrated a monolith over six weeks", "Wrote SQL and pandas reports", "Cut costs 20%"])(
    "finds no scope in %s",
    (text) => {
      expect(hasScope(text)).toBe(false);
    },
  );
});

describe("hasResult", () => {
  it.each([
    "cutting runtime 86% (56 hrs → 8 hrs)",
    "cutting p99 latency from 180 ms to 45 ms",
    "made reports 3x faster",
    "saved $2M a year",
    "reduced late deliveries by 9 points",
    "halved review time, from 1 hr to 30 min",
  ])("finds a result in %s", (text) => {
    expect(hasResult(text)).toBe(true);
  });

  it.each(["Deployed 14 ranking models", "Automated infrastructure with Terraform", "Python 3.11"])(
    "finds no result in %s",
    (text) => {
      expect(hasResult(text)).toBe(false);
    },
  );
});

describe("scoreBullet", () => {
  const demands = [
    { name: "Python", terms: ["Python"], jdCount: 4 },
    { name: "Kubernetes", terms: ["Kubernetes", "k8s"], jdCount: 2 },
    { name: "Go", terms: ["Go", "Golang"], jdCount: 1 },
  ];

  it("adds verb, scope, result, and in-demand keywords", () => {
    const strength = scoreBullet(
      "Built the model-serving platform (Go, gRPC, k8s) that deployed 14 ranking models, " +
        "cutting p99 latency from 180 ms to 45 ms",
      demands,
      4,
    );
    // 1 + 1 + 1.5 + 1.5 × min(1, 2/4 + 1/4)
    expect(strength).toEqual({
      score: 4.63,
      verb: "strong",
      hasScope: true,
      hasResult: true,
      skills: ["Kubernetes", "Go"],
    });
  });

  it("caps the keyword part and scores weak bullets low", () => {
    const strong = scoreBullet("Shipped Python and Kubernetes services", demands, 4);
    expect(strong.score).toBe(1 + 1.5);
    const weak = scoreBullet("Responsible for reports", demands, 4);
    expect(weak).toMatchObject({ score: 0, verb: "weak", skills: [] });
  });
});

describe("strongestBullets", () => {
  it("ranks by strength, keeps resume order on ties, and limits", () => {
    const bullets = [
      { id: "a", text: "Wrote reports" },
      { id: "b", text: "Led a migration, cutting costs 30%" },
      { id: "c", text: "Wrote docs" },
      { id: "d", text: "Designed a pipeline, cutting runtime 50%" },
    ];
    expect(strongestBullets(bullets, [], 3, 3).map((b) => b.id)).toEqual(["b", "d", "a"]);
  });
});
