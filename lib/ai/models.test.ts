import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createChatModel,
  langchainStructuredChat,
  modelConfigFromEnv,
  normalizeResponse,
  toLangChainMessages,
  type StructuredRequest,
} from "./models";

const request: StructuredRequest = {
  schemaName: "extract_keywords",
  schema: z.object({ skills: z.array(z.string()) }),
  system: "Extract skills.",
  messages: [
    { role: "user", content: "JD text" },
    { role: "assistant", content: "{}" },
    { role: "user", content: "Fix it" },
  ],
  maxTokens: 1000,
  effort: "medium",
};

describe("modelConfigFromEnv", () => {
  it("defaults to anthropic with claude-opus-5", () => {
    expect(modelConfigFromEnv({})).toEqual({ provider: "anthropic", model: "claude-opus-5" });
  });

  it("builds an openai config from OPENAI_MODEL", () => {
    expect(modelConfigFromEnv({ AI_PROVIDER: "openai", OPENAI_MODEL: "some-model" })).toEqual({
      provider: "openai",
      model: "some-model",
    });
  });

  it("requires OPENAI_MODEL for openai", () => {
    expect(() => modelConfigFromEnv({ AI_PROVIDER: "openai" })).toThrow(/OPENAI_MODEL/);
  });

  it("rejects unknown providers", () => {
    expect(() => modelConfigFromEnv({ AI_PROVIDER: "gemini" })).toThrow(/Unknown AI_PROVIDER/);
  });
});

describe("createChatModel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds ChatAnthropic with refusal fallback and effort", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const model = createChatModel(
      { provider: "anthropic", model: "claude-opus-5" },
      { maxTokens: 1000, effort: "medium" },
    );
    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model).toMatchObject({
      model: "claude-opus-5",
      maxTokens: 1000,
      outputConfig: { effort: "medium" },
      invocationKwargs: { fallbacks: "default" },
    });
  });

  it("builds ChatOpenAI on the Responses API with store disabled", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const model = createChatModel({ provider: "openai", model: "m" }, { maxTokens: 1000 });
    expect(model).toBeInstanceOf(ChatOpenAI);
    expect(model).toMatchObject({ model: "m", useResponsesApi: true, zdrEnabled: true });
  });
});

describe("toLangChainMessages", () => {
  it("prepends the system prompt and maps roles", () => {
    const messages = toLangChainMessages(request);
    expect(messages.map((m) => m.constructor)).toEqual([
      SystemMessage,
      HumanMessage,
      AIMessage,
      HumanMessage,
    ]);
    expect(messages[0].content).toBe("Extract skills.");
  });
});

describe("normalizeResponse", () => {
  const usage_metadata = { input_tokens: 12, output_tokens: 3, total_tokens: 15 };

  it("maps an Anthropic message", () => {
    const message = new AIMessage({
      content: '{"skills":["SQL"]}',
      response_metadata: {
        stop_reason: "end_turn",
        usage: { iterations: [{ type: "fallback_message" }] },
      },
      usage_metadata,
    });
    expect(normalizeResponse("anthropic", message)).toEqual({
      text: '{"skills":["SQL"]}',
      stop: "complete",
      rawStopReason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 3 },
      fallbackUsed: true,
    });
  });

  it.each([
    ["refusal", "refusal"],
    ["max_tokens", "truncated"],
  ])("maps Anthropic stop_reason %s to %s", (stop_reason, stop) => {
    const message = new AIMessage({ content: "", response_metadata: { stop_reason } });
    expect(normalizeResponse("anthropic", message).stop).toBe(stop);
  });

  it("maps a completed OpenAI message", () => {
    const message = new AIMessage({
      content: [{ type: "text", text: '{"skills":["SQL"]}' }],
      response_metadata: { status: "completed", incomplete_details: null },
      usage_metadata,
    });
    expect(normalizeResponse("openai", message)).toEqual({
      text: '{"skills":["SQL"]}',
      stop: "complete",
      rawStopReason: "completed",
      usage: { input_tokens: 12, output_tokens: 3 },
      fallbackUsed: false,
    });
  });

  it("detects OpenAI refusals", () => {
    const message = new AIMessage({ content: "", additional_kwargs: { refusal: "no" } });
    expect(normalizeResponse("openai", message).stop).toBe("refusal");
  });

  it.each([
    ["max_output_tokens", "truncated"],
    ["content_filter", "refusal"],
  ])("maps OpenAI incomplete reason %s to %s", (reason, stop) => {
    const message = new AIMessage({
      content: "",
      response_metadata: { status: "incomplete", incomplete_details: { reason } },
    });
    expect(normalizeResponse("openai", message)).toMatchObject({ stop, rawStopReason: reason });
  });
});

// These run the real LangChain models against a stubbed fetch, so they check
// the request body LangChain actually sends without touching the network.
describe("langchainStructuredChat request bodies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function captureFetch(responseBody: unknown) {
    const bodies: Record<string, unknown>[] = [];
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        urls.push(String(url));
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    return { bodies, urls };
  }

  it("sends Anthropic a JSON schema format, effort, and fallbacks", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const { bodies, urls } = captureFetch({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text: '{"skills":["SQL"]}' }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 3 },
    });

    const chat = langchainStructuredChat({ provider: "anthropic", model: "claude-opus-5" });
    const message = await chat.invoke(request);

    expect(urls[0]).toContain("/v1/messages");
    expect(bodies[0]).toMatchObject({
      model: "claude-opus-5",
      max_tokens: 1000,
      system: "Extract skills.",
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    expect(normalizeResponse("anthropic", message)).toMatchObject({
      text: '{"skills":["SQL"]}',
      stop: "complete",
      usage: { input_tokens: 12, output_tokens: 3 },
    });
  });

  it("sends OpenAI a strict JSON schema via the Responses API with store: false", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { bodies, urls } = captureFetch({
      id: "resp_1",
      object: "response",
      created_at: 0,
      model: "some-model",
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: '{"skills":["SQL"]}', annotations: [] }],
        },
      ],
      usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 },
    });

    const chat = langchainStructuredChat({ provider: "openai", model: "some-model" });
    const message = await chat.invoke({ ...request, effort: undefined });

    expect(urls[0]).toContain("/responses");
    expect(bodies[0]).toMatchObject({
      model: "some-model",
      max_output_tokens: 1000,
      store: false,
      text: { format: { type: "json_schema", name: "extract_keywords" } },
    });
    expect(normalizeResponse("openai", message)).toMatchObject({
      text: '{"skills":["SQL"]}',
      stop: "complete",
      usage: { input_tokens: 20, output_tokens: 4 },
    });
  });
});
