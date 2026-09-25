"use client";

import { useActionState } from "react";

import {
  confirmBulletClaim,
  type InterviewActionState,
} from "@/app/target-sets/[id]/interview/actions";

const initial: InterviewActionState = { error: null };

/** Confirms an unverified claim on an accepted bullet (it then stops blocking export). */
export function ConfirmClaimButton(fields: {
  targetSetId: string;
  resumeId: string;
  bulletId: string;
  claim: string;
}) {
  const [state, action, pending] = useActionState(confirmBulletClaim, initial);
  return (
    <form action={action} className="inline">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" disabled={pending} className="underline">
        It&apos;s true
      </button>
      {state.error && <span role="alert"> {state.error}</span>}
    </form>
  );
}
