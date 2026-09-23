import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { moveGap, setGapDismissed } from "@/app/target-sets/actions";
import { excerpt, Highlighted } from "@/components/target-sets/excerpt";
import {
  getAnalysisRunner,
  getGapStore,
  getTargetSetStore,
  type Direction,
  type Gap,
} from "@/lib/target-sets";

// Screen 4 (TASKS 1.15): the set's gaps in interview order, to reorder or
// dismiss before the interview (1.16).

export const metadata: Metadata = { title: "Gaps · Resume Tailor" };
export const dynamic = "force-dynamic";

/** Gaps listed before "Show the other N". */
const SHOWN_GAPS = 15;

const ANSWER_LABELS = { yes: "answered: yes", somewhat: "answered: somewhat", no: "answered: no" };
const IMPORTANCE_LABELS = { required: "required", preferred: "preferred", mentioned: "mentioned" };

function GapButton({
  targetSetId,
  gap,
  action,
  fields,
  label,
  ariaLabel,
  disabled = false,
}: {
  targetSetId: string;
  gap: Gap;
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="targetSetId" value={targetSetId} />
      <input type="hidden" name="demandId" value={gap.demandId} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        disabled={disabled}
        aria-label={ariaLabel}
        className="rounded px-2 py-1 text-xs text-muted hover:bg-surface hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
      >
        {label}
      </button>
    </form>
  );
}

