import "server-only";

import path from "node:path";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".docx", ".pdf"] as const;

export class UnsupportedFileError extends Error {
  constructor(filename: string) {
    super(`Unsupported file type: ${filename}. Use ${SUPPORTED_EXTENSIONS.join(", ")}.`);
    this.name = "UnsupportedFileError";
  }
}

export function isSupportedFile(filename: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(path.extname(filename).toLowerCase());
}

/**
 * Normalizes line endings and whitespace so the same document always yields
 * the same text. Extraction runs on this normalized text, so `evidence_quote`
 * checks compare against exactly what is stored.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// pdf-parse adds a "-- 1 of 3 --" marker after each page.
const PDF_PAGE_MARKER = /^-- \d+ of \d+ --$/gm;

/** Extracts plain text from an uploaded .txt, .md, .docx, or .pdf file. */
export async function extractText(filename: string, bytes: Uint8Array): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".txt":
    case ".md":
      return normalizeText(new TextDecoder("utf-8").decode(bytes));
    case ".docx": {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return normalizeText(value);
    }
    case ".pdf": {
      // pdf.js may take ownership of the buffer, so pass a copy.
      const parser = new PDFParse({ data: new Uint8Array(bytes) });
      try {
        const { text } = await parser.getText();
        return normalizeText(text.replace(PDF_PAGE_MARKER, ""));
      } finally {
        await parser.destroy();
      }
    }
    default:
      throw new UnsupportedFileError(filename);
  }
}
