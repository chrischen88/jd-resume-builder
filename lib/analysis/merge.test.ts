import { describe, expect, it } from "vitest";

import { buildLexicon, mergeSkills, skillKey } from "./merge";
import { SKILL_SYNONYMS } from "./synonyms";
import type { ExtractedKeyword, JobKeywords } from "./types";

function kw(
  canonical_skill: string,
  overrides: Partial<ExtractedKeyword> = {},
): ExtractedKeyword {
  return {
    jd_phrase: canonical_skill,
    canonical_skill,
    category: "hard_skill",
    importance: "required",
    evidence_quote: `Experience with ${canonical_skill}.`,
    ...overrides,
  };
}

function job(jobId: string, ...keywords: ExtractedKeyword[]): JobKeywords {
  return { jobId, keywords };
}

describe("skillKey", () => {
  it("ignores case, spacing, hyphens, slashes, and dots", () => {
    expect(skillKey("A/B Testing")).toBe(skillKey("ab testing"));
    expect(skillKey("Fine-tuning")).toBe(skillKey("fine tuning"));
    expect(skillKey("Node.js")).toBe(skillKey("NodeJS"));
    expect(skillKey("CI/CD")).toBe(skillKey("ci-cd"));
  });

  it("keeps C, C++, and C# distinct", () => {
    const keys = new Set([skillKey("C"), skillKey("C++"), skillKey("C#")]);
    expect(keys.size).toBe(3);
  });

  it("treats & as and", () => {
    expect(skillKey("Research & Development")).toBe(skillKey("research and development"));
  });
});

describe("SKILL_SYNONYMS", () => {
  it("never maps one alias to two canonical skills", () => {
    const owner = new Map<string, string>();
    for (const [canonical, aliases] of Object.entries(SKILL_SYNONYMS)) {
      for (const name of [canonical, ...aliases]) {
        const key = skillKey(name);
        expect(owner.get(key) ?? canonical, `"${name}" is claimed twice`).toBe(canonical);
        owner.set(key, canonical);
      }
    }
  });
});

describe("mergeSkills", () => {
  it("merges synonyms across JDs under the curated name and keeps each JD's phrase", () => {
    const merged = mergeSkills([
      job("j1", kw("ML", { jd_phrase: "ML systems" })),
      job("j2", kw("machine learning", { jd_phrase: "machine learning models" })),
      job("j3", kw("Machine Learning")),
    ]);

    expect(merged).toHaveLength(1);
    const [ml] = merged;
    expect(ml.name).toBe("Machine learning");
    expect(ml.jobIds).toEqual(["j1", "j2", "j3"]);
    expect(ml.mentions.map((m) => m.jdPhrase)).toEqual([
      "ML systems",
      "machine learning models",
      "Machine Learning",
    ]);
    expect(ml.variants).toEqual(["ML systems", "ML", "machine learning models"]);
    expect(ml.aliases).toEqual(["Machine learning", "ml"]);
  });

  it("falls back to the JD phrase when the model's canonical name is unknown", () => {
    const merged = mergeSkills([
      job("j1", kw("LLM-based agent systems", { jd_phrase: "agents" })),
      job("j2", kw("AI agents")),
    ]);
    expect(merged.map((s) => s.name)).toEqual(["AI agents"]);
    expect(merged[0].jobIds).toEqual(["j1", "j2"]);
  });

  it("groups uncurated skills by key and names them by the most common spelling", () => {
    const merged = mergeSkills([
      job("j1", kw("Supply chain optimization")),
      job("j2", kw("supply-chain optimization")),
      job("j3", kw("Supply chain optimization")),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Supply chain optimization");
    expect(merged[0].key).toBe(skillKey("supply chain optimization"));
    expect(merged[0].aliases).toEqual([]);
  });

  it("keeps repeated mentions within one JD but lists the JD once", () => {
    const [python] = mergeSkills([
      job("j1", kw("Python"), kw("python", { importance: "preferred", jd_phrase: "Python 3" })),
    ]);
    expect(python.mentions).toHaveLength(2);
    expect(python.jobIds).toEqual(["j1"]);
  });

  it("keeps related-but-different skills separate", () => {
    const merged = mergeSkills([job("j1", kw("A/B testing"), kw("Experimentation"))]);
    expect(merged.map((s) => s.name)).toEqual(["A/B testing", "Experimentation"]);
  });

  it("picks the most common category, first-seen on ties", () => {
    const [skill] = mergeSkills([
      job("j1", kw("Kubernetes", { category: "tool" })),
      job("j2", kw("k8s", { category: "hard_skill" })),
      job("j3", kw("Kubernetes", { category: "tool" })),
    ]);
    expect(skill.category).toBe("tool");
  });

  it("lets user synonyms override the built-in map", () => {
    const merged = mergeSkills(
      [job("j1", kw("Evals")), job("j2", kw("Offline evaluation"))],
      { synonyms: { "Model evaluation": ["evals", "offline evaluation"] } },
    );
    expect(merged.map((s) => s.name)).toEqual(["Model evaluation"]);
    expect(merged[0].aliases).toEqual(["Model evaluation", "evals", "offline evaluation"]);
  });

  it("is deterministic and preserves first-seen order", () => {
    const input = [
      job("j1", kw("Python"), kw("SQL")),
      job("j2", kw("PyTorch"), kw("python")),
    ];
    const first = mergeSkills(input);
    expect(first.map((s) => s.name)).toEqual(["Python", "SQL", "PyTorch"]);
    expect(mergeSkills(input)).toEqual(first);
  });

  it("skips names that are only punctuation", () => {
    expect(mergeSkills([job("j1", kw("—", { jd_phrase: "—" }))])).toEqual([]);
  });
});

describe("buildLexicon", () => {
  it("resolves every alias to its canonical name", () => {
    const lexicon = buildLexicon({ PostgreSQL: ["postgres", "psql"] });
    expect(lexicon.canonicalByKey.get(skillKey("Postgres"))).toBe("PostgreSQL");
    expect(lexicon.canonicalByKey.get(skillKey("postgresql"))).toBe("PostgreSQL");
  });
});
