"use client";

import { useActionState } from "react";

import { removeBullet, resolveClaim, type SaveResult } from "@/app/target-sets/[id]/review/actions";

// Screen 7 (task 1.26): resolve an unconfirmed claim on a bullet, or take an
// interview bullet off the resume.

const initial: SaveResult = { error: null };

function Hidden({ fields }: { fields: Record<string, string> }) {
  return Object.entries(fields).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
}

/** "It's true" and "Not in it anymore" both clear the claim: the user has checked it. */
export function ClaimActions(fields: { targetSetId: string; bulletId: string; claim: string }) {
  const [state, action, pending] = useActionState(resolveClaim, initial);
  return (
    <form action={action} className="inline-flex flex-wrap items-baseline gap-2">
      <Hidden fields={fields} />
      <button type="submit" disabled={pending} className="underline">
        It&apos;s true
      </button>
      <button
        type="submit"
        disabled={pending}
        className="underline"
        title="You edited the bullet and it no longer says this"
      >
        Not in it anymore
      </button>
      {state.error && <span role="alert">{state.error}</span>}
    </form>
  );
}

export function RemoveBulletButton(fields: { targetSetId: string; bulletId: string }) {
  const [state, action, pending] = useActionState(removeBullet, initial);
  return (
    <form
      action={action}
      className="inline"
      onSubmit={(event) => {
        if (!window.confirm("Take this bullet off your resume? Its answers stay in your library.")) {
          event.preventDefault();
        }
      }}
    >
      <Hidden fields={fields} />
      <button type="submit" disabled={pending} className="text-xs text-muted underline">
        Remove
      </button>
      {state.error && (
        <span role="alert" className="ml-1 text-xs text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
