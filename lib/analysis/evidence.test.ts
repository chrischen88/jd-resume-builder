import { describe, expect, it } from "vitest";

import { checkEvidence, narrowListPhrase, normalizeForMatch } from "./evidence";
import type { ExtractedKeyword } from "./types";

const jd = `About the role
We build “agentic” systems for advertisers.

Requirements
•  3+ years of Python and SQL experience.
- Experience deploying ML models to production — ideally on AWS.`;

function kw(overrides: Partial<ExtractedKeyword>): ExtractedKeyword {
  return {
    jd_phrase: "Python",
    canonical_skill: "Python",
    category: "tool",
    importance: "required",
    evidence_quote: "3+ years of Python and SQL experience.",
    ...overrides,
  };
}

describe("normalizeForMatch", () => {
  it("normalizes case, whitespace, quotes, dashes, and bullets only", () => {
    expect(normalizeForMatch("•  “Hi” — it’s\n\tok")).toBe(`"hi" - it's ok`);
  });
});

describe("narrowListPhrase", () => {
  it("narrows a list to the skill, keeping the JD's spelling", () => {
    expect(narrowListPhrase("PyTorch, TensorFlow, scikit-learn", "TensorFlow")).toBe("TensorFlow");
    expect(narrowListPhrase("technologies like Spark, Airflow, dbt", "spark")).toBe("Spark");
    expect(narrowListPhrase("ML frameworks (PyTorch, TensorFlow)", "ML frameworks")).toBe(
      "ML frameworks",
    );
  });

  it("leaves non-lists and lists without the skill's name alone", () => {
    expect(narrowListPhrase("production ML systems", "Machine learning")).toBe(
      "production ML systems",
    );
    expect(narrowListPhrase("Python, Go, or Java", "Golang")).toBe("Python, Go, or Java");
  });
});

describe("checkEvidence", () => {
  it("keeps grounded items", () => {
    const { kept } = checkEvidence(jd, [kw({})]);
    expect(kept).toEqual([kw({})]);
  });

  it("drops items whose quote isn't in the JD", () => {
    const result = checkEvidence(jd, [
      kw({ evidence_quote: "5+ years of Python experience." }),
      kw({ evidence_quote: "Experience with Kubernetes." }),
    ]);
    expect(result.kept).toEqual([]);
    expect(result.droppedQuoteNotFound).toBe(2);
  });

  it("treats a changed or missing word as not verbatim", () => {
    const result = checkEvidence(jd, [
      kw({ evidence_quote: "3+ years of Python and SQL expertise." }),
      kw({ evidence_quote: "3+ years of Python SQL experience." }),
    ]);
    expect(result.droppedQuoteNotFound).toBe(2);
  });

  it("tolerates letter case and a period added to a fragment, returning the JD's own text", () => {
    const { kept } = checkEvidence(jd, [
      kw({ evidence_quote: "3+ YEARS of python and sql experience." }),
      kw({
        jd_phrase: "ML models",
        canonical_skill: "Machine learning",
        evidence_quote: "experience deploying ML models to production.",
      }),
    ]);
    expect(kept.map((k) => k.evidence_quote)).toEqual([
      "3+ years of Python and SQL experience.",
      "Experience deploying ML models to production",
    ]);
  });

  it("tolerates whitespace, curly quotes, and dash differences, and returns the exact JD text", () => {
    const { kept } = checkEvidence(jd, [
      kw({
        jd_phrase: "deploying ML models to production",
        canonical_skill: "Model deployment",
        evidence_quote: "Experience deploying ML models to production - ideally on AWS.",
      }),
      kw({
        jd_phrase: "agentic",
        canonical_skill: "AI agents",
        category: "hard_skill",
        importance: "mentioned",
        evidence_quote: 'We build "agentic" systems for advertisers.',
      }),
    ]);
    expect(kept.map((k) => k.evidence_quote)).toEqual([
      "Experience deploying ML models to production — ideally on AWS.",
      "We build “agentic” systems for advertisers.",
    ]);
    for (const k of kept) expect(jd).toContain(k.evidence_quote);
  });

  it("accepts a quote missing its bullet or trailing period", () => {
    const { kept } = checkEvidence(jd, [kw({ evidence_quote: "3+ years of Python and SQL experience" })]);
    expect(kept).toHaveLength(1);
  });

  it("drops items whose phrase isn't in their quote", () => {
    const result = checkEvidence(jd, [
      kw({ jd_phrase: "Python 3" }),
      // In the JD, but not in this quote.
      kw({ jd_phrase: "AWS", canonical_skill: "AWS" }),
    ]);
    expect(result.kept).toEqual([]);
    expect(result.droppedPhraseNotFound).toBe(2);
  });

  it("narrows a list-shaped jd_phrase to the one skill", () => {
    const listJd = "Experience with PyTorch, TensorFlow, or JAX.";
    const { kept } = checkEvidence(listJd, [
      kw({ jd_phrase: "PyTorch, TensorFlow, or JAX", canonical_skill: "TensorFlow", evidence_quote: listJd }),
    ]);
    expect(kept.map((k) => k.jd_phrase)).toEqual(["TensorFlow"]);
  });

  it("drops empty items and exact duplicates, and trims names", () => {
    const result = checkEvidence(jd, [
      kw({ canonical_skill: "  Python " }),
      kw({}),
      kw({ canonical_skill: " " }),
      kw({ evidence_quote: "" }),
    ]);
    expect(result.kept).toEqual([kw({})]);
    expect(result.duplicates).toBe(1);
    expect(result.droppedEmpty).toBe(2);
  });

  it("keeps the same skill at different importance levels", () => {
    const { kept } = checkEvidence(jd, [kw({}), kw({ importance: "preferred" })]);
    expect(kept).toHaveLength(2);
  });
});
