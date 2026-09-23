"use client";

import { useActionState } from "react";

import { createTargetSet, type FormState } from "@/app/target-sets/actions";

const initialState: FormState = { error: null };

export function CreateForm({
  resumes,
}: {
  resumes: { id: string; title: string; confirmed: boolean }[];
}) {
  const [state, formAction, pending] = useActionState(createTargetSet, initialState);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={100}
          placeholder="e.g. ML engineer roles"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Resume to tailor</legend>
        <div className="space-y-1.5">
          {resumes.map((resume, i) => (
            <label key={resume.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="resumeId" value={resume.id} defaultChecked={i === 0} />
              {resume.title}
              {!resume.confirmed && <span className="text-xs text-warning">(not checked yet)</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create target set"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
