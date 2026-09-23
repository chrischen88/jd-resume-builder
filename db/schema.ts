import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// SQLite schema (local, single user). The rest of SPEC §Data model lands in
// task 1.1; this starts with the document library.

export const DOCUMENT_KINDS = ["jd", "resume"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Every uploaded or pasted JD and resume, kept as extracted text. */
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    title: text("title").notNull(),
    /** Original filename; null when the text was pasted. */
    filename: text("filename"),
    /** Original file, relative to the data dir; null when pasted. */
    storedPath: text("stored_path"),
    text: text("text").notNull(),
    /** sha256 of the normalized text, for duplicate detection. */
    contentHash: text("content_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("documents_kind_hash_idx").on(table.kind, table.contentHash)],
);

export type DocumentRow = typeof documents.$inferSelect;
