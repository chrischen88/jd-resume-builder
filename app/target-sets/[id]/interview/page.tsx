import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InterviewPanel } from "@/components/interview/interview-panel";
import { ResumePreview } from "@/components/interview/resume-preview";
import { getInterviewStore, roleLabel } from "@/lib/interview";
import { getResumeStore } from "@/lib/resume";
import { getAnalysisRunner, getTargetSetStore } from "@/lib/target-sets";

// Screen 5 (TASKS 1.21): the gap interview. Left: the current gap's question;
// right: the resume as it changes. Progress is saved after every answer.

export const metadata: Metadata = { title: "Interview · Resume Tailor" };
export const dynamic = "force-dynamic";

export default async function InterviewPage({ params }: PageProps<"/target-sets/[id]/interview">) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const [store, runner, interview, resumes] = await Promise.all([
    getTargetSetStore(),
    getAnalysisRunner(),
    getInterviewStore(),
    getResumeStore(),
  ]);
  const [set, status] = await Promise.all([store.get(id.data), runner.status(id.data)]);
  if (!set || !status) notFound();

  const breadcrumb = (
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
  );

  if (!status.analyzedAt || status.status === "analyzing") {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8">
        {breadcrumb}
        <h1 className="text-xl font-semibold">Interview</h1>
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          {status.status === "analyzing"
            ? "The set is being analyzed. "
            : "Nothing to ask about yet. "}
          <Link href={`/target-sets/${set.id}`} className="text-accent underline">
            {status.status === "analyzing" ? "Follow its progress" : "Analyze the set"}
          </Link>{" "}
          first.
        </p>
      </div>
    );
  }

  const [view, resume] = await Promise.all([interview.view(set.id), resumes.get(set.resumeId)]);
  if (!resume) notFound();
  const current = view.current;
  const draftVariant = current?.answer?.draft?.variants[0];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
      <div className="space-y-3">
        {breadcrumb}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">Interview</h1>
          <p className="text-sm text-muted">
            <Link href={`/target-sets/${set.id}/gaps`} className="underline">
              {view.learningCount} in your learning plan
            </Link>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-sm">
            {view.position
              ? `Gap ${view.position} of ${view.total}`
              : `All ${view.total} gaps answered`}
            <span className="text-muted"> · {view.done} done</span>
          </p>
          <progress
            max={Math.max(view.total, 1)}
            value={view.done}
            aria-label="Interview progress"
            className="h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-accent"
          />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          {current ? (
            <InterviewPanel
              // A fresh panel for each step, so its local state starts over.
              key={[
                current.gap.demandId,
                current.stage,
                current.answer?.followUps.length ?? 0,
              ].join("-")}
              targetSetId={set.id}
              jobCount={view.jobCount}
              gap={{
                demandId: current.gap.demandId,
                name: current.gap.name,
                category: current.gap.category,
                coverage: current.gap.coverage,
                jdCount: current.gap.jdCount,
                requiredCount: current.gap.requiredCount,
                mustDo: current.gap.mustDo,
                evidence: current.gap.evidence,
                matchedTerm: current.gap.matchedTerm,
                sources: current.gap.sources,
              }}
              stage={current.stage}
              response={current.answer?.response ?? null}
              followUps={current.answer?.followUps ?? []}
              roles={view.roles.map((r) => ({ id: r.id, label: roleLabel(r) }))}
              roleId={current.answer?.roleId ?? null}
              variants={(current.answer?.draft?.variants ?? []).map((v) => ({
                text: v.text,
                keywordsHit: v.keywordsHit,
                unverifiedClaims: v.unverifiedClaims,
              }))}
            />
          ) : (
            <section className="space-y-3 rounded-lg border border-border bg-surface p-5 text-sm">
              <h2 className="text-base font-semibold">That&apos;s every gap</h2>
              <p>
                {view.total === 0
                  ? "There are no gaps left to ask about."
                  : "Each one is either on your resume now or in your learning plan."}{" "}
                Dismissed skills stay out of the interview; restore them on the gaps page.
              </p>
              <p className="flex flex-wrap gap-4">
                <Link href={`/target-sets/${set.id}/strengths`} className="text-accent underline">
                  See your strengths
                </Link>
                <Link href={`/target-sets/${set.id}/gaps`} className="text-accent underline">
                  Review your gaps
                </Link>
              </p>
            </section>
          )}
        </div>
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-auto">
          <div className="rounded-lg border border-border p-4">
            <ResumePreview
              targetSetId={set.id}
              resume={resume}
              draft={
                current?.stage === "draft" && draftVariant && current.answer?.roleId
                  ? { roleId: current.answer.roleId, text: draftVariant.text }
                  : null
              }
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
