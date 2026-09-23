"use client";

import { startTransition, useActionState, useEffect, useId, useRef } from "react";

import { addRole, saveRole, type RoleFormState } from "@/app/resume/actions";
import type { RoleField } from "@/lib/resume/ground";

export interface EditableRole {
  id: string;
  employer: string;
  title: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  bullets: string[];
}

type Props =
  | {
      mode: "edit";
      role: EditableRole;
      /** Values not found in the resume file, to point out. */
      flagged: { fields: RoleField[]; bullets: string[] };
    }
  | { mode: "add"; resumeId: string };

const initialState: RoleFormState = { status: "idle" };

const FIELD_CLASS = "w-full rounded-md border px-3 py-2 text-sm";
const NORMAL = "border-border bg-background";
const FLAGGED = "border-warning bg-warning-soft";

export function RoleEditor(props: Props) {
  const [state, formAction, pending] = useActionState(
    props.mode === "edit" ? saveRole : addRole,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const prefix = useId();
  const role = props.mode === "edit" ? props.role : null;
  const flagged = props.mode === "edit" ? props.flagged : { fields: [], bullets: [] };
  const isFlagged = (field: RoleField) => flagged.fields.includes(field);

  // A new role's form clears after it's added; an edited role keeps what was typed.
  useEffect(() => {
    if (props.mode === "add" && state.status === "saved") formRef.current?.reset();
  }, [props.mode, state]);

  function field(name: RoleField, label: string, required = false) {
    const id = `${prefix}-${name}`;
    const note = `${id}-note`;
    return (
      <div>
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
          {label}
        </label>
        <input
          id={id}
          name={name}
          type="text"
          required={required}
          maxLength={name === "startDate" || name === "endDate" ? 50 : 200}
          defaultValue={role?.[name] ?? ""}
          aria-describedby={isFlagged(name) ? note : undefined}
          className={`${FIELD_CLASS} ${isFlagged(name) ? FLAGGED : NORMAL}`}
        />
        {isFlagged(name) && (
          <p id={note} className="mt-1 text-xs text-warning">
            Not found in your resume file. Check it.
          </p>
        )}
      </div>
    );
  }

  const bulletsId = `${prefix}-bullets`;
  return (
    <form
      ref={formRef}
      // onSubmit instead of `action`, so React doesn't reset an edited role's
      // fields after saving.
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className="space-y-3"
    >
      {props.mode === "edit" ? (
        <input type="hidden" name="roleId" value={props.role.id} />
      ) : (
        <input type="hidden" name="resumeId" value={props.resumeId} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {field("title", "Title", true)}
        {field("employer", "Employer", true)}
        {field("location", "Location")}
        <div className="grid grid-cols-2 gap-3">
          {field("startDate", "Start")}
          {field("endDate", "End")}
        </div>
      </div>

      <div>
        <label htmlFor={bulletsId} className="mb-1 block text-xs font-medium text-muted">
          Bullets <span className="font-normal">(one per line)</span>
        </label>
        <textarea
          id={bulletsId}
          name="bullets"
          rows={Math.max(3, (role?.bullets.length ?? 0) + 1)}
          defaultValue={role?.bullets.join("\n") ?? ""}
          aria-describedby={flagged.bullets.length > 0 ? `${bulletsId}-note` : undefined}
          // Grows with its content, so wrapped bullets stay readable.
          className={`${FIELD_CLASS} ${flagged.bullets.length > 0 ? FLAGGED : NORMAL} field-sizing-content leading-relaxed`}
        />
        {flagged.bullets.length > 0 && (
          <div id={`${bulletsId}-note`} className="mt-1 text-xs text-warning">
            <p>Not found word for word in your resume file. Check these:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {flagged.bullets.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface disabled:opacity-60"
        >
          {pending ? "Saving…" : props.mode === "edit" ? "Save role" : "Add role"}
        </button>
        <p aria-live="polite" className="text-xs">
          {state.status === "saved" && !pending && (
            <span className="text-success">{props.mode === "edit" ? "Saved" : "Added"}</span>
          )}
        </p>
      </div>
      {state.status === "error" && (
        <ul role="alert" className="space-y-0.5 text-sm text-danger">
          {state.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
