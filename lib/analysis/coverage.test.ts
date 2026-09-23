import { describe, expect, it } from "vitest";

import { classifyCoverage, semanticWeakMatches, type SemanticCandidate } from "./coverage";
import { mergeSkills } from "./merge";
import type { ExtractedKeyword } from "./types";

function skills(...entries: (string | Partial<ExtractedKeyword>)[]) {
  return mergeSkills([
    {
      jobId: "j1",
      keywords: entries.map((entry) => {
        const e = typeof entry === "string" ? { canonical_skill: entry } : entry;
        const name = e.canonical_skill ?? "";
        return {
          jd_phrase: name,
          canonical_skill: name,
          category: "hard_skill",
          importance: "required",
          evidence_quote: name,
          ...e,
        } satisfies ExtractedKeyword;
      }),
    },
  ]);
}

const resume = `
Jane Doe
Software Engineer

EXPERIENCE
Acme Corp — ML Engineer
• Trained ranking models in PyTorch and deployed models to production on Kubernetes.
• Built retrieval pipelines with Postgres and pgvector.
• Led go-to-market analytics for the new launch.

SKILLS
Python, SQL, C++, Docker
`;

function byName(names: string[], result: ReturnType<typeof classifyCoverage>) {
  return Object.fromEntries(names.map((n, i) => [n, result[i]]));
}

describe("classifyCoverage", () => {
  it("marks exact matches covered with the supporting lines", () => {
    const merged = skills("PyTorch", "Python");
    const [pytorch, python] = classifyCoverage(merged, resume);
    expect(pytorch).toMatchObject({
      coverage: "covered",
      matchedTerm: "PyTorch",
      evidence: [
        "• Trained ranking models in PyTorch and deployed models to production on Kubernetes.",
      ],
    });
    expect(python).toMatchObject({ coverage: "covered", evidence: ["Python, SQL, C++, Docker"] });
  });

  it("uses curated aliases: the resume says ML / Postgres, the JD says machine learning / PostgreSQL", () => {
    const merged = skills("Machine learning", "PostgreSQL");
    const result = classifyCoverage(merged, resume);
    expect(result.map((r) => [r.coverage, r.matchedTerm])).toEqual([
      ["covered", "ml"],
      ["covered", "postgres"],
    ]);
  });

  it("marks multi-word skills weak when all content words share one line", () => {
    const merged = skills("Model deployment", "Kubernetes");
    const [deployment, k8s] = classifyCoverage(merged, resume);
    expect(deployment).toMatchObject({
      coverage: "weak",
      matchedTerm: "Model deployment",
    });
    expect(deployment.evidence).toHaveLength(1);
    expect(k8s.coverage).toBe("covered");
  });

  it("marks a one-word skill weak when the resume uses another word form", () => {
    const text = "• Communicated weekly status to stakeholders.\n• Statistical analysis of churn.";
    const merged = skills("Communication", "Statistics", {
      canonical_skill: "Communication skills",
      jd_phrase: "strong communication skills",
    });
    const result = classifyCoverage(merged, text);
    expect(result.map((r) => [r.coverage, r.evidence])).toEqual([
      ["weak", ["• Communicated weekly status to stakeholders."]],
      ["weak", ["• Statistical analysis of churn."]],
    ]);
  });

  it("does not loosely match tools or short words", () => {
    const text = "Dockerized services; led the team; owned delivery.";
    const merged = skills({ canonical_skill: "Docker", category: "tool" }, "Leadership", "Owner");
    expect(classifyCoverage(merged, text).map((r) => r.coverage)).toEqual([
      "missing",
      "missing",
      "missing",
    ]);
  });

  it("does not mark words spread across lines as weak", () => {
    // "retrieval" and "ranking" appear, but on different lines.
    const [skill] = classifyCoverage(skills("Retrieval ranking"), resume);
    expect(skill.coverage).toBe("missing");
  });

  it("marks absent skills missing", () => {
    const merged = skills("Rust", "Go", "C", "Terraform");
    const result = byName(["Rust", "Go", "C", "Terraform"], classifyCoverage(merged, resume));
    // "go-to-market" must not count as Go; "C++" must not count as C.
    expect(result.Go.coverage).toBe("missing");
    expect(result.C.coverage).toBe("missing");
    expect(result.Rust.coverage).toBe("missing");
    expect(result.Terraform).toEqual({
      key: "terraform",
      coverage: "missing",
      matchedTerm: null,
      evidence: [],
    });
  });

  it("matches C++ exactly", () => {
    const [cpp] = classifyCoverage(skills("C++"), resume);
    expect(cpp.coverage).toBe("covered");
  });

  it("covers via a JD's own wording when it appears in the resume", () => {
    const merged = skills({ canonical_skill: "Vector search", jd_phrase: "pgvector" });
    const [skill] = classifyCoverage(merged, resume);
    expect(skill).toMatchObject({ coverage: "covered", matchedTerm: "pgvector" });
  });

  it("caps evidence at three lines", () => {
    const text = ["SQL one", "SQL two", "SQL three", "SQL four"].join("\n");
    const [sql] = classifyCoverage(skills("SQL"), text);
    expect(sql.evidence).toEqual(["SQL one", "SQL two", "SQL three"]);
  });
});

describe("semanticWeakMatches", () => {
  const vectors: Record<string, number[]> = {
    "Deploy models to cloud platforms": [1, 0, 0],
    "Terraform, Pulumi": [0, 1, 0],
  };
  const quoteVector = (quote: string) => vectors[quote];
  const candidate = (over: Partial<SemanticCandidate>): SemanticCandidate => ({
    key: "cloud-deployment",
    category: "hard_skill",
    coverage: "missing",
    mentions: [{ evidenceQuote: "Deploy models to cloud platforms" }],
    ...over,
  });
  const bullets = [
    { text: "Wrote the team style guide", vector: [0, 0, 1] },
    { text: "Shipped 14 models to production", vector: [0.9, 0.1, 0] },
    { text: "Deployed a model on GCP", vector: [0.8, 0, 0.3] },
    { text: "Managed Terraform modules", vector: [0.1, 1, 0] },
  ];

  it("marks a missing skill weak when a requirement line is close to a bullet", () => {
    const matches = semanticWeakMatches([candidate({})], bullets, quoteVector, 0.8);
    expect(matches.get("cloud-deployment")).toEqual([
      "Shipped 14 models to production",
      "Deployed a model on GCP",
    ]);
  });

  it("leaves skills below the threshold, already matched, or tools alone", () => {
    expect(semanticWeakMatches([candidate({})], bullets, quoteVector, 0.999).size).toBe(0);
    // Each of these would clear 0.9 if it were checked.
    const matches = semanticWeakMatches(
      [
        candidate({ key: "covered", coverage: "covered" }),
        candidate({
          key: "terraform",
          category: "tool",
          mentions: [{ evidenceQuote: "Terraform, Pulumi" }],
        }),
        candidate({ key: "no-vector", mentions: [{ evidenceQuote: "unknown" }] }),
      ],
      bullets,
      quoteVector,
      0.9,
    );
    expect(matches.size).toBe(0);
  });
});
