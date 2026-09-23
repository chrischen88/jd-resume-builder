import "server-only";

import { ChatAnthropic } from "@langchain/anthropic";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import type { z } from "zod";

import type { Effort } from "./prompts/types";

// LangChain model construction. Only lib/ai and lib/vector import this; the
// rest of the app goes through lib/ai/client.ts.

export type ProviderName = "anthropic" | "openai";

export interface ModelConfig {
  provider: ProviderName;
  model: string;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
// Server-side refusal fallback: the API re-runs a declined request on a
// fallback model inside the same call.
const ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01";

type Env = Record<string, string | undefined>;

/**
 * Picks the chat model from env:
 * - AI_PROVIDER=anthropic (default): ANTHROPIC_MODEL, default claude-opus-5
 * - AI_PROVIDER=openai: OPENAI_MODEL is required
 */
export function modelConfigFromEnv(env: Env = process.env): ModelConfig {
  const provider = env.AI_PROVIDER?.trim() || "anthropic";
  switch (provider) {
    case "anthropic":
      return { provider, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL };
    case "openai": {
      const model = env.OPENAI_MODEL?.trim();
      if (!model) throw new Error("AI_PROVIDER=openai requires OPENAI_MODEL to be set");
      return { provider, model };
    }
    default:
      throw new Error(`Unknown AI_PROVIDER "${provider}"; expected "anthropic" or "openai"`);
  }
}

export function createChatModel(
  config: ModelConfig,
  options: { maxTokens: number; effort?: Effort },
): BaseChatModel {
  if (config.provider === "anthropic") {
    return new ChatAnthropic({
      model: config.model,
      maxTokens: options.maxTokens,
      ...(options.effort ? { outputConfig: { effort: options.effort } } : {}),
      betas: [ANTHROPIC_FALLBACK_BETA],
      invocationKwargs: { fallbacks: "default" },
    });
  }
  return new ChatOpenAI({
    model: config.model,
    maxTokens: options.maxTokens,
    ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
    useResponsesApi: true,
    // store: false, so OpenAI doesn't keep resume/JD content beyond the call.
    zdrEnabled: true,
  });
}

export function embeddingModelFromEnv(env: Env = process.env): string {
  return env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

/** Embeddings for the Chroma vector store. Always OpenAI, whatever the chat provider. */
export function embeddingsFromEnv(env: Env = process.env): EmbeddingsInterface {
  return new OpenAIEmbeddings({ model: embeddingModelFromEnv(env) });
}

export interface StructuredRequest {
  /** Used as the JSON schema name where the provider requires one. */
  schemaName: string;
  schema: z.ZodType;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  effort?: Effort;
}

/**
 * The seam between lib/ai/client.ts and LangChain: sends one structured-output
 * request and returns the raw model message. Validation and retries stay in
 * the client so they behave the same for every provider.
 */
export interface StructuredChat {
  config: ModelConfig;
  invoke(request: StructuredRequest): Promise<AIMessage>;
}

export function toLangChainMessages(request: StructuredRequest): BaseMessage[] {
  return [
    new SystemMessage(request.system),
    ...request.messages.map((m) =>
      m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
    ),
  ];
}

export function langchainStructuredChat(config: ModelConfig): StructuredChat {
  return {
    config,
    async invoke(request) {
      const chat = createChatModel(config, request);
      // includeRaw keeps the provider message (stop reason, usage, refusal);
      // `parsed` is ignored because client.ts runs its own Zod validation to
      // get error details for the retry.
      const structured = chat.withStructuredOutput(request.schema, {
        method: "jsonSchema",
        name: request.schemaName,
        includeRaw: true,
      });
      const { raw } = await structured.invoke(toLangChainMessages(request));
      if (!AIMessage.isInstance(raw)) throw new Error("Model returned a non-AI message");
      return raw;
    },
  };
}

export interface NormalizedResponse {
  text: string;
  stop: "complete" | "refusal" | "truncated";
  /** The provider's own stop/status value, for logs. */
  rawStopReason: string | null;
  usage: { input_tokens: number; output_tokens: number };
  fallbackUsed: boolean;
}

interface AnthropicMetadata {
  stop_reason?: string | null;
  usage?: { iterations?: { type: string }[] };
}

interface OpenAIMetadata {
  status?: string;
  incomplete_details?: { reason?: string } | null;
}

/** Maps each provider's stop/usage metadata onto one shape. */
export function normalizeResponse(provider: ProviderName, message: AIMessage): NormalizedResponse {
  const usage = {
    input_tokens: message.usage_metadata?.input_tokens ?? 0,
    output_tokens: message.usage_metadata?.output_tokens ?? 0,
  };

  if (provider === "anthropic") {
    const meta = message.response_metadata as AnthropicMetadata;
    const stopReason = meta.stop_reason ?? null;
    return {
      text: message.text,
      stop:
        stopReason === "refusal" ? "refusal" : stopReason === "max_tokens" ? "truncated" : "complete",
      rawStopReason: stopReason,
      usage,
      fallbackUsed:
        meta.usage?.iterations?.some((entry) => entry.type === "fallback_message") ?? false,
    };
  }

  const meta = message.response_metadata as OpenAIMetadata;
  const incomplete = meta.incomplete_details?.reason ?? null;
  const refused = Boolean(message.additional_kwargs.refusal) || incomplete === "content_filter";
  return {
    text: message.text,
    stop: refused ? "refusal" : incomplete === "max_output_tokens" ? "truncated" : "complete",
    rawStopReason: incomplete ?? meta.status ?? null,
    usage,
    fallbackUsed: false,
  };
}
