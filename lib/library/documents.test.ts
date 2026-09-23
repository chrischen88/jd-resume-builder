import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb } from "@/db/client";

import { createLibrary, deriveTitle, LibraryError, type Library } from "./documents";

// Inline sample so the test doesn't depend on the (git-ignored) fixtures.
const jd1 = new TextEncoder().encode(
  "About the job\nBeli is hiring a Software Engineer.\n\nRequirements\n- TypeScript\n- React Native\n",
);

let dataDir: string;
let library: Library;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "library-test-"));
  library = createLibrary({ db: await openDb(":memory:"), dataDir });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("deriveTitle", () => {
  it("uses the file name without extension", () => {
    expect(deriveTitle("About the job", "kensho-ml.txt")).toBe("kensho-ml");
  });

  it("uses the first non-empty line of pasted text, truncated", () => {
    expect(deriveTitle("\n  Staff Engineer\nmore")).toBe("Staff Engineer");
    expect(deriveTitle("x".repeat(200))).toHaveLength(120);
  });
});

describe("library", () => {
  it("stores an uploaded file's text and keeps the original on disk", async () => {
    const row = await library.add({ kind: "jd", file: { name: "jd1.txt", bytes: jd1 } });

    expect(row).toMatchObject({ kind: "jd", title: "jd1", filename: "jd1.txt" });
    expect(row.text).toContain("Beli");
    expect(row.storedPath).toMatch(/^uploads\/.+\.txt$/);
    expect(new Uint8Array(readFileSync(path.join(dataDir, row.storedPath!)))).toEqual(jd1);
    expect(await library.list("jd")).toHaveLength(1);
    expect(await library.list("resume")).toHaveLength(0);
  });

  it("stores pasted text with an explicit title and no file", async () => {
    const row = await library.add({ kind: "resume", title: "Master", text: "  Jane\r\nEngineer  " });
    expect(row).toMatchObject({ title: "Master", text: "Jane\nEngineer", filename: null, storedPath: null });
  });

  it("rejects duplicates of the same kind, ignoring whitespace differences", async () => {
    await library.add({ kind: "jd", file: { name: "jd1.txt", bytes: jd1 } });
    const pasted = new TextDecoder().decode(jd1).replace(/\n/g, "\r\n");

    await expect(library.add({ kind: "jd", text: pasted })).rejects.toMatchObject({
      code: "duplicate",
    });
    // Same text filed as a different kind is allowed.
    await expect(library.add({ kind: "resume", text: pasted })).resolves.toBeDefined();
  });

  it("rejects empty text", async () => {
    await expect(library.add({ kind: "jd", text: " \n " })).rejects.toBeInstanceOf(LibraryError);
  });

  it("removes the row and its stored file", async () => {
    const row = await library.add({ kind: "jd", file: { name: "jd1.txt", bytes: jd1 } });
    const stored = path.join(dataDir, row.storedPath!);

    expect(await library.remove(row.id)).toBe(true);
    expect(existsSync(stored)).toBe(false);
    expect(await library.get(row.id)).toBeUndefined();
    expect(await library.remove(row.id)).toBe(false);
  });
});

describe("library: imported from a URL", () => {
  const url = "https://www.linkedin.com/jobs/view/4012345678/";

  it("stores the source URL and rejects the same URL again, even if the text changed", async () => {
    const row = await library.add({
      kind: "jd",
      title: "Acme – ML Engineer",
      text: "Build models.",
      sourceUrl: url,
    });
    expect(row).toMatchObject({ sourceUrl: url, filename: null, storedPath: null });
    await expect(
      library.add({ kind: "jd", text: "Build models, now updated.", sourceUrl: url }),
    ).rejects.toMatchObject({
      code: "duplicate",
      message: "Already in the library as “Acme – ML Engineer”",
    });
  });

  it("leaves source URL empty for pasted text", async () => {
    expect((await library.add({ kind: "jd", text: "Pasted JD" })).sourceUrl).toBeNull();
  });
});
