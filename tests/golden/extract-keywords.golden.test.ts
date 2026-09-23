// Golden test for keyword extraction (TASKS 0.3, 1.27). Makes real model
// calls, so it only runs via `npm run test:golden` (RUN_GOLDEN=1) and uses
// the provider configured in .env / .env.local.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";
import { describe, expect, it } from "vitest";

import { extractJobKeywords, type JobExtraction } from "@/lib/ai/extract-keywords";
import { modelConfigFromEnv } from "@/lib/ai/models";
import { extractText } from "@/lib/parsing/extract-text";

const RUN = process.env.RUN_GOLDEN === "1";
const JD_DIR = path.join(process.cwd(), "tests/fixtures/jds");
const OUT_DIR = path.join(process.cwd(), "tests/golden/output");
const MIN_KEYWORDS = 5;

if (RUN) nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const fixtures = existsSync(JD_DIR)
  ? readdirSync(JD_DIR).filter((f) => /\.(txt|md|docx|pdf)$/i.test(f)).sort()
  : [];

describe.skipIf(!RUN || fixtures.length === 0)("golden: extract_keywords", () => {
  const summary: string[] = [];

  it.each(fixtures)(
    "%s → valid, grounded keywords",
    async (file) => {
      const text = await extractText(file, readFileSync(path.join(JD_DIR, file)));
      // Throws AiOutputError if the output is still invalid after one retry.
      const result: JobExtraction = await extractJobKeywords(text, {
        logger: () => {},
        guardrailLogger: () => {},
      });

      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(
        path.join(OUT_DIR, `${path.parse(file).name}.json`),
        JSON.stringify({ model: modelConfigFromEnv(), ...result }, null, 2),
      );
      summary.push(
        `${file}: ${result.keywords.length} kept, ${result.dropped.quoteNotFound} bad quote, ` +
          `${result.dropped.phraseNotFound} bad phrase, ${result.dropped.duplicates} dup | ` +
          `${result.job.title ?? "?"} @ ${result.job.company ?? "?"} (${result.job.seniority ?? "?"}, ` +
          `${result.job.years_experience_min ?? "?"}y) | ${result.usage.input_tokens}+${result.usage.output_tokens} tok`,
      );

      expect(result.keywords.length).toBeGreaterThanOrEqual(MIN_KEYWORDS);
      for (const keyword of result.keywords) {
        expect(text).toContain(keyword.evidence_quote);
      }
    },
    180_000,
  );

  it("summary", () => {
    process.stderr.write(`\nGOLDEN extract_keywords\n${summary.map((s) => `  ${s}`).join("\n")}\n`);
  });
});
