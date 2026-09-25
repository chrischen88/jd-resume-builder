"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";

import { excerpt, Highlighted } from "@/components/target-sets/excerpt";

import {
  acceptVariant,
  answerFollowUp,
  answerGap,
  chooseRole,
  confirmDraftClaim,
  editVariant,
  skipGap,
  undoGap,
  type InterviewActionState,
} from "@/app/target-sets/[id]/interview/actions";

// Screen 5, left side (TASKS 1.21): one gap at a time. Model steps stream
// progress from POST /api/target-sets/:id/interview/step; every answer is a
// Server Action, saved as soon as it's given.

export interface PanelGap {
  demandId: string;
  name: string;
  category: string;
  coverage: "missing" | "weak";
  jdCount: number;
  requiredCount: number;
  mustDo: boolean;
  evidence: string[];
  matchedTerm: string | null;
  sources: { jobTitle: string; quote: string; importance: string }[];
}

export interface PanelVariant {
  text: string;
  keywordsHit: string[];
  unverifiedClaims: string[];
}

export interface PanelProps {
  targetSetId: string;
  jobCount: number;
  gap: PanelGap;
  stage: "ask" | "role" | "follow_up" | "needs_question" | "needs_draft" | "draft" | "done";
  response: "yes" | "somewhat" | "no" | null;
  followUps: { question: string; answer: string | null }[];
  roles: { id: string; label: string }[];
  roleId: string | null;
  variants: PanelVariant[];
}

const initial: InterviewActionState = { error: null };

const button =
  "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-60";
const primary =
  "rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60";

function Hidden({ fields }: { fields: Record<string, string | number> }) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

function ErrorText({ state }: { state: InterviewActionState }) {
  return state.error ? (
    <p role="alert" className="text-sm text-danger">
      {state.error}
    </p>
  ) : null;
}

/** Whether a key press should count as a shortcut (not while typing). */
function isShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  const typing = target?.closest("input[type=text], textarea, [contenteditable]");
  return !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** Runs the model step over SSE and reports its progress. */
