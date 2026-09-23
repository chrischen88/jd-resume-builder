import "server-only";

import { getDb } from "@/db/client";
import { extractJobKeywords } from "@/lib/ai/extract-keywords";
import { modelConfigFromEnv } from "@/lib/ai/models";
import { extractKeywordsPrompt } from "@/lib/ai/prompts/extract-keywords";
import { dataDir } from "@/lib/paths";
import { removeKeywordVectors } from "@/lib/vector";

import { createLibrary, type Library } from "./documents";
import { createExtractionStore, type ExtractionKey, type ExtractionStore } from "./extractions";

export { LibraryError, MAX_FILE_BYTES } from "./documents";
export type { Library } from "./documents";
export type { CachedExtraction, ExtractionSource } from "./extractions";

export async function getLibrary(): Promise<Library> {
  return createLibrary({ db: await getDb(), dataDir: dataDir(), removeKeywordVectors });
}

export async function getExtractionStore(): Promise<ExtractionStore> {
  return createExtractionStore({ db: await getDb() });
}

/** Cache key for the configured provider/model and current extraction prompt. */
export function currentExtractionKey(): ExtractionKey {
  const { provider, model } = modelConfigFromEnv();
  return { promptVersion: extractKeywordsPrompt.version, model: `${provider}:${model}` };
}

type EnsureArgs = Parameters<ExtractionStore["ensure"]>;

/** Extracts keywords for JD texts that aren't cached yet under the current key. */
export async function ensureExtractions(docs: EnsureArgs[0], options?: EnsureArgs[3]) {
  const store = await getExtractionStore();
  return store.ensure(docs, currentExtractionKey(), (text) => extractJobKeywords(text), options);
}
