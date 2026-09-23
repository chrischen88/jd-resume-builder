import { describe, expect, it } from "vitest";

import { classifyCoverage } from "./coverage";
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
