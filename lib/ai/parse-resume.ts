import "server-only";

import { groundParsedResume, type GroundedResume } from "@/lib/resume/ground";

import {
  callStructured,
  defaultGuardrailLogger,
  type AiGuardrailLogger,
  type CallOptions,
} from "./client";
import { parseResumeInput, parseResumePrompt } from "./prompts/parse-resume";

export interface ResumeParse extends GroundedResume {
  promptVersion: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Splits resume text into sections, roles, and bullets (SPEC F1) and checks
 * every value against the text. Pass the same normalized text that is stored
 * for the resume document.
 */
export async function parseResumeText(
  resumeText: string,
  options: CallOptions & { guardrailLogger?: AiGuardrailLogger } = {},
): Promise<ResumeParse> {
  const { data, usage } = await callStructured(
    parseResumePrompt,
    parseResumeInput(resumeText),
    options,
  );
  const grounded = groundParsedResume(resumeText, data);

  (options.guardrailLogger ?? defaultGuardrailLogger)({
    prompt_id: parseResumePrompt.id,
    prompt_version: parseResumePrompt.version,
    counts: {
      roles: grounded.resume.roles.length,
      bullets: grounded.resume.roles.reduce((n, r) => n + r.bullets.length, 0),
      values_checked: grounded.checked,
      values_not_in_resume: grounded.issues.length,
    },
  });

  return { ...grounded, promptVersion: parseResumePrompt.version, usage };
}
