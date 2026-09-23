import path from "node:path";

/**
 * Root folder for everything the app stores locally: the SQLite database,
 * uploaded files, and Chroma data. Git-ignored. Override with DATA_DIR.
 */
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  const override = env.DATA_DIR?.trim();
  return override ? path.resolve(override) : path.join(process.cwd(), "data");
}
