import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { deleteTargetSet } from "@/app/target-sets/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { AddJobsForm } from "@/components/target-sets/add-jobs-form";
import { AnalyzePanel } from "@/components/target-sets/analyze-panel";
import { RemoveJobButton } from "@/components/target-sets/remove-job-button";
import { RenameForm } from "@/components/target-sets/rename-form";
import { StatusBadge } from "@/components/target-sets/status-badge";
import { getLibrary } from "@/lib/library";
import { getResumeStore } from "@/lib/resume";
import {
  getAnalysisRunner,
  getTargetSetStore,
  MAX_JOBS,
  MIN_JOBS,
  type SkillDemandSummary,
} from "@/lib/target-sets";

// Screen 2 (TASKS 1.11): pick a set's JDs from the library and analyze them.

export const metadata: Metadata = { title: "Target set · Resume Tailor" };
export const dynamic = "force-dynamic";

/** Skills shown before "Show all". */
const TOP_SKILLS = 15;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const COVERAGE = {
  covered: ["on your resume", "text-success"],
  weak: ["partly shown", "text-warning"],
  missing: ["not on your resume", "text-muted"],
} as const;

function SkillRows({
  skills,
  jobCount,
}: {
  skills: SkillDemandSummary[];
  /** The set's JD count, when the results are current. */
  jobCount: number | null;
}) {
  return (
    <ol className="divide-y divide-border">
      {skills.map((skill) => {
        const [label, style] = COVERAGE[skill.coverage];
        return (
          <li key={skill.skillId} className="flex items-baseline justify-between gap-3 px-4 py-2">
            <span className="min-w-0 text-sm">
              <span className="mr-2 inline-block w-6 text-right text-xs text-muted">
                {skill.rank}.
              </span>
              {skill.name}
              {skill.mustDo && (
                <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
                  must-do
                </span>
              )}
            </span>
            <span className="flex shrink-0 gap-3 text-xs">
              <span className="text-muted">
                asked by {skill.jdCount}
                {jobCount ? ` of ${jobCount}` : skill.jdCount === 1 ? " JD" : " JDs"}
              </span>
              <span className={`w-28 text-right ${style}`}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function TargetSetPage({ params }: PageProps<"/target-sets/[id]">) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const [store, runner, library, resumeStore] = await Promise.all([
    getTargetSetStore(),
    getAnalysisRunner(),
    getLibrary(),
    getResumeStore(),
  ]);
  const [set, status] = await Promise.all([store.get(id.data), runner.status(id.data)]);
  if (!set || !status) notFound();
  const [demands, libraryJds, resume] = await Promise.all([
    store.demands(set.id),
    library.list("jd"),
    resumeStore.get(set.resumeId),
  ]);

  const analyzing = status.status === "analyzing";
  const stale = status.status === "draft" && !!status.analyzedAt;
  const inSet = new Set(set.jobs.map((j) => j.documentId));
  const available = libraryJds.filter((d) => !inSet.has(d.id));
  const room = MAX_JOBS - set.jobs.length;
  const counts = {
    covered: demands.filter((d) => d.coverage === "covered").length,
    weak: demands.filter((d) => d.coverage === "weak").length,
    missing: demands.filter((d) => d.coverage === "missing").length,
  };
  // "of N" only while the results match the current JDs.
  const resultJobCount = status.status === "ready" ? set.jobs.length : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <div>
        <p className="text-xs text-muted">
          <Link href="/target-sets" className="hover:underline">
            Target sets
          </Link>{" "}
          /
        </p>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{set.name}</h1>
          <StatusBadge status={status.status} analyzedAt={status.analyzedAt} />
        </div>
        <p className="mt-1 text-sm text-muted">
          Tailoring{" "}
          <Link href={`/resume/${set.resumeId}`} className="text-accent underline">
            {set.resumeTitle}
          </Link>
          .{" "}
          {resume && !resume.confirmedAt && (
            <span className="text-warning">
              Its roles haven&apos;t been checked yet; check them first so the analysis reads
              your resume correctly.
            </span>
          )}
        </p>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-muted">Rename</summary>
          <RenameForm targetSetId={set.id} name={set.name} />
        </details>
      </div>

      <section aria-labelledby="jobs-heading" className="space-y-3">
        <h2 id="jobs-heading" className="text-sm font-semibold">
          Job descriptions{" "}
          <span className="font-normal text-muted">
            ({set.jobs.length} of {MAX_JOBS})
          </span>
        </h2>
        {set.jobs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
            No job descriptions yet. Add {MIN_JOBS} or more from your library below.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {set.jobs.map((job) => {
              const details = [job.company, job.title, job.seniority].filter(Boolean).join(" · ");
              const trimmed = job.wordCounts.original - job.wordCounts.clean;
              return (
                <li key={job.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{job.documentTitle}</p>
                    <p className="text-xs text-muted">
                      {details && <>{details} · </>}
                      {job.wordCounts.clean.toLocaleString()} words
                      {trimmed > 0 && (
                        <> ({trimmed.toLocaleString()} words of boilerplate left out)</>
                      )}
                    </p>
                  </div>
                  {!analyzing && (
                    <RemoveJobButton
                      targetSetId={set.id}
                      jobId={job.id}
                      title={job.documentTitle}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {analyzing ? (
          <p className="text-xs text-muted">
            Adding and removing job descriptions is paused while the analysis runs.
          </p>
        ) : room === 0 ? (
          <p className="text-xs text-muted">
            This set is full ({MAX_JOBS} job descriptions). Remove one to add another.
          </p>
        ) : available.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
            {libraryJds.length === 0
              ? "Your library has no job descriptions yet. "
              : "Every job description in your library is in this set. "}
            <Link href="/library" className="text-accent underline">
              Add more in the Library
            </Link>
            .
          </p>
        ) : (
          <>
            <AddJobsForm
              targetSetId={set.id}
              room={room}
              documents={available.map((d) => ({
                id: d.id,
                title: d.title,
                detail: `${wordCount(d.text).toLocaleString()} words`,
              }))}
            />
            <p className="text-xs text-muted">
              Need another?{" "}
              <Link href="/library" className="text-accent underline">
                Paste, upload, or import it in the Library
              </Link>
              , then pick it here.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="analyze-heading" className="space-y-3">
        <h2 id="analyze-heading" className="text-sm font-semibold">
          Analyze
        </h2>
        <AnalyzePanel
          // Remount when the server's view changes, e.g. JDs edited after a failure.
          key={`${status.status}-${status.analyzedAt?.getTime() ?? 0}`}
          targetSetId={set.id}
          initial={{ status: status.status, progress: status.progress, error: status.error }}
          canAnalyze={set.jobs.length >= MIN_JOBS}
          analyzedBefore={!!status.analyzedAt}
        />
      </section>

      {demands.length > 0 && !analyzing && (
        <section aria-labelledby="results-heading" className="space-y-3">
          <h2 id="results-heading" className="text-sm font-semibold">
            Results
          </h2>
          {stale && (
            <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
              The job descriptions changed since this analysis. Analyze again to update it.
            </p>
          )}
          <p className="text-sm">
            {demands.length} skills asked for:{" "}
            <span className="text-success">{counts.covered} on your resume</span>,{" "}
            <span className="text-warning">{counts.weak} partly shown</span>,{" "}
            <span className="text-muted">{counts.missing} not on your resume</span>. Must-do skills
            are asked for by at least half the job descriptions.
          </p>
          <p className="text-sm">
            <Link href={`/target-sets/${set.id}/strengths`} className="text-accent underline">
              See your strengths
            </Link>{" "}
            <span className="text-muted">(proof bullets, strongest bullets, rewordings)</span> ·{" "}
            <Link href={`/target-sets/${set.id}/gaps`} className="text-accent underline">
              Review your gaps
            </Link>{" "}
            <span className="text-muted">(order them for the interview)</span>
          </p>
          <div className="rounded-lg border border-border">
            <SkillRows skills={demands.slice(0, TOP_SKILLS)} jobCount={resultJobCount} />
            {demands.length > TOP_SKILLS && (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-4 py-2 text-xs text-muted">
                  Show all {demands.length}
                </summary>
                <SkillRows skills={demands.slice(TOP_SKILLS)} jobCount={resultJobCount} />
              </details>
            )}
          </div>
        </section>
      )}

      {!analyzing && (
        <section aria-labelledby="delete-heading" className="border-t border-border pt-6">
          <h2 id="delete-heading" className="sr-only">
            Delete set
          </h2>
          <ConfirmButton
            action={deleteTargetSet}
            fields={{ targetSetId: set.id }}
            message={
              `Delete “${set.name}”? Its analysis and gap answers are deleted too; ` +
              "the job descriptions stay in your library."
            }
            label="Delete target set"
          />
        </section>
      )}
    </div>
  );
}
