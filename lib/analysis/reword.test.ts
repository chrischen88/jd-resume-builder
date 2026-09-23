import { describe, expect, it } from "vitest";

import { checkRewording, rewordCandidates, type RewordSkill } from "./reword";

const bullets = [
  { id: "b1", text: "Queried and analyzed complex datasets using SQL" },
  { id: "b2", text: "Built k8s deploy tooling for 12 services" },
  { id: "b3", text: "Ran A/B tests on the checkout flow" },
];

const skill = (over: Partial<RewordSkill>): RewordSkill => ({
  skillId: "s",
  name: "Skill",
  coverage: "missing",
  rank: 1,
  terms: [],
  jdPhrases: [],
  evidence: [],
  proofBulletId: null,
  ...over,
});

describe("rewordCandidates", () => {
  it("picks weak skills shown by a bullet and covered skills named only by an alias", () => {
    const candidates = rewordCandidates(
      [
        skill({
          skillId: "k8s",
          name: "Kubernetes",
          coverage: "covered",
          rank: 2,
          terms: ["Kubernetes", "k8s"],
          jdPhrases: ["Kubernetes"],
          evidence: [bullets[1].text],
          proofBulletId: "b2",
        }),
        skill({
          skillId: "analytics",
          name: "Analytical skills",
          coverage: "weak",
          rank: 1,
          // The longest one is skipped: it says more than the skill.
          jdPhrases: ["strong analytical and quantitative skills", "strong analytical skills"],
          evidence: ["Summary line", bullets[0].text],
        }),
      ],
      bullets,
      bullets.map((b) => b.text).join("\n"),
    );
    expect(candidates).toEqual([
      {
        skillId: "analytics",
        skillName: "Analytical skills",
        bulletId: "b1",
        bulletText: bullets[0].text,
        phrase: "strong analytical skills",
        terms: [],
      },
      {
        skillId: "k8s",
        skillName: "Kubernetes",
        bulletId: "b2",
        bulletText: bullets[1].text,
        phrase: "Kubernetes",
        terms: ["Kubernetes", "k8s"],
      },
    ]);
  });

  it("skips skills already in JD wording, in the skills list only, or overused", () => {
    const resume = [...bullets.map((b) => b.text), "SQL, SQL, SQL"].join("\n");
    const candidates = rewordCandidates(
      [
        // The proof bullet already uses the JD's wording.
        skill({
          name: "A/B testing",
          coverage: "covered",
          jdPhrases: ["A/B tests"],
          proofBulletId: "b3",
        }),
        // Covered by the skills list only: no proof bullet.
        skill({ name: "Python", coverage: "covered", jdPhrases: ["Python"] }),
        // Weak, but the evidence isn't a bullet.
        skill({ name: "Ownership", coverage: "weak", evidence: ["Took ownership of things"] }),
        // Phrase already used 4 times.
        skill({ name: "SQL", coverage: "weak", jdPhrases: ["SQL"], evidence: [bullets[0].text] }),
        skill({ name: "Go", coverage: "missing", jdPhrases: ["Go"] }),
      ],
      bullets,
      resume,
    );
    expect(candidates).toEqual([]);
  });

  it("rewords each bullet for one skill at most, and limits the count", () => {
    const weakOn = (id: string, rank: number) =>
      skill({ skillId: id, name: id, rank, coverage: "weak", evidence: [bullets[0].text] });
    const candidates = rewordCandidates([weakOn("x", 1), weakOn("y", 2)], bullets, "");
    expect(candidates.map((c) => c.skillId)).toEqual(["x"]);
    expect(
      rewordCandidates(
        [
          weakOn("x", 1),
          skill({ skillId: "z", name: "z", coverage: "weak", evidence: [bullets[2].text] }),
        ],
        bullets,
        "",
        1,
      ),
    ).toHaveLength(1);
  });
});

describe("checkRewording", () => {
  const original = "Queried and analyzed complex datasets using SQL for a 10-person team";
  const phrase = "analytical skills";

  it("accepts a rewording that adds only the phrase", () => {
    const reworded =
      "Applied analytical skills to query and analyze complex datasets using SQL " +
      "for a 10-person team";
    expect(checkRewording(original, reworded, phrase)).toEqual({ ok: true, text: reworded });
  });

  it.each([
    [original, "unchanged"],
    ["Queried and analyzed complex datasets with SQL for a 10-person team", "missing_phrase"],
    ["Used analytical skills on datasets using SQL for a 12-person team", "new_number"],
    ["Used analytical skills on datasets using SQL and Python for a 10-person team", "new_name"],
    [
      "Applied strong analytical skills to query, clean, model, and analyze very large and " +
        "complex datasets using SQL every week for a 10-person team",
      "too_long",
    ],
  ])("rejects %s (%s)", (suggestion, reason) => {
    expect(checkRewording(original, suggestion, phrase)).toEqual({ ok: false, reason });
  });

  // Real model output from the fixtures (task 1.13).
  describe("on real suggestions", () => {
    it("keeps an alias swap that loses only the alias", () => {
      const llm =
        "Designed and deployed an LLM-driven document classification and extraction application, " +
        "cutting manual review time by ~83% (1 hr → <10 min)";
      const reworded =
        "Designed and deployed a document classification and extraction application utilizing " +
        "large language models, cutting manual review time by ~83% (1 hr → <10 min)";
      expect(
        checkRewording(llm, reworded, "large language models", ["Large language models", "LLM"]),
      ).toMatchObject({ ok: true });
    });

    it("rejects swapping out a named practice and adding 'successfully'", () => {
      const governance =
        "Partnered with stakeholders on AI governance reviews, implementing MLOps practices for " +
        "model validation, deployment, and data documentation";
      expect(
        checkRewording(
          governance,
          governance.replace("implementing MLOps", "implementing Model deployment"),
          "Model deployment",
          ["Model deployment"],
        ),
      ).toEqual({ ok: false, reason: "dropped_name" });
      expect(
        checkRewording(
          governance,
          governance.replace("implementing", "successfully implementing Model deployment and"),
          "Model deployment",
          ["Model deployment"],
        ),
      ).toEqual({ ok: false, reason: "new_intensifier" });
    });

    it("rejects dropping a verb", () => {
      const queried = "Queried and analyzed complex datasets using SQL for a 10-person team";
      expect(
        checkRewording(
          queried,
          "Analyzed complex datasets using SQL for a 10-person team, " +
            "demonstrating analytical skills",
          "Analytical skills",
          ["Analytical skills"],
        ),
      ).toEqual({ ok: false, reason: "dropped_content" });
    });

    it("rejects replacing other content with the phrase", () => {
      const queried =
        "Queried and analyzed complex datasets as part of a 10-person analytics team, generating " +
        "insights that supported product development timelines";
      expect(
        checkRewording(
          queried,
          queried.replace(
            "generating insights",
            "demonstrating analytical and quantitative skills",
          ),
          "analytical and quantitative skills",
          ["Analytical skills"],
        ),
      ).toEqual({ ok: false, reason: "dropped_content" });
    });
  });
});
