import "server-only";

import { getDb } from "@/db/client";
import { extractJobKeywords } from "@/lib/ai/extract-keywords";
import { modelConfigFromEnv } from "@/lib/ai/models";
import { extractKeywordsPrompt } from "@/lib/ai/prompts/extract-keywords";
import { dataDir } from "@/lib/paths";

import { createLibrary, type Library } from "./documents";
import { createExtractionStore, type ExtractionKey, type ExtractionStore } from "./extractions";

export { LibraryError, MAX_FILE_BYTES } from "./documents";
export type { Library } from "./documents";
export type { CachedExtraction } from "./extractions";

export async function getLibrary(): Promise<Library> {
  return createLibrary({ db: await getDb(), dataDir: dataDir() });
}

export async function getExtractionStore(): Promise<ExtractionStore> {
  return createExtractionStore({ db: await getDb() });
}

/** Cache key for the configured provider/model and current extraction prompt. */
export function currentExtractionKey(): ExtractionKey {
  const { provider, model } = modelConfigFromEnv();
  return { promptVersion: extractKeywordsPrompt.version, model: `${provider}:${model}` };
}

/** Extracts keywords for JDs that aren't cached yet under the current key. */
export async function ensureExtractions(docs: Parameters<ExtractionStore["ensure"]>[0]) {
  const store = await getExtractionStore();
  return store.ensure(docs, currentExtractionKey(), (text) => extractJobKeywords(text));
}
