import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { z } from "zod";

import { setLearningStatus } from "@/app/learning-plan/actions";
import { RefreshWhilePending } from "@/components/learning-plan/refresh-while-pending";
import {
  DEMAND_GROUP_LABELS,
  fillPendingLearningPlans,
  getLearningPlanStore,
  groupByDemand,
  resourceKindLabel,
  type LearningItemView,
  type LearningStatus,
} from "@/lib/learning-plan";

// Screen 6 (TASKS 1.23): skills answered No or Somewhat, grouped by how many
// target roles ask for them, with what employers mean, their wordings,
// related skills, and generic ways to learn. Status toggles; Markdown export.

export const metadata: Metadata = { title: "Learning plan · Resume Tailor" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<LearningStatus, string> = {
  to_learn: "To learn",
  learning: "Learning",
  done: "Done",
};

function StatusToggle({ item }: { item: LearningItemView }) {
  return (
    <form
      action={setLearningStatus}
      role="group"
      aria-label={`Status of ${item.name}`}
      className="flex shrink-0 overflow-hidden rounded-md border border-border text-xs"
    >
      <input type="hidden" name="itemId" value={item.id} />
      {(Object.keys(STATUS_LABELS) as LearningStatus[]).map((status) => (
        <button
          key={status}
          type="submit"
          name="status"
          value={status}
          aria-pressed={item.status === status}
          className={
            item.status === status
              ? "bg-accent px-2 py-1 text-accent-foreground"
              : "px-2 py-1 text-muted hover:bg-surface hover:text-foreground"
          }
        >
          {STATUS_LABELS[status]}
        </button>
      ))}
    </form>
  );
}

function ItemCard({ item, showSet }: { item: LearningItemView; showSet: boolean }) {
  return (
    <li className="space-y-2 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={`font-medium ${item.status === "done" ? "text-muted line-through" : ""}`}>
            {item.name}
          </h3>
          <p className="text-xs text-muted">
            asked by {item.jdCount}
            {item.jobCount ? ` of ${item.jobCount}` : ""}
            {showSet && item.targetSetName && <> · {item.targetSetName}</>}
          </p>
        </div>
        <StatusToggle item={item} />
      </div>

      {item.planned ? (
        <>
          {item.meaning && <p className="text-sm">{item.meaning}</p>}
          <dl className="space-y-1 text-xs">
            {item.keywords.length > 0 && (
              <div className="flex flex-wrap items-baseline gap-1">
                <dt className="text-muted">Job descriptions say:</dt>
                {item.keywords.map((k) => (
                  <dd key={k} className="rounded bg-surface px-1.5 py-0.5">
                    {k}
                  </dd>
                ))}
              </div>
            )}
            {item.relatedSkills.length > 0 && (
              <div className="flex flex-wrap items-baseline gap-1">
                <dt className="text-muted">Related skills:</dt>
                <dd>{item.relatedSkills.join(", ")}</dd>
              </div>
            )}
          </dl>
          {item.resources.length > 0 && (
            <div className="text-sm">
              <p className="text-xs text-muted">Ways to learn it</p>
              <ul className="mt-1 space-y-1">
                {item.resources.map((r) => (
                  <li key={`${r.kind}-${r.description}`}>
                    <span className="font-medium">{resourceKindLabel(r.kind)}:</span>{" "}
                    {r.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted" role="status">
          Writing the plan for this skill…
        </p>
      )}
    </li>
  );
}

export default async function LearningPlanPage({ searchParams }: PageProps<"/learning-plan">) {
  const setParam = z.uuid().safeParse((await searchParams).set);
  const targetSetId = setParam.success ? setParam.data : undefined;

  const store = await getLearningPlanStore();
  const [items, sets] = await Promise.all([store.list({ targetSetId }), store.sets()]);
  const currentSet = sets.find((s) => s.id === targetSetId);

  // Plans that failed or haven't run yet are written after this response (task 1.22).
  const pending = items.filter((i) => !i.planned);
  const pendingSets = new Set(pending.flatMap((i) => (i.targetSetId ? [i.targetSetId] : [])));
  if (pendingSets.size > 0) {
    after(async () => {
      for (const id of pendingSets) await fillPendingLearningPlans(id);
    });
  }

  const done = items.filter((i) => i.status === "done").length;
  const exportHref = `/api/learning-plan/export${targetSetId ? `?set=${targetSetId}` : ""}`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <RefreshWhilePending pending={pending.length} />
      <div>
        {currentSet && (
          <p className="text-xs text-muted">
            <Link href="/target-sets" className="hover:underline">
              Target sets
            </Link>{" "}
            /{" "}
            <Link href={`/target-sets/${currentSet.id}`} className="hover:underline">
              {currentSet.name}
            </Link>{" "}
            /
          </p>
        )}
        <h1 className="text-xl font-semibold">Learning plan</h1>
        <p className="mt-1 text-sm text-muted">
          Skills you said you haven&apos;t done, or have only partly done. None of these go on
          your resume; they&apos;re here to learn, most asked-for first.
        </p>
      </div>

      {sets.length > 1 && (
        <nav aria-label="Filter by target set" className="flex flex-wrap gap-2 text-xs">
          <Link
            href="/learning-plan"
            aria-current={!targetSetId ? "page" : undefined}
            className="rounded-full border border-border px-3 py-1 aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
          >
            All sets
          </Link>
          {sets.map((s) => (
            <Link
              key={s.id}
              href={`/learning-plan?set=${s.id}`}
              aria-current={s.id === targetSetId ? "page" : undefined}
              className="rounded-full border border-border px-3 py-1 aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
            >
              {s.name}
            </Link>
          ))}
        </nav>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          Nothing here yet. When you answer No or Somewhat in a gap interview, the skill is added
          to this plan.{" "}
          <Link href="/target-sets" className="text-accent underline">
            Go to your target sets
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>
              {items.length} {items.length === 1 ? "skill" : "skills"}
              <span className="text-muted"> · {done} done</span>
            </p>
            <a href={exportHref} className="text-accent underline" download>
              Download as a checklist (Markdown)
            </a>
          </div>
          {groupByDemand(items).map(({ group, items: groupItems }) => (
            <section key={group} aria-labelledby={`group-${group}`} className="space-y-3">
              <h2 id={`group-${group}`} className="text-sm font-semibold">
                {DEMAND_GROUP_LABELS[group]}{" "}
                <span className="font-normal text-muted">({groupItems.length})</span>
              </h2>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {groupItems.map((item) => (
                  <ItemCard key={item.id} item={item} showSet={!targetSetId && sets.length > 1} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
