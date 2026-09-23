import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { describe, expect, it } from "vitest";

import { MIGRATIONS_DIR } from "./client";

async function apply(client: Client, tag: string) {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.execute(statement);
  }
}

describe("migration 0005_analysis", () => {
  it("keys existing cached extractions by their document's text hash", async () => {
    const client = createClient({ url: ":memory:" });
    for (const tag of [
      "0000_documents",
      "0001_keyword_extractions",
      "0002_core_schema",
      "0003_resume_confirmed_at",
      "0004_document_source_url",
    ]) {
      await apply(client, tag);
    }
    await client.execute(
      `INSERT INTO documents (id, kind, title, text, content_hash, created_at)
       VALUES ('doc-1', 'jd', 'JD', 'text', 'hash-1', 0)`,
    );
    await client.execute(
      `INSERT INTO keyword_extractions (id, document_id, prompt_version, model, result, created_at)
       VALUES ('ex-1', 'doc-1', '1.1.0', 'openai:m', '{}', 0)`,
    );

    await apply(client, "0005_analysis");
    const { rows } = await client.execute("SELECT text_hash FROM keyword_extractions");
    expect(rows.map((r) => r.text_hash)).toEqual(["hash-1"]);
  });
});
