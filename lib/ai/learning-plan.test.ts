import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { AiGuardrailLog } from "./client";
import { planLearning } from "./learning-plan";
import type { StructuredChat } from "./models";

function chatReturning(output: unknown) {
  const invoke = vi.fn<StructuredChat["invoke"]>().mockResolvedValue(
    new AIMessage({
      content: JSON.stringify(output),
      response_metadata: { stop_reason: "end_turn" },
      usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
  );
  const chat: StructuredChat = { config: { provider: "anthropic", model: "test" }, invoke };
  return { chat, invoke };
}

const ctx = {
  skill: "A/B testing",
  category: "hard_skill",
  response: "no" as const,
  phrases: ["A/B tests", "experimentation"],
  jdSentences: ["Design and analyze A/B tests with Optimizely."],
  jdCount: 3,
  jobCount: 5,
  nearbySkills: ["SQL", "Python"],
};

describe("planLearning", () => {
  it("cleans the plan and drops resources that name things", async () => {
    const { chat, invoke } = chatReturning({
      meaning: "  Running controlled experiments\n on product changes. ",
      related_skills: ["Statistics", "A/B testing", "SQL"],
      resources: [
        { kind: "course", description: "An intro statistics course covering hypothesis tests." },
        { kind: "certification", description: "Google's Analytics certificate." },
        { kind: "project", description: "Analyze a public A/B test dataset in Python." },
        { kind: "on_the_job", description: "Visit www.example.com for ideas." },
      ],
    });
    const logs: AiGuardrailLog[] = [];
    const plan = await planLearning(ctx, {
      chat,
      logger: () => {},
      guardrailLogger: (e) => logs.push(e),
    });

    expect(plan).toEqual({
      meaning: "Running controlled experiments on product changes.",
      relatedSkills: ["Statistics", "SQL"],
      resources: [
        { kind: "course", description: "An intro statistics course covering hypothesis tests." },
        { kind: "project", description: "Analyze a public A/B test dataset in Python." },
      ],
      promptVersion: "1.0.0",
    });
    expect(logs[0].counts).toMatchObject({
      resources: 4,
      resources_kept: 2,
      dropped_unknown_name: 1,
      dropped_url: 1,
    });
    // The input carries the JD context and the person's skills.
    const input = JSON.stringify(invoke.mock.calls[0]);
    expect(input).toContain("3 of 5 job descriptions");
    expect(input).toContain("Design and analyze A/B tests with Optimizely.");
    expect(input).toContain("Python");
  });
});
