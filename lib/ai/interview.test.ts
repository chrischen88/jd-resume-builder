import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { AiGuardrailLog } from "./client";
import { askFollowUp, checkClaims, writeBullet } from "./interview";
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

const quiet = { logger: () => {}, guardrailLogger: () => {} };

const ctx = {
  skill: "A/B testing",
  category: "hard_skill",
  response: "yes" as const,
  role: "Analyst, Acme (2021 – Present)",
  jdSentences: ["Design and analyze A/B tests."],
  followUps: [{ question: "What did you test?", answer: "Checkout page changes" }],
};

describe("askFollowUp", () => {
  it("returns the question, or null when done", async () => {
    let { chat } = chatReturning({ done: false, question: "  How many tests\n did you run? " });
    expect(await askFollowUp(ctx, { chat, ...quiet })).toEqual({
      question: "How many tests did you run?",
    });
    ({ chat } = chatReturning({ done: true, question: null }));
    expect(await askFollowUp(ctx, { chat, ...quiet })).toEqual({ question: null });
  });
});

describe("writeBullet", () => {
  const writeCtx = {
    skill: "A/B testing",
    phrase: "A/B tests",
    response: "yes" as const,
    role: "Analyst, Acme",
    currentRole: true,
    seniority: "mid",
    otherSkills: ["SQL"],
    answers: [{ question: "What did you test?", answer: "Checkout page changes" }],
  };
  const evidence = {
    situation: null,
    action: "Tested checkout changes",
    tools: [],
    scale: null,
    result: null,
    metric: null,
  };

  it("keeps up to two cleaned variants", async () => {
    const { chat, invoke } = chatReturning({
      variants: [
        { text: "• Run A/B tests on checkout changes", claims: ["Ran A/B tests", " "] },
        { text: "Test checkout  changes with A/B tests", claims: [] },
        { text: "A third one", claims: [] },
      ],
      evidence,
    });
    const draft = await writeBullet(writeCtx, { chat, ...quiet });
    expect(draft.variants).toEqual([
      { text: "Run A/B tests on checkout changes", claims: ["Ran A/B tests"] },
      { text: "Test checkout changes with A/B tests", claims: [] },
    ]);
    expect(draft.evidence.action).toBe("Tested checkout changes");
    expect(invoke.mock.calls[0][0].messages[0].content).toContain("<answers>");
  });

  it("fails when no bullet comes back", async () => {
    const { chat } = chatReturning({ variants: [{ text: " ", claims: [] }], evidence });
    await expect(writeBullet(writeCtx, { chat, ...quiet })).rejects.toThrow("No bullet text");
  });
});

describe("checkClaims", () => {
  const sources = ["What did you test? Checkout page changes, about 12 tests"];

  it("keeps only claims backed by a real quote, and flags new numbers", async () => {
    const { chat } = chatReturning({
      claims: [
        {
          claim: "Tested checkout page changes",
          supported: true,
          support_quote: "Checkout page changes",
        },
        { claim: "Ran 12 tests", supported: true, support_quote: "about 12 tests" },
        // The model says supported, but the quote isn't in the sources.
        { claim: "Led the testing program", supported: true, support_quote: "led the program" },
        { claim: "Lifted conversion", supported: false, support_quote: null },
      ],
    });
    const logs: AiGuardrailLog[] = [];
    const result = await checkClaims(
      "Led 12 A/B tests on checkout changes, lifting conversion 4%",
      [],
      sources,
      { chat, logger: () => {}, guardrailLogger: (e) => logs.push(e) },
    );
    expect(result.unverified).toEqual([
      "Led the testing program",
      "Lifted conversion",
      "The number 4 isn't in your answers",
    ]);
    expect(result.claims).toHaveLength(4);
    expect(logs[0].counts).toMatchObject({ quote_not_found: 1, unsupported_numbers: 1 });
    expect(JSON.stringify(logs)).not.toContain("checkout");
  });
});
