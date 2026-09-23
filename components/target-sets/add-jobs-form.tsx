"use client";

import { useActionState } from "react";

import { addJobs, type AddJobsState } from "@/app/target-sets/actions";

const initialState: AddJobsState = { status: "idle" };

export function AddJobsForm({
  targetSetId,
  documents,
  room,
}: {
  targetSetId: string;
  /** Library JDs not in the set yet. */
  documents: { id: string; title: string; detail: string }[];
  /** How many more JDs fit in the set. */
  room: number;
}) {
  const [state, formAction, pending] = useActionState(addJobs, initialState);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="targetSetId" value={targetSetId} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">
          From your library{" "}
          <span className="font-normal text-muted">(room for {room} more)</span>
        </legend>
        <div className="max-h-72 space-y-1.5 overflow-auto">
          {documents.map((doc) => (
            <label key={doc.id} className="flex items-baseline gap-2 text-sm">
              <input type="checkbox" name="documentId" value={doc.id} className="translate-y-0.5" />
              <span>
                {doc.title} <span className="text-xs text-muted">{doc.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add to set"}
      </button>
      <div aria-live="polite" className="text-sm">
        {state.status === "done" && state.added.length > 0 && (
          <p className="text-success">
            Added {state.added.length === 1 ? state.added[0] : `${state.added.length} JDs`}.
          </p>
        )}
        {state.status === "done" && state.alreadyInSet.length > 0 && (
          <p className="text-muted">Already in the set: {state.alreadyInSet.join(", ")}.</p>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-danger">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
