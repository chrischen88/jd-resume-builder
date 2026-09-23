"use client";

import { useActionState } from "react";

import { removeJob, type FormState } from "@/app/target-sets/actions";

const initialState: FormState = { error: null };

/** Removes a JD from the set; the library document stays, so no confirm step. */
export function RemoveJobButton({
  targetSetId,
  jobId,
  title,
}: {
  targetSetId: string;
  jobId: string;
  title: string;
}) {
  const [state, formAction, pending] = useActionState(removeJob, initialState);

  return (
    <form action={formAction} className="flex flex-col items-end">
      <input type="hidden" name="targetSetId" value={targetSetId} />
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove ${title} from this set`}
        className="rounded px-2 py-1 text-xs text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-60"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {state.error && (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
