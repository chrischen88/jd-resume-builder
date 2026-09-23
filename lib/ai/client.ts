import "server-only";

import type { z } from "zod";

import {
  langchainStructuredChat,
  modelConfigFromEnv,
  normalizeResponse,
  type NormalizedResponse,
  type ProviderName,
  type StructuredChat,
} from "./models";
import type { PromptDefinition } from "./prompts/types";

// The single entry point for model calls. Route handlers, jobs, and components
// never import LangChain or a vendor SDK directly. The provider is chosen by
// AI_PROVIDER (see lib/ai/models.ts).

const DEFAULT_MAX_TOKENS = 16000;

export type GuardrailFlag =
  | "schema_retry"
  | "schema_failure"
  | "refusal"
  | "truncated"
  | "fallback_used";

/** Metadata only. Never add prompt, resume, or JD text to this shape. */
export interface AiCallLog {
  prompt_id: string;
  prompt_version: string;
  provider: ProviderName;
  model: string;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  stop_reason: string | null;
  outcome: "ok" | "invalid_output" | "refusal" | "truncated" | "api_error";
  guardrail_flags: GuardrailFlag[];
}

export type AiLogger = (entry: AiCallLog) => void;

const defaultLogger: AiLogger = (entry) => {
  console.info(JSON.stringify({ event: "ai_call", ...entry }));
};

/** Post-call guardrail counts (e.g. items dropped for ungrounded quotes). Counts only, never text. */
export interface AiGuardrailLog {
  prompt_id: string;
  prompt_version: string;
  counts: Record<string, number>;
}

export type AiGuardrailLogger = (entry: AiGuardrailLog) => void;

export const defaultGuardrailLogger: AiGuardrailLogger = (entry) => {
  console.info(JSON.stringify({ event: "ai_guardrail", ...entry }));
};

export class AiOutputError extends Error {
  constructor(
    message: string,
    readonly promptId: string,
    readonly reason: "invalid_output" | "refusal" | "truncated",
  ) {
    super(message);
    this.name = "AiOutputError";
  }
}

export interface CallOptions {
  /** Injected in tests; defaults to the LangChain model configured from env. */
  chat?: StructuredChat;
  logger?: AiLogger;
}

export interface StructuredResult<T> {
  data: T;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
}

let sharedChat: StructuredChat | undefined;
function getChat(): StructuredChat {
  sharedChat ??= langchainStructuredChat(modelConfigFromEnv());
  return sharedChat;
}

type ParseOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; feedback: string };

function parseOutput<Schema extends z.ZodType>(
  schema: Schema,
  raw: string,
): ParseOutcome<z.infer<Schema>> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      feedback: `Response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .slice(0, 10)
    .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  return { ok: false, feedback: `Response did not match the schema:\n${issues}` };
}

/**
 * Calls the model with a JSON output schema and validates the result with Zod.
 * Invalid output gets one retry that includes the validation error; a second
 * failure throws. Refusals and truncated output throw without retrying.
 */
export async function callStructured<Schema extends z.ZodType>(
  prompt: PromptDefinition<Schema>,
  userContent: string,
  options: CallOptions = {},
): Promise<StructuredResult<z.infer<Schema>>> {
  const chat = options.chat ?? getChat();
  const { provider, model } = chat.config;
  const logger = options.logger ?? defaultLogger;

  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: userContent },
  ];
  const flags: GuardrailFlag[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const started = Date.now();
  let attempts = 0;
  let stopReason: string | null = null;

  const log = (outcome: AiCallLog["outcome"]) =>
    logger({
      prompt_id: prompt.id,
      prompt_version: prompt.version,
      provider,
      model,
      attempts,
      ...usage,
      latency_ms: Date.now() - started,
      stop_reason: stopReason,
      outcome,
      guardrail_flags: flags,
    });

  const fail = (reason: AiOutputError["reason"], message: string): never => {
    log(reason);
    throw new AiOutputError(message, prompt.id, reason);
  };

  while (attempts < 2) {
    attempts++;
    let response: NormalizedResponse;
    try {
      const message = await chat.invoke({
        schemaName: prompt.id,
        schema: prompt.schema,
        system: prompt.system,
        messages,
        maxTokens: prompt.maxTokens ?? DEFAULT_MAX_TOKENS,
        effort: prompt.effort,
      });
      response = normalizeResponse(provider, message);
    } catch (err) {
      log("api_error");
      throw err;
    }

    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    stopReason = response.rawStopReason;
    if (response.fallbackUsed && !flags.includes("fallback_used")) {
      flags.push("fallback_used");
    }

    if (response.stop === "refusal") {
      flags.push("refusal");
      fail("refusal", `Model declined prompt ${prompt.id}`);
    }
    if (response.stop === "truncated") {
      flags.push("truncated");
      fail("truncated", `Output for prompt ${prompt.id} hit the output token limit`);
    }

    const parsed = parseOutput(prompt.schema, response.text);
    if (parsed.ok) {
      log("ok");
      return { data: parsed.data, usage: { ...usage }, attempts };
    }

    if (attempts === 1) {
      flags.push("schema_retry");
      messages.push(
        { role: "assistant", content: response.text },
        {
          role: "user",
          content: `${parsed.feedback}\n\nReturn corrected JSON that matches the schema exactly.`,
        },
      );
      continue;
    }

    flags.push("schema_failure");
    fail(
      "invalid_output",
      `Prompt ${prompt.id}@${prompt.version} returned invalid output twice. ${parsed.feedback}`,
    );
  }

  // Unreachable: the loop either returns or throws.
  throw new Error("callStructured exited without a result");
}
