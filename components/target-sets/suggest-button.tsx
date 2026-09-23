"use client";

import { useActionState } from "react";

import { requestSuggestions, type SuggestState } from "@/app/target-sets/actions";

const initialState: SuggestState = { status: "idle" };

function outcome(state: SuggestState): string | null {
  if (state.status !== "done") return null;
  if (state.candidates === 0) {
    return "Nothing new to reword: no bullet shows an in-demand skill in words the JDs don't use.";
  }
  if (state.added === 0) {
    return (
      "No suggestions this time: each rewording either added or dropped something, " +
      "so it was left out."
    );
  }
  return `Added ${state.added} ${state.added === 1 ? "suggestion" : "suggestions"}.`;
}

export function SuggestButton({ targetSetId }: { targetSetId: string }) {
  const [state, formAction, pending] = useActionState(requestSuggestions, initialState);
  const message = outcome(state);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="targetSetId" value={targetSetId} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60"
        >
          {pending ? "Asking for rewordings…" : "Suggest rewordings"}
        </button>
        <p className="text-xs text-muted" aria-live="polite">
          {pending
            ? "This takes a few seconds."
            : "Sends the bullets to reword to the AI provider. Nothing changes until you accept."}
        </p>
      </div>
      {message && (
        <p className="text-sm text-muted" aria-live="polite">
          {message}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
