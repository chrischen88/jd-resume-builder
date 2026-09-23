import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { dataDir } from "@/lib/paths";

import * as schema from "./schema";

export const MIGRATIONS_DIR = path.join(process.cwd(), "db/migrations");

export function createDb(url: string) {
  return drizzle(createClient({ url }), { schema });
}

export type Db = ReturnType<typeof createDb>;

/** Opens (and migrates) a database; `:memory:` works for tests. */
export async function openDb(url: string): Promise<Db> {
  const db = createDb(url);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

let shared: Promise<Db> | undefined;

/** The app's database at <data dir>/app.db, migrated on first use. */
export function getDb(): Promise<Db> {
  shared ??= (async () => {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    return openDb(`file:${path.join(dir, "app.db")}`);
  })();
  return shared;
}
