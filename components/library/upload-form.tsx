"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { uploadDocuments, type UploadState } from "@/app/library/actions";

const initialState: UploadState = { status: "idle" };

const KINDS = [
  { value: "jd", label: "Job description" },
  { value: "resume", label: "Resume" },
] as const;

export function UploadForm() {
  const [state, formAction, pending] = useActionState(uploadDocuments, initialState);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("jd");
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs after a fully successful upload; keep them if anything failed.
  // Clears fields individually: a form reset would also reset the kind radio
  // in the DOM without updating React state, so the next upload could be
  // filed under the wrong kind.
  useEffect(() => {
    if (state.status === "done" && state.added.length > 0 && state.errors.length === 0) {
      const form = formRef.current;
      if (!form) return;
      for (const name of ["files", "text", "title"]) {
        const field = form.elements.namedItem(name);
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          field.value = "";
        }
      }
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      // Submitting via onSubmit rather than `action` skips React's automatic
      // form reset (see the effect above for why that reset is unwanted).
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className="space-y-4 rounded-lg border border-border bg-surface p-5"
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Adding a</legend>
        <div className="inline-flex rounded-md border border-border p-0.5">
          {KINDS.map((option) => (
            <label
              key={option.value}
              className={`relative cursor-pointer rounded px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                kind === option.value ? "bg-accent text-accent-foreground" : "text-muted"
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                // Invisible but covers the label, so it stays clickable and focusable.
                className="absolute inset-0 cursor-pointer appearance-none opacity-0"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="files" className="mb-1 block text-sm font-medium">
          Files
        </label>
        <input
          id="files"
          name="files"
          type="file"
          multiple
          accept=".txt,.md,.docx,.pdf"
          className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent"
        />
        <p className="mt-1 text-xs text-muted">.txt, .md, .docx or .pdf, up to 10 MB each. Select several at once.</p>
      </div>

      <div>
        <label htmlFor="text" className="mb-1 block text-sm font-medium">
          Or paste text
        </label>
        <textarea
          id="text"
          name="text"
          rows={5}
          placeholder={kind === "jd" ? "Paste a job posting…" : "Paste your resume…"}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium">
          Title <span className="font-normal text-muted">(optional, for a single item)</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={200}
          placeholder={kind === "jd" ? "e.g. Kensho – ML Engineer" : "e.g. Master resume"}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add to library"}
        </button>
      </div>

      <div aria-live="polite" className="space-y-1 text-sm">
        {state.status === "done" && state.added.length > 0 && (
          <p className="text-success">
            Added {state.added.length}: {state.added.join(", ")}
          </p>
        )}
        {state.status === "done" &&
          state.errors.map((error) => (
            <p key={error} className="text-danger">
              {error}
            </p>
          ))}
      </div>
    </form>
  );
}
