"use client";

import { useActionState } from "react";

import { analyze, type AnalyzeState } from "@/app/analysis/actions";

interface Option {
  id: string;
  title: string;
  /** JDs only: whether keywords are already extracted (no model call needed). */
  cached?: boolean;
}

const initialState: AnalyzeState = { error: null };

export function AnalyzeForm({
  resumes,
  jds,
  selectedResume,
  selectedJds,
}: {
  resumes: Option[];
  jds: Option[];
  selectedResume: string | null;
  selectedJds: string[];
}) {
  const [state, formAction, pending] = useActionState(analyze, initialState);
  const uncached = jds.filter((jd) => !jd.cached).length;

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-border bg-surface p-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Resume</legend>
        <div className="space-y-1.5">
          {resumes.map((resume, i) => (
            <label key={resume.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="resume"
                value={resume.id}
                defaultChecked={selectedResume ? resume.id === selectedResume : i === 0}
              />
              {resume.title}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Job descriptions</legend>
        <div className="space-y-1.5">
          {jds.map((jd) => (
            <label key={jd.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="jd"
                value={jd.id}
                defaultChecked={selectedJds.length === 0 || selectedJds.includes(jd.id)}
              />
              {jd.title}
              {!jd.cached && <span className="text-xs text-muted">(not extracted yet)</span>}
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
          {pending ? "Analyzing…" : "Analyze"}
        </button>
        <p className="text-xs text-muted" aria-live="polite">
          {pending
            ? "Extracting keywords. This takes about 20–60 seconds per new JD."
            : uncached > 0
              ? "JDs not extracted yet are sent to the AI provider once; results are saved."
              : null}
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