function useModelStep(targetSetId: string, demandId: string, auto: boolean) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const run = useCallback(
    async (regenerate = false) => {
      setError(null);
      setStatus(regenerate ? "Writing two new versions…" : "Starting…");
      let failed = false;
      try {
        const response = await fetch(`/api/target-sets/${targetSetId}/interview/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ demandId, regenerate }),
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const data = buffer
              .slice(0, end)
              .split("\n")
              .find((line) => line.startsWith("data: "));
            buffer = buffer.slice(end + 2);
            if (!data) continue;
            const event = JSON.parse(data.slice(6)) as { type: string; message?: string };
            if (event.type === "status") setStatus(event.message ?? null);
            if (event.type === "error") {
              failed = true;
              setError(event.message ?? "Something went wrong.");
            }
          }
        }
      } catch {
        failed = true;
        setError("Couldn't reach the app. Is it still running?");
      }
      setStatus(null);
      if (!failed) router.refresh();
    },
    [targetSetId, demandId, router],
  );

  useEffect(() => {
    // Once per mount (the panel remounts for each step).
    if (auto && !started.current) {
      started.current = true;
      void run();
    }
  }, [auto, run]);

  return { status, error, run };
}

function Transcript({ followUps }: { followUps: PanelProps["followUps"] }) {
  const answered = followUps.filter((f) => f.answer !== null);
  if (answered.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted">
        Your answers so far ({answered.length})
      </summary>
      <dl className="mt-2 space-y-2">
        {answered.map((f, i) => (
          <div key={i}>
            <dt className="text-xs text-muted">{f.question}</dt>
            <dd>{f.answer || <span className="text-muted">(skipped)</span>}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function AskStep({ props }: { props: PanelProps }) {
  const [state, action, pending] = useActionState(answerGap, initial);
  const forms = useRef<Record<string, HTMLFormElement | null>>({});
  const certification = props.gap.category === "certification";
  const options: { value: "yes" | "somewhat" | "no"; label: string; key: string }[] = [
    { value: "yes", label: "Yes", key: "1" },
    ...(certification ? [] : [{ value: "somewhat" as const, label: "Somewhat", key: "2" }]),
    { value: "no", label: "No", key: "3" },
  ];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event) || pending) return;
      const option = options.find((o) => o.key === event.key);
      if (option) forms.current[option.value]?.requestSubmit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <form
            key={option.value}
            action={action}
            ref={(el) => void (forms.current[option.value] = el)}
          >
            <Hidden
              fields={{
                targetSetId: props.targetSetId,
                demandId: props.gap.demandId,
                response: option.value,
              }}
            />
            <button type="submit" disabled={pending} className={option.value === "yes" ? primary : button}>
              {option.label} <kbd className="ml-1 text-xs opacity-70">{option.key}</kbd>
            </button>
          </form>
        ))}
      </div>
      <p className="text-xs text-muted">
        {certification
          ? "Yes adds it to your certifications. No adds it to your learning plan."
          : "Yes or Somewhat: a few quick questions, then a bullet for you to check. " +
            "No: it goes to your learning plan, never onto your resume."}
      </p>
      <ErrorText state={state} />
    </div>
  );
}

function RoleStep({ props }: { props: PanelProps }) {
  const [state, action, pending] = useActionState(chooseRole, initial);
  return (
    <form action={action} className="space-y-3">
      <Hidden fields={{ targetSetId: props.targetSetId, demandId: props.gap.demandId }} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Which role was this in?</legend>
        <div className="space-y-1.5">
          {props.roles.map((role, i) => (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="roleId" value={role.id} defaultChecked={i === 0} />
              {role.label}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" disabled={pending} className={primary}>
        Continue
      </button>
      <ErrorText state={state} />
    </form>
  );
}

function FollowUpStep({ props }: { props: PanelProps }) {
  const [state, action, pending] = useActionState(answerFollowUp, initial);
  const form = useRef<HTMLFormElement>(null);
  const answer = useRef<HTMLTextAreaElement>(null);
  const question = props.followUps.find((f) => f.answer === null)?.question ?? "";
  const asked = props.followUps.filter((f) => f.question !== "Confirmed in review").length;

  return (
    <form action={action} ref={form} className="space-y-3">
      <Hidden fields={{ targetSetId: props.targetSetId, demandId: props.gap.demandId }} />
      <label htmlFor="answer" className="block text-sm font-medium">
        <span className="mr-2 text-xs font-normal text-muted">Question {asked}</span>
        {question}
      </label>
      <textarea
        id="answer"
        name="answer"
        ref={answer}
        rows={3}
        autoFocus
        maxLength={2000}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            form.current?.requestSubmit();
          }
        }}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={primary}>
          Answer <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
        </button>
        <button
          type="button"
          disabled={pending}
          className={button}
          onClick={() => {
            if (answer.current) answer.current.value = "";
            form.current?.requestSubmit();
          }}
        >
          Skip this question
        </button>
        <span className="text-xs text-muted">Shift+Enter for a new line. Only facts you give go into the bullet.</span>
      </div>
      <ErrorText state={state} />
    </form>
  );
}

function Variant({
  props,
  index,
  variant,
  selected,
  onSelect,
}: {
  props: PanelProps;
  index: number;
  variant: PanelVariant;
  selected: boolean;
  onSelect: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction, saving] = useActionState(editVariant, initial);
  const [confirmState, confirmAction, confirming] = useActionState(confirmDraftClaim, initial);
  const fields = { targetSetId: props.targetSetId, demandId: props.gap.demandId, index };

  return (
    <li
      className={`space-y-2 rounded-lg border p-3 ${selected ? "border-accent" : "border-border"}`}
    >
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="variant" checked={selected} onChange={onSelect} className="mt-1" />
        <span>
          <kbd className="mr-1 text-xs text-muted">{index + 1}</kbd> {variant.text}
        </span>
      </label>
      {variant.keywordsHit.length > 0 && (
        <p className="flex flex-wrap gap-1.5 pl-6 text-xs">
          {variant.keywordsHit.map((k) => (
            <span key={k} className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">
              {k}
            </span>
          ))}
        </p>
      )}
      {variant.unverifiedClaims.length > 0 && (
        <div className="ml-6 space-y-1 rounded-md bg-warning-soft p-2 text-xs text-warning">
          <p className="font-medium">Not in your answers; confirm or edit before exporting:</p>
          <ul className="space-y-1">
            {variant.unverifiedClaims.map((claim) => (
              <li key={claim} className="flex items-start justify-between gap-2">
                <span>{claim}</span>
                <form action={confirmAction}>
                  <Hidden fields={{ ...fields, claim }} />
                  <button type="submit" disabled={confirming} className="shrink-0 underline">
                    It&apos;s true
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <ErrorText state={confirmState} />
        </div>
      )}
      {editing ? (
        <form action={editAction} className="space-y-2 pl-6" onSubmit={() => setEditing(false)}>
          <Hidden fields={fields} />
          <label htmlFor={`edit-${index}`} className="sr-only">
            Edit version {index + 1}
          </label>
          <textarea
            id={`edit-${index}`}
            name="text"
            defaultValue={variant.text}
            rows={3}
            maxLength={400}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" className={button}>
              Check and save
            </button>
            <button type="button" className={button} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} disabled={saving} className="ml-6 text-xs text-muted underline">
          {saving ? "Checking your edit…" : "Edit"}
        </button>
      )}
      <ErrorText state={editState} />
    </li>
  );
}

function DraftStep({ props, onRegenerate }: { props: PanelProps; onRegenerate: () => void }) {
  const [selected, setSelected] = useState(0);
  const [state, action, pending] = useActionState(acceptVariant, initial);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event) || pending) return;
      if (event.key === "1" || event.key === "2") {
        const i = Number(event.key) - 1;
        if (i < props.variants.length) setSelected(i);
      }
      if (event.key === "Enter" && !(event.target as HTMLElement)?.closest("button, a")) {
        event.preventDefault();
        form.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Pick the version to add under your role:</p>
      <ul className="space-y-2">
        {props.variants.map((variant, i) => (
          <Variant
            key={i}
            props={props}
            index={i}
            variant={variant}
            selected={selected === i}
            onSelect={() => setSelected(i)}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <form action={action} ref={form}>
          <Hidden
            fields={{
              targetSetId: props.targetSetId,
              demandId: props.gap.demandId,
              index: selected,
            }}
          />
          <button type="submit" disabled={pending} className={primary}>
            {pending ? "Adding…" : "Add to resume"} <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
          </button>
        </form>
        <button type="button" onClick={onRegenerate} disabled={pending} className={button}>
          Write new versions
        </button>
      </div>
      <p className="text-xs text-muted">
        Unconfirmed claims stay flagged on the bullet and block export until you confirm or edit
        them.
      </p>
      <ErrorText state={state} />
    </div>
  );
}

export function InterviewPanel(props: PanelProps) {
  const modelStage = props.stage === "needs_question" || props.stage === "needs_draft";
  const step = useModelStep(props.targetSetId, props.gap.demandId, modelStage);
  const [skipState, skipAction, skipping] = useActionState(skipGap, initial);
  const [undoState, undoAction, undoing] = useActionState(undoGap, initial);
  const { gap } = props;
  const gapFields = { targetSetId: props.targetSetId, demandId: gap.demandId };

  return (
    <section aria-labelledby="gap-heading" className="space-y-5">
      <div className="space-y-2">
        <h2 id="gap-heading" className="text-lg font-semibold">
          {gap.name}
          {gap.mustDo && (
            <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 align-middle text-xs font-normal text-accent">
              must-do
            </span>
          )}
        </h2>
        <p className="text-sm">
          {gap.jdCount} of your {props.jobCount} target roles{" "}
          {gap.jdCount === 1 ? "asks" : "ask"}{" "}
          for {gap.name}
          {gap.requiredCount > 0 && (
            <> ({gap.requiredCount} {gap.requiredCount === 1 ? "requires" : "require"} it)</>
          )}
          .{" "}
          {props.stage === "ask" && <strong>Have you done this?</strong>}
        </p>
        {gap.evidence[0] && props.stage === "ask" && (
          <p className="text-xs text-muted">
            Your resume comes close: “
            <Highlighted parts={excerpt(gap.evidence[0], gap.matchedTerm)} />”
          </p>
        )}
        {gap.sources.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Why this skill?</summary>
            <ul className="mt-1 space-y-1">
              {gap.sources.map((s) => (
                <li key={`${s.jobTitle}-${s.quote}`}>
                  <span className="text-muted">{s.jobTitle}:</span> “{s.quote}”
                </li>
              ))}
            </ul>
          </details>
        )}
        {props.response && props.response !== "no" && (
          <p className="text-xs text-muted">
            You answered {props.response === "yes" ? "Yes" : "Somewhat"}
            {props.response === "somewhat" && ": the bullet will describe your actual part"}.
          </p>
        )}
      </div>

      {props.stage === "ask" && <AskStep props={props} />}
      {props.stage === "role" && <RoleStep props={props} />}
      {props.stage === "follow_up" && <FollowUpStep props={props} />}
      {props.stage === "draft" && !step.status && (
        <DraftStep props={props} onRegenerate={() => void step.run(true)} />
      )}
      {step.status && (
        <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          {step.status}
        </p>
      )}
      {step.error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-danger">
            {step.error}
          </p>
          <button type="button" className={button} onClick={() => void step.run()}>
            Try again
          </button>
        </div>
      )}

      <Transcript followUps={props.followUps} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm">
        <form action={skipAction}>
          <Hidden fields={gapFields} />
          <button type="submit" disabled={skipping} className={button}>
            Skip for now
          </button>
        </form>
        {props.response && (
          <form
            action={undoAction}
            onSubmit={(event) => {
              if (!window.confirm(`Start over on ${gap.name}? Your answers for it are cleared.`)) {
                event.preventDefault();
              }
            }}
          >
            <Hidden fields={gapFields} />
            <button type="submit" disabled={undoing} className={button}>
              Start this one over
            </button>
          </form>
        )}
        <Link href={`/target-sets/${props.targetSetId}/gaps`} className="ml-auto text-accent underline">
          Pause
        </Link>
      </div>
      <ErrorText state={skipState} />
      <ErrorText state={undoState} />
    </section>
  );
}
