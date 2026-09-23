// Golden test for resume parsing (TASKS 1.6). Makes real model calls, so it
// only runs via `npm run test:golden` (RUN_GOLDEN=1) and uses the provider
// configured in .env / .env.local.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";
import { describe, expect, it } from "vitest";

import { modelConfigFromEnv } from "@/lib/ai/models";
import { parseResumeText } from "@/lib/ai/parse-resume";
import { extractText } from "@/lib/parsing/extract-text";

const RUN = process.env.RUN_GOLDEN === "1";
const RESUME_DIR = path.join(process.cwd(), "tests/fixtures/resumes");
const OUT_DIR = path.join(process.cwd(), "tests/golden/output");
/** Share of parsed values allowed to miss the resume text (e.g. a reworded date). */
const MAX_ISSUE_RATE = 0.05;

if (RUN) nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const fixtures = existsSync(RESUME_DIR)
  ? readdirSync(RESUME_DIR)
      .filter((f) => /\.(txt|md|docx|pdf)$/i.test(f))
      .sort()
  : [];

describe.skipIf(!RUN || fixtures.length === 0)("golden: parse_resume", () => {
  const summary: string[] = [];

  it.each(fixtures)(
    "%s → roles and bullets copied from the resume",
    async (file) => {
      const text = await extractText(file, readFileSync(path.join(RESUME_DIR, file)));
      const result = await parseResumeText(text, { logger: () => {}, guardrailLogger: () => {} });

      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(
        path.join(OUT_DIR, `${path.parse(file).name}.parsed.json`),
        JSON.stringify({ model: modelConfigFromEnv(), ...result }, null, 2),
      );
      const bulletCount = result.resume.roles.reduce((n, r) => n + r.bullets.length, 0);
      summary.push(
        `${file}: ${result.resume.roles.length} roles, ${bulletCount} bullets, ` +
          `${result.resume.sections.education.length} education, ${result.resume.sections.skills.length} skill lines | ` +
          `${result.issues.length}/${result.checked} not in resume` +
          (result.issues.length ? ` (${result.issues.map((i) => i.path).join(", ")})` : "") +
          ` | ${result.usage.input_tokens}+${result.usage.output_tokens} tok`,
      );

      expect(result.resume.roles.length).toBeGreaterThan(0);
      expect(bulletCount).toBeGreaterThan(0);
      expect(result.issues.length / result.checked).toBeLessThanOrEqual(MAX_ISSUE_RATE);
    },
    180_000,
  );

  it("summary", () => {
    process.stderr.write(`\nGOLDEN parse_resume\n${summary.map((s) => `  ${s}`).join("\n")}\n`);
  });
});
