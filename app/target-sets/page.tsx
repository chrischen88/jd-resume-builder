import type { Metadata } from "next";
import Link from "next/link";

import { CreateForm } from "@/components/target-sets/create-form";
import { StatusBadge } from "@/components/target-sets/status-badge";
import { getResumeStore } from "@/lib/resume";
import { getAnalysisRunner, getTargetSetStore, MAX_JOBS } from "@/lib/target-sets";

// Screen 2 (TASKS 1.11): target sets, each a resume plus the JDs it's tailored to.

export const metadata: Metadata = { title: "Target sets · Resume Tailor" };
export const dynamic = "force-dynamic";

export default async function TargetSetsPage() {
  const [store, resumeStore, runner] = await Promise.all([
    getTargetSetStore(),
    getResumeStore(),
    getAnalysisRunner(),
  ]);
  const [sets, resumes] = await Promise.all([store.list(), resumeStore.list()]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Target sets</h1>
        <p className="mt-1 text-sm text-muted">
          Group 2–{MAX_JOBS} job descriptions you&apos;re aiming for, then analyze which skills
          they ask for and which your resume already shows.
        </p>
      </div>

      <section aria-labelledby="sets-heading">
        <h2 id="sets-heading" className="mb-3 text-sm font-semibold">
          Your sets <span className="font-normal text-muted">({sets.length})</span>
        </h2>
        {sets.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
            No target sets yet. Create one below.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sets.map((set) => (
              <li key={set.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/target-sets/${set.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {set.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {set.resumeTitle} · {set.jobCount} {set.jobCount === 1 ? "JD" : "JDs"}
                  </p>
                </div>
                <StatusBadge
                  // "analyzing" in the database with no run in memory means the app restarted.
                  status={
                    set.status === "analyzing" && !runner.isRunning(set.id) ? "failed" : set.status
                  }
                  analyzedAt={set.analyzedAt}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-heading">
        <h2 id="new-heading" className="mb-3 text-sm font-semibold">
          New target set
        </h2>
        {resumes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
            Import a resume first on the{" "}
            <Link href="/resume" className="text-accent underline">
              Resume
            </Link>{" "}
            page.
          </p>
        ) : (
          <CreateForm
            resumes={resumes.map((r) => ({
              id: r.id,
              title: r.title,
              confirmed: !!r.confirmedAt,
            }))}
          />
        )}
      </section>
    </div>
  );
}
