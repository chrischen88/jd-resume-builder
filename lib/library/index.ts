import "server-only";

import { getDb } from "@/db/client";
import { dataDir } from "@/lib/paths";

import { createLibrary, type Library } from "./documents";

export { LibraryError, MAX_FILE_BYTES } from "./documents";
export type { Library } from "./documents";

export async function getLibrary(): Promise<Library> {
  return createLibrary({ db: await getDb(), dataDir: dataDir() });
}
