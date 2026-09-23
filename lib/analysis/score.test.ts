import { describe, expect, it } from "vitest";

import { DEFAULT_SCORING_WEIGHTS } from "./config";
import { mergeSkills } from "./merge";
import { scoreSkills, type JobText } from "./score";
import { findPhraseOffsets } from "./text";
import type { ExtractedKeyword, JobKeywords } from "./types";

function kw(
  canonical_skill: string,
  evidence_quote: string,
  overrides: Partial<ExtractedKeyword> = {},
): ExtractedKeyword {
  return {
    jd_phrase: canonical_skill,
    canonical_skill,
    category: "hard_skill",
    importance: "required",
    evidence_quote,
    ...overrides,
  };
}

// Filler pushes later sentences out of the first third.
const filler = " Our team ships products that customers love every day.".repeat(10);

describe("findPhraseOffsets", () => {
  it("matches whole phrases case-insensitively", () => {
    expect(findPhraseOffsets("Python, python3 and PYTHON.", "python")).toEqual([0, 20]);
  });

  it("handles symbols like C++ and C#", () => {
    expect(findPhraseOffsets("C++ and C# and C", "C++")).toEqual([0]);
    expect(findPhraseOffsets("C++ and C# and C", "C")).toEqual([15]);
  });

  it("ignores empty phrases", () => {
    expect(findPhraseOffsets("anything", "  ")).toEqual([]);
  });
});

describe("scoreSkills", () => {
  const ln = Math.log;

  it("applies the SPEC formula per JD", () => {
    const text = `Requirements: Python and SQL.${filler} We love Python.`;
    const jobs: JobText[] = [{ jobId: "j1", title: "Python Engineer", text }];
    const keywords: JobKeywords[] = [
      {
        jobId: "j1",
        keywords: [
          kw("Python", "Requirements: Python and SQL."),
          kw("SQL", "Requirements: Python and SQL.", { importance: "preferred" }),
        ],
      },
    ];

    const [python, sql] = scoreSkills(mergeSkills(keywords), jobs);

    // Python: required, appears twice, in title, first mention early.
    expect(python.perJob[0]).toMatchObject({
      importance: "required",
      frequency: 2,
      inTitle: true,
      inFirstThird: true,
    });
    expect(python.demandScore).toBeCloseTo(3 + ln(3) + 1 + 0.5);
    // SQL: preferred, once, not in title, early.
    expect(sql.demandScore).toBeCloseTo(1.5 + ln(2) + 0.5);
  });

  it("counts the highest importance per JD once, not both", () => {
    const text = "Must know Docker. Docker Compose is a plus.";
    const [docker] = scoreSkills(
      mergeSkills([
        {
          jobId: "j1",
          keywords: [
            kw("Docker", "Must know Docker."),
            kw("Docker", "Docker Compose is a plus.", { importance: "preferred" }),
          ],
        },
      ]),
      [{ jobId: "j1", text }],
    );
    expect(docker.perJob[0].importance).toBe("required");
    expect(docker.demandScore).toBeCloseTo(3 + ln(3) + 0.5);
  });

  it("detects mentions that only appear late in the JD", () => {
    const text = `About us.${filler} Nice to have: Rust.`;
    const [rust] = scoreSkills(
      mergeSkills([
        { jobId: "j1", keywords: [kw("Rust", "Nice to have: Rust.", { importance: "mentioned" })] },
      ]),
      [{ jobId: "j1", text }],
    );
    expect(rust.perJob[0]).toMatchObject({ inFirstThird: false, inTitle: false });
    expect(rust.demandScore).toBeCloseTo(ln(2));
  });

  it("never counts fewer occurrences than extracted mentions", () => {
    // The model paraphrased: "ML" never appears verbatim.
    const [ml] = scoreSkills(
      mergeSkills([
        {
          jobId: "j1",
          keywords: [kw("Machine learning", "You will train models.", { jd_phrase: "train models" })],
        },
      ]),
      [{ jobId: "j1", text: "Other text. You will train models." }],
    );
    expect(ml.perJob[0].frequency).toBe(1);
  });

  it("counts only wordings seen in the JDs, not every curated alias", () => {
    const text = "We use ML daily. Machine learning experience required.";
    const [ml] = scoreSkills(
      mergeSkills([
        { jobId: "j1", keywords: [kw("Machine learning", "Machine learning experience required.")] },
      ]),
      [{ jobId: "j1", text }],
    );
    // "ML" is a curated alias but no JD used it as a phrase, so it isn't
    // counted. Deliberate: counting every alias would let short ones like
    // "go" or "node" inflate frequency on ordinary words.
    expect(ml.perJob[0].frequency).toBe(1);
  });

  it("sums across JDs, counts JDs, and flags must-do skills", () => {
    const jobs: JobText[] = ["j1", "j2", "j3", "j4"].map((jobId) => ({
      jobId,
      text: "Python required. SQL preferred.",
    }));
    const keywords: JobKeywords[] = [
      { jobId: "j1", keywords: [kw("Python", "Python required.")] },
      { jobId: "j2", keywords: [kw("python", "Python required.")] },
      { jobId: "j3", keywords: [kw("SQL", "SQL preferred.", { importance: "preferred" })] },
    ];

    const [python, sql] = scoreSkills(mergeSkills(keywords), jobs);

    expect(python).toMatchObject({ jdCount: 2, requiredCount: 2, mustDo: true, rank: 1 });
    expect(sql).toMatchObject({ jdCount: 1, requiredCount: 0, mustDo: false, rank: 2 });
    expect(python.demandScore).toBeCloseTo(2 * (3 + ln(2) + 0.5));
  });

  it("breaks ties by JD count, then required count, then name", () => {
    // Both early and once each, so their scores tie exactly.
    const jobs: JobText[] = [{ jobId: "j1", text: `Beta. Alpha.${filler}` }];
    const keywords: JobKeywords[] = [
      {
        jobId: "j1",
        keywords: [
          kw("Beta", "Beta.", { importance: "mentioned" }),
          kw("Alpha", "Alpha.", { importance: "mentioned" }),
        ],
      },
    ];
    const ranked = scoreSkills(mergeSkills(keywords), jobs);
    expect(ranked.map((d) => [d.name, d.rank])).toEqual([
      ["Alpha", 1],
      ["Beta", 2],
    ]);
  });

  it("uses custom weights", () => {
    const [python] = scoreSkills(
      mergeSkills([{ jobId: "j1", keywords: [kw("Python", "Python.")] }]),
      [{ jobId: "j1", text: "Python." }],
      { ...DEFAULT_SCORING_WEIGHTS, required: 10, frequency: 0, inFirstThird: 0 },
    );
    expect(python.demandScore).toBeCloseTo(10);
  });

  it("rejects skills that reference a job it wasn't given", () => {
    expect(() =>
      scoreSkills(mergeSkills([{ jobId: "missing", keywords: [kw("Go", "Go.")] }]), []),
    ).toThrow(/unknown job/);
  });
});
