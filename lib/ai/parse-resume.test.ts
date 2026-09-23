import { AIMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiGuardrailLog } from "./client";
import { createChatModel, type StructuredChat } from "./models";
import { parseResumeText } from "./parse-resume";
import {
  parseResumePrompt,
  parseResumeSchema,
  type ParseResumeOutput,
} from "./prompts/parse-resume";

const resume = `Jordan Rivera
Senior Engineer, Northwind (2022 – Present)
• Built the serving platform.`;

const output: ParseResumeOutput = {
  contact: { name: "Jordan Rivera", email: null, phone: null, location: null, links: [] },
  summary: null,
  roles: [
    {
      employer: "Northwind",
      title: "Senior Engineer",
      location: null,
      start_date: "2022",
      end_date: "Present",
      bullets: ["Built the serving platform.", "Managed a $2M budget."],
    },
  ],
  skills: [],
  education: [],
  certifications: [],
  other: [],
};

function chatReturning(value: unknown) {
  const invoke = vi.fn<StructuredChat["invoke"]>().mockResolvedValue(
    new AIMessage({
      content: JSON.stringify(value),
      response_metadata: { stop_reason: "end_turn" },
      usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    }),
  );
  const chat: StructuredChat = { config: { provider: "anthropic", model: "test" }, invoke };
  return { chat, invoke };
}

describe("parseResumeText", () => {
  it("returns the grounded resume and logs counts, never text", async () => {
    const { chat, invoke } = chatReturning(output);
    const guardrails: AiGuardrailLog[] = [];
    const result = await parseResumeText(resume, {
      chat,
      logger: () => {},
      guardrailLogger: (entry) => guardrails.push(entry),
    });

    expect(invoke.mock.calls[0][0]).toMatchObject({
      schemaName: "parse_resume",
      messages: [{ role: "user", content: `<resume>\n${resume}\n</resume>` }],
    });
    expect(result.resume.roles[0].bullets).toHaveLength(2);
    expect(result.issues).toEqual([
      { path: "roles[0].bullets[1]", value: "Managed a $2M budget." },
    ]);
    expect(result.promptVersion).toBe(parseResumePrompt.version);
    expect(guardrails).toEqual([
      {
        prompt_id: "parse_resume",
        prompt_version: parseResumePrompt.version,
        counts: { roles: 1, bullets: 2, values_checked: 7, values_not_in_resume: 1 },
      },
    ]);
    expect(JSON.stringify(guardrails)).not.toContain("Northwind");
  });
});

describe("parseResumeSchema", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds a structured-output request for both providers", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test");
    vi.stubEnv("OPENAI_API_KEY", "test");
    for (const provider of ["anthropic", "openai"] as const) {
      const model = createChatModel({ provider, model: "m" }, { maxTokens: 1000 });
      expect(() =>
        model.withStructuredOutput(parseResumeSchema, {
          method: "jsonSchema",
          name: "parse_resume",
        }),
      ).not.toThrow();
    }
  });
});
