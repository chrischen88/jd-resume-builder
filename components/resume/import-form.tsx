"use client";

import { useActionState } from "react";

import { importResumeAction, type ImportState } from "@/app/resume/actions";

const initialState: ImportState = { error: null };

export function ImportForm({
  documents,
}: {
  /** Library resumes; `imported` counts how many resumes were already made from each. */
  documents: { id: string; title: string; imported: number }[];
}) {
  const [state, formAction, pending] = useActionState(importResumeAction, initialState);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Resume from your library</legend>
        <div className="space-y-1.5">
          {documents.map((doc, i) => (
            <label key={doc.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="documentId" value={doc.id} defaultChecked={i === 0} />
              {doc.title}
              {doc.imported > 0 && (
                <span className="text-xs text-muted">
                  (imported {doc.imported === 1 ? "once" : `${doc.imported} times`})
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Reading resume…" : "Import"}
        </button>
        <p className="text-xs text-muted" aria-live="polite">
          {pending
            ? "Splitting it into roles and bullets. This takes about 20–40 seconds."
            : "The resume text is sent to the AI provider once to split it into roles and bullets."}
        </p>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
