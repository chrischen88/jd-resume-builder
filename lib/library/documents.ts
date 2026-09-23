import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, asc, desc, eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { documents, type DocumentKind, type DocumentRow } from "@/db/schema";
import { extractText, normalizeText } from "@/lib/parsing/extract-text";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TITLE_LENGTH = 120;

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly code: "empty" | "duplicate" | "too_large",
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

export type AddDocumentInput =
  | { kind: DocumentKind; title?: string; file: { name: string; bytes: Uint8Array } }
  | { kind: DocumentKind; title?: string; text: string; sourceUrl?: string };

/** File name without extension, or the first line of pasted text. */
export function deriveTitle(text: string, filename?: string): string {
  const base = filename
    ? path.basename(filename, path.extname(filename))
    : (text.split("\n").find((line) => line.trim()) ?? "Untitled");
  const title = base.trim();
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The local document library: JDs and resumes as extracted text in SQLite,
 * with uploaded originals kept under <data dir>/uploads.
 */
export function createLibrary({ db, dataDir }: { db: Db; dataDir: string }) {
  return {
    async add(input: AddDocumentInput): Promise<DocumentRow> {
      const id = randomUUID();
      let text: string;
      let filename: string | null = null;
      let storedPath: string | null = null;

      if ("file" in input) {
        if (input.file.bytes.byteLength > MAX_FILE_BYTES) {
          throw new LibraryError(`${input.file.name} is larger than 10 MB`, "too_large");
        }
        filename = path.basename(input.file.name);
        text = await extractText(filename, input.file.bytes);
      } else {
        text = normalizeText(input.text);
      }

      if (!text) {
        throw new LibraryError(
          filename
            ? `No text found in ${filename}. Scanned PDFs aren't supported; paste the text instead.`
            : "Pasted text is empty",
          "empty",
        );
      }

      const sourceUrl = "text" in input ? (input.sourceUrl ?? null) : null;
      if (sourceUrl) {
        const sameUrl = await db.query.documents.findFirst({
          where: and(eq(documents.kind, input.kind), eq(documents.sourceUrl, sourceUrl)),
        });
        if (sameUrl) {
          throw new LibraryError(`Already in the library as “${sameUrl.title}”`, "duplicate");
        }
      }

      const contentHash = hashText(text);
      const existing = await db.query.documents.findFirst({
        where: and(eq(documents.kind, input.kind), eq(documents.contentHash, contentHash)),
      });
      if (existing) {
        throw new LibraryError(`Already in the library as “${existing.title}”`, "duplicate");
      }

      if ("file" in input && filename) {
        storedPath = path.join("uploads", `${id}${path.extname(filename).toLowerCase()}`);
        await mkdir(path.join(dataDir, "uploads"), { recursive: true });
        await writeFile(path.join(dataDir, storedPath), input.file.bytes);
      }

      const [row] = await db
        .insert(documents)
        .values({
          id,
          kind: input.kind,
          title: input.title?.trim() || deriveTitle(text, filename ?? undefined),
          filename,
          storedPath,
          sourceUrl,
          text,
          contentHash,
        })
        .returning();
      return row;
    },

    list(kind?: DocumentKind): Promise<DocumentRow[]> {
      return db.query.documents.findMany({
        where: kind ? eq(documents.kind, kind) : undefined,
        // Files uploaded together can share a timestamp; fall back to title.
        orderBy: [desc(documents.createdAt), asc(documents.title)],
      });
    },

    get(id: string): Promise<DocumentRow | undefined> {
      return db.query.documents.findFirst({ where: eq(documents.id, id) });
    },

    async remove(id: string): Promise<boolean> {
      const [row] = await db.delete(documents).where(eq(documents.id, id)).returning();
      if (!row) return false;
      if (row.storedPath) await rm(path.join(dataDir, row.storedPath), { force: true });
      return true;
    },
  };
}

export type Library = ReturnType<typeof createLibrary>;
