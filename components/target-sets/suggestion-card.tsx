"use client";

import { useActionState } from "react";

import {
  acceptSuggestion,
  dismissSuggestion,
  type FormState,
} from "@/app/target-sets/actions";

import { Highlighted, type Segments } from "./excerpt";

const initialState: FormState = { error: null };

export function SuggestionCard({
  targetSetId,
  suggestionId,
  skillName,
  where,
  original,
  suggested,
}: {
  targetSetId: string;
  suggestionId: string;
  skillName: string;
  /** "Title, Employer" of the bullet's role. */
  where: string;
  original: string;
  suggested: Segments;
}) {
  const [state, acceptAction, accepting] = useActionState(acceptSuggestion, initialState);

  return (
    <li className="space-y-3 px-4 py-3">
      <p className="text-xs text-muted">
        Uses the JDs&apos; wording for <span className="font-medium text-foreground">{skillName}</span>{" "}
        · {where}
      </p>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Now</dt>
          <dd>{original}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Suggested</dt>
          <dd>
            <Highlighted parts={suggested} />
          </dd>
        </div>
      </dl>
      <div className="flex items-center gap-2">
        <form action={acceptAction}>
          <input type="hidden" name="targetSetId" value={targetSetId} />
          <input type="hidden" name="suggestionId" value={suggestionId} />
          <button
            type="submit"
            disabled={accepting}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
          >
            {accepting ? "Updating…" : "Use this wording"}
          </button>
        </form>
        <form action={dismissSuggestion}>
          <input type="hidden" name="targetSetId" value={targetSetId} />
          <input type="hidden" name="suggestionId" value={suggestionId} />
          <button type="submit" className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface">
            Ignore
          </button>
        </form>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </li>
  );
}
