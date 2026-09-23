"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DOCUMENT_KINDS } from "@/db/schema";
import { getLibrary, LibraryError, MAX_FILE_BYTES } from "@/lib/library";
import { isSupportedFile, UnsupportedFileError } from "@/lib/parsing/extract-text";

export type UploadState =
  | { status: "idle" }
  | { status: "done"; added: string[]; errors: string[] };

const uploadSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string().trim().max(200).optional(),
  text: z.string().max(200_000, "Pasted text is too long").optional(),
});

export async function uploadDocuments(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const parsed = uploadSchema.safeParse({
    kind: formData.get("kind"),
    title: formData.get("title") || undefined,
    text: formData.get("text") || undefined,
  });
  if (!parsed.success) {
    return { status: "done", added: [], errors: parsed.error.issues.map((i) => i.message) };
  }
  const { kind, title, text } = parsed.data;
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0 && !text?.trim()) {
    return { status: "done", added: [], errors: ["Choose a file or paste some text."] };
  }

  const library = await getLibrary();
  const added: string[] = [];
  const errors: string[] = [];
  // A custom title only makes sense when exactly one document is being added.
  const singleTitle = files.length + (text?.trim() ? 1 : 0) === 1 ? title : undefined;

  for (const file of files) {
    if (!isSupportedFile(file.name)) {
      errors.push(new UnsupportedFileError(file.name).message);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`${file.name} is larger than 10 MB`);
      continue;
    }
    try {
      const row = await library.add({
        kind,
        title: singleTitle,
        file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
      });
      added.push(row.title);
    } catch (err) {
      errors.push(describeError(file.name, err));
    }
  }

  if (text?.trim()) {
    try {
      const row = await library.add({ kind, title: singleTitle, text });
      added.push(row.title);
    } catch (err) {
      errors.push(describeError("Pasted text", err));
    }
  }

  if (added.length > 0) revalidatePath("/library");
  return { status: "done", added, errors };
}

function describeError(source: string, err: unknown): string {
  if (err instanceof LibraryError || err instanceof UnsupportedFileError) {
    return `${source}: ${err.message}`;
  }
  console.error("Library upload failed", { source, error: err });
  return `${source}: couldn't read this file`;
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const id = z.uuid().parse(formData.get("id"));
  const library = await getLibrary();
  await library.remove(id);
  revalidatePath("/library");
}
