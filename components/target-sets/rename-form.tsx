"use client";

import { useActionState } from "react";

import { renameTargetSet, type FormState } from "@/app/target-sets/actions";

const initialState: FormState = { error: null };

export function RenameForm({ targetSetId, name }: { targetSetId: string; name: string }) {
  const [state, formAction, pending] = useActionState(renameTargetSet, initialState);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="targetSetId" value={targetSetId} />
      <label htmlFor="set-name" className="sr-only">
        Name
      </label>
      <input
        id="set-name"
        name="name"
        required
        maxLength={100}
        defaultValue={name}
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {pending ? "Saving…" : "Rename"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