function GapDetails({ gap, jobCount }: { gap: Gap; jobCount: number }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-medium">{gap.name}</span>
        {gap.mustDo && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">must-do</span>
        )}
        {gap.coverage === "weak" && (
          <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning">
            partly shown
          </span>
        )}
        {gap.answer && <span className="text-xs text-success">{ANSWER_LABELS[gap.answer]}</span>}
      </p>
      <p className="text-xs text-muted">
        asked by {gap.jdCount} of {jobCount}
        {gap.requiredCount > 0 && <> · required by {gap.requiredCount}</>}
      </p>
      {gap.evidence[0] && (
        <p className="text-xs text-muted">
          Closest on your resume: “
          <Highlighted parts={excerpt(gap.evidence[0], gap.matchedTerm)} />”
        </p>
      )}
      {gap.sources.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Why this skill?</summary>
          <ul className="mt-1 space-y-1">
            {gap.sources.map((source) => (
              <li key={`${source.jobTitle}-${source.quote}`}>
                <span className="text-muted">
                  {source.jobTitle} ({IMPORTANCE_LABELS[source.importance]}):
                </span>{" "}
                “{source.quote}”
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default async function GapsPage({ params }: PageProps<"/target-sets/[id]/gaps">) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const [store, runner, gapStore] = await Promise.all([
    getTargetSetStore(),
    getAnalysisRunner(),
    getGapStore(),
  ]);
  const [set, status] = await Promise.all([store.get(id.data), runner.status(id.data)]);
  if (!set || !status) notFound();
  const overview = await gapStore.overview(set.id);
  const stale = status.status === "draft" && !!status.analyzedAt;
  const mustDo = overview.active.filter((g) => g.mustDo).length;
  const move = (gap: Gap, direction: Direction, label: string, disabled: boolean) => (
    <GapButton
      targetSetId={set.id}
      gap={gap}
      action={moveGap}
      fields={{ direction }}
      label={label}
      ariaLabel={`Move ${gap.name} ${direction === "top" ? "to the top" : direction}`}
      disabled={disabled}
    />
  );

  const last = overview.active.length - 1;
  const gapRow = (gap: Gap, i: number) => (
    <li key={gap.demandId} className="flex items-start gap-3 px-4 py-3">
      <span className="w-6 shrink-0 pt-0.5 text-right text-xs text-muted">{i + 1}.</span>
      <GapDetails gap={gap} jobCount={overview.jobCount} />
      <div className="flex shrink-0 items-center">
        {move(gap, "top", "Top", i === 0)}
        {move(gap, "up", "↑", i === 0)}
        {move(gap, "down", "↓", i === last)}
        <GapButton
          targetSetId={set.id}
          gap={gap}
          action={setGapDismissed}
          fields={{ dismissed: "true" }}
          label="Dismiss"
          ariaLabel={`Dismiss ${gap.name}`}
        />
      </div>
    </li>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <div>
        <p className="text-xs text-muted">
          <Link href="/target-sets" className="hover:underline">
            Target sets
          </Link>{" "}
          /{" "}
          <Link href={`/target-sets/${set.id}`} className="hover:underline">
            {set.name}
          </Link>{" "}
          /
        </p>
        <h1 className="text-xl font-semibold">Gaps</h1>
        <p className="mt-1 text-sm text-muted">
          Skills these job descriptions ask for that your resume doesn&apos;t show yet. The
          interview asks about each in this order: have you done it? Put the ones that matter to
          you first, and dismiss any you don&apos;t want to be asked about.
        </p>
      </div>

      {status.status === "analyzing" ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">
          The set is being analyzed.{" "}
          <Link href={`/target-sets/${set.id}`} className="text-accent underline">
            Follow its progress
          </Link>
          .
        </p>
      ) : !status.analyzedAt ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          Nothing to show yet.{" "}
          <Link href={`/target-sets/${set.id}`} className="text-accent underline">
            Analyze the set
          </Link>{" "}
          first.
        </p>
      ) : (
        <>
          {stale && (
            <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
              Your resume or the job descriptions changed since the last analysis, so this may be
              out of date.{" "}
              <Link href={`/target-sets/${set.id}`} className="underline">
                Analyze again
              </Link>{" "}
              to update it; your order and dismissals are kept.
            </p>
          )}

          <section aria-labelledby="gaps-heading" className="space-y-3">
            <h2 id="gaps-heading" className="text-sm font-semibold">
              {overview.active.length} {overview.active.length === 1 ? "gap" : "gaps"}
              {mustDo > 0 && (
                <span className="font-normal text-muted">
                  {" "}
                  · {mustDo} must-do (asked by at least half the JDs)
                </span>
              )}
            </h2>
            {overview.active.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
                No gaps to ask about: your resume shows every skill these job descriptions ask
                for{overview.dismissed.length > 0 ? ", or you've dismissed the rest" : ""}.
              </p>
            ) : (
              <div className="rounded-lg border border-border">
                <ol className="divide-y divide-border">
                  {overview.active.slice(0, SHOWN_GAPS).map(gapRow)}
                </ol>
                {overview.active.length > SHOWN_GAPS && (
                  <details className="border-t border-border">
                    <summary className="cursor-pointer px-4 py-2 text-xs text-muted">
                      Show the other {overview.active.length - SHOWN_GAPS}
                    </summary>
                    <ol className="divide-y divide-border border-t border-border">
                      {overview.active
                        .slice(SHOWN_GAPS)
                        .map((gap, i) => gapRow(gap, i + SHOWN_GAPS))}
                    </ol>
                  </details>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
              >
                Start the interview
              </button>
              <p className="text-xs text-muted">The interview comes in the next update.</p>
            </div>
          </section>

          {overview.dismissed.length > 0 && (
            <section aria-labelledby="dismissed-heading" className="space-y-3">
              <h2 id="dismissed-heading" className="text-sm font-semibold">
                Dismissed{" "}
                <span className="font-normal text-muted">({overview.dismissed.length})</span>
              </h2>
              <p className="text-xs text-muted">
                Left out of the interview and the learning plan. Restore one to be asked about it.
              </p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {overview.dismissed.map((gap) => (
                  <li key={gap.demandId} className="flex items-start gap-3 px-4 py-3">
                    <GapDetails gap={gap} jobCount={overview.jobCount} />
                    <GapButton
                      targetSetId={set.id}
                      gap={gap}
                      action={setGapDismissed}
                      fields={{ dismissed: "false" }}
                      label="Restore"
                      ariaLabel={`Restore ${gap.name}`}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="border-t border-border pt-6 text-sm">
        <Link href={`/target-sets/${set.id}/strengths`} className="text-accent underline">
          Back to strengths
        </Link>
      </div>
    </div>
  );
}
