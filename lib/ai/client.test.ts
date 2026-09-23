import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiOutputError, callStructured, type AiCallLog } from "./client";
import type { ProviderName, StructuredChat } from "./models";
import type { PromptDefinition } from "./prompts/types";

const prompt: PromptDefinition<z.ZodObject<{ skills: z.ZodArray<z.ZodString> }>> = {
  id: "test_prompt",
  version: "1.0.0",
  system: "Extract skills.",
  schema: z.object({ skills: z.array(z.string()) }),
};

// Anthropic-shaped AIMessage, as ChatAnthropic returns it.
function reply(
  text: string,
  stop_reason = "end_turn",
  iterations: { type: string }[] = [],
): AIMessage {
  return new AIMessage({
    content: text,
    response_metadata: { stop_reason, usage: { iterations } },
    usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
}

function fakeChat(...responses: AIMessage[]) {
  const invoke = vi.fn<StructuredChat["invoke"]>();
  for (const r of responses) invoke.mockResolvedValueOnce(r);
  const chat: StructuredChat = {
    config: { provider: "anthropic" as ProviderName, model: "test-model" },
    invoke,
  };
  return { chat, complete: invoke };
}

function collectLogs() {
  const logs: AiCallLog[] = [];
  return { logs, logger: (entry: AiCallLog) => logs.push(entry) };
}

describe("callStructured", () => {
  it("returns validated data on the first valid response", async () => {
    const { chat, complete } = fakeChat(reply('{"skills":["SQL"]}'));
    const { logs, logger } = collectLogs();

    const result = await callStructured(prompt, "JD text", { chat, logger });

    expect(result.data).toEqual({ skills: ["SQL"] });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toMatchObject({
      schemaName: "test_prompt",
      system: "Extract skills.",
      messages: [{ role: "user", content: "JD text" }],
      maxTokens: 16000,
    });
    expect(logs).toEqual([
      expect.objectContaining({
        prompt_id: "test_prompt",
        prompt_version: "1.0.0",
        provider: "anthropic",
        model: "test-model",
        outcome: "ok",
        input_tokens: 10,
        output_tokens: 5,
        guardrail_flags: [],
      }),
    ]);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const { chat, complete } = fakeChat(
      reply('{"skills":"SQL"}'),
      reply('{"skills":["SQL"]}'),
    );
    const { logs, logger } = collectLogs();

    const result = await callStructured(prompt, "JD text", { chat, logger });

    expect(result.data).toEqual({ skills: ["SQL"] });
    expect(result.attempts).toBe(2);
    expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 10 });
    const retryMessages = complete.mock.calls[1][0].messages;
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[1]).toEqual({ role: "assistant", content: '{"skills":"SQL"}' });
    expect(retryMessages[2].content).toContain("skills");
    expect(logs[0].guardrail_flags).toEqual(["schema_retry"]);
  });

  it("throws after a second invalid response", async () => {
    const { chat, complete } = fakeChat(reply("not json"), reply("{}"));
    const { logs, logger } = collectLogs();

    await expect(callStructured(prompt, "JD text", { chat, logger })).rejects.toMatchObject({
      name: "AiOutputError",
      reason: "invalid_output",
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(logs[0]).toMatchObject({
      outcome: "invalid_output",
      guardrail_flags: ["schema_retry", "schema_failure"],
    });
  });

  it("throws on refusal without retrying", async () => {
    const { chat, complete } = fakeChat(reply("", "refusal"));
    const { logger } = collectLogs();

    await expect(callStructured(prompt, "x", { chat, logger })).rejects.toBeInstanceOf(
      AiOutputError,
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("throws on truncated output without retrying", async () => {
    const { chat, complete } = fakeChat(reply('{"skills":["S', "max_tokens"));
    const { logger } = collectLogs();

    await expect(callStructured(prompt, "x", { chat, logger })).rejects.toMatchObject({
      reason: "truncated",
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("flags fallback use and logs API errors", async () => {
    const { chat } = fakeChat(reply('{"skills":[]}', "end_turn", [{ type: "fallback_message" }]));
    const { logs, logger } = collectLogs();
    await callStructured(prompt, "x", { chat, logger });
    expect(logs[0].guardrail_flags).toEqual(["fallback_used"]);

    const failing: StructuredChat = {
      config: { provider: "openai", model: "m" },
      invoke: vi.fn().mockRejectedValue(new Error("boom")),
    };
    await expect(callStructured(prompt, "x", { chat: failing, logger })).rejects.toThrow("boom");
    expect(logs[1]).toMatchObject({ provider: "openai", outcome: "api_error" });
  });

  it("never logs prompt or input text", async () => {
    const { chat } = fakeChat(reply('{"skills":["SQL"]}'));
    const { logs, logger } = collectLogs();

    await callStructured(prompt, "SECRET RESUME TEXT", { chat, logger });

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("SECRET RESUME TEXT");
    expect(serialized).not.toContain("Extract skills.");
    expect(serialized).not.toContain("SQL");
  });
});
