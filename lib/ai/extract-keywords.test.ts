import { AIMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiGuardrailLog } from "./client";
import { extractJobKeywords } from "./extract-keywords";
import { createChatModel, type StructuredChat } from "./models";
import { extractKeywordsPrompt, extractKeywordsSchema } from "./prompts/extract-keywords";

const jd = `Acme AI — Senior ML Engineer
Requirements
- 5+ years building ML systems in Python.
Nice to have
- Experience with Kubernetes.`;

function chatReturning(output: unknown) {
  const invoke = vi.fn<StructuredChat["invoke"]>().mockResolvedValue(
    new AIMessage({
      content: JSON.stringify(output),
      response_metadata: { stop_reason: "end_turn" },
      usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    }),
  );
  const chat: StructuredChat = { config: { provider: "anthropic", model: "test" }, invoke };
  return { chat, invoke };
}

const modelOutput = {
  job: { company: " Acme AI ", title: "Senior ML Engineer", seniority: "senior", years_experience_min: 5 },
  keywords: [
    {
      evidence_quote: "5+ years building ML systems in Python.",
      jd_phrase: "Python",
      canonical_skill: "Python",
      category: "tool",
      importance: "required",
    },
    {
      evidence_quote: "5+ years building ML systems in Python.",
      jd_phrase: "ML systems",
      canonical_skill: "Machine learning",
      category: "hard_skill",
      importance: "required",
    },
    {
      evidence_quote: "Experience with Kubernetes.",
      jd_phrase: "Kubernetes",
      canonical_skill: "Kubernetes",
      category: "tool",
      importance: "preferred",
    },
    {
      // Hallucinated: not in the JD.
      evidence_quote: "Experience with Terraform.",
      jd_phrase: "Terraform",
      canonical_skill: "Terraform",
      category: "tool",
      importance: "preferred",
    },
  ],
};

describe("extractJobKeywords", () => {
  it("returns grounded keywords and cleaned job details, and logs counts only", async () => {
    const { chat, invoke } = chatReturning(modelOutput);
    const guardrails: AiGuardrailLog[] = [];

    const result = await extractJobKeywords(jd, {
      chat,
      logger: () => {},
      guardrailLogger: (entry) => guardrails.push(entry),
    });

    expect(invoke.mock.calls[0][0]).toMatchObject({
      schemaName: "extract_keywords",
      messages: [{ role: "user", content: `<job_description>\n${jd}\n</job_description>` }],
    });
    expect(result.job).toEqual({
      company: "Acme AI",
      title: "Senior ML Engineer",
      seniority: "senior",
      years_experience_min: 5,
    });
    expect(result.keywords.map((k) => k.canonical_skill)).toEqual([
      "Python",
      "Machine learning",
      "Kubernetes",
    ]);
    expect(result.dropped.quoteNotFound).toBe(1);
    expect(result.promptVersion).toBe(extractKeywordsPrompt.version);
    expect(guardrails).toEqual([
      {
        prompt_id: "extract_keywords",
        prompt_version: extractKeywordsPrompt.version,
        counts: {
          extracted: 4,
          kept: 3,
          dropped_quote_not_found: 1,
          dropped_phrase_not_found: 0,
          dropped_empty: 0,
          duplicates: 0,
        },
      },
    ]);
    expect(JSON.stringify(guardrails)).not.toContain("Terraform");
  });

  it("nulls out blank or negative job fields", async () => {
    const { chat } = chatReturning({
      ...modelOutput,
      job: { company: " ", title: null, seniority: null, years_experience_min: -1 },
    });
    const result = await extractJobKeywords(jd, {
      chat,
      logger: () => {},
      guardrailLogger: () => {},
    });
    expect(result.job).toEqual({
      company: null,
      title: null,
      seniority: null,
      years_experience_min: null,
    });
  });
});

describe("extractKeywordsSchema", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds a structured-output request for both providers", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test");
    vi.stubEnv("OPENAI_API_KEY", "test");
    for (const provider of ["anthropic", "openai"] as const) {
      const model = createChatModel({ provider, model: "m" }, { maxTokens: 1000 });
      expect(() =>
        model.withStructuredOutput(extractKeywordsSchema, {
          method: "jsonSchema",
          name: "extract_keywords",
        }),
      ).not.toThrow();
    }
  });
});
