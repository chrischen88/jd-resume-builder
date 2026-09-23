import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { AnalyzeForm } from "@/components/analysis/analyze-form";
import { analyzeSet, type SkillAnalysisRow } from "@/lib/analysis/analyze-set";
import type { Coverage } from "@/lib/analysis/coverage";
import { currentExtractionKey, getExtractionStore, getLibrary } from "@/lib/library";

// Prototype (TASKS 0.7): skills table for a resume + several JDs. Only reads
// cached extractions; model calls happen in the `analyze` Server Action.

export const metadata: Metadata = { title: "Analysis · Resume Tailor" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  resume: z.uuid().nullable().catch(null),
  jds: z.array(z.uuid()).catch([]),
});

const COVERAGE_STYLE: Record<Coverage, string> = {
  covered: "text-success",
  weak: "text-accent",
  missing: "text-danger",
};

function toArray(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export default async function AnalysisPage({ searchParams }: PageProps<"/analysis">) {
  const raw = await searchParams;
  const params = paramsSchema.parse({
    resume: toArray(raw.resume)[0] ?? null,
    jds: toArray(raw.jd),
  });

  const library = await getLibrary();
  const docs = await library.list();
  const resumes = docs.filter((d) => d.kind === "resume");
  const jds = docs.filter((d) => d.kind === "jd");
  const cached = await (
    await getExtractionStore()
  ).cached(jds, currentExtractionKey());

  if (resumes.length === 0 || jds.length === 0) {
    return (
      <Shell>
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          Add at least one resume and one job description in the{" "}
          <Link href="/library" className="text-accent underline">
            Library
          </Link>{" "}
          first.
        </p>
      </Shell>
    );
  }

  const resume = resumes.find((d) => d.id === params.resume);
  const selectedJds = jds.filter((d) => params.jds.includes(d.id) && cached.has(d.id));
  const rows =
    resume && selectedJds.length > 0
      ? analyzeSet(
          selectedJds.map((d) => ({
            jobId: d.id,
            title: cached.get(d.id)!.job.title ?? undefined,
            text: d.text,
            keywords: cached.get(d.id)!.keywords,
          })),
          resume.text,
        )
      : null;

  return (
    <Shell>
      <AnalyzeForm
        resumes={resumes.map((d) => ({ id: d.id, title: d.title }))}
        jds={jds.map((d) => ({ id: d.id, title: d.title, cached: cached.has(d.id) }))}
        selectedResume={params.resume}
        selectedJds={params.jds}
      />
      {rows && resume && (
        <Results rows={rows} resumeTitle={resume.title} jobCount={selectedJds.length} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Analysis</h1>
        <p className="mt-1 text-sm text-muted">
          Pick a resume and the jobs you&apos;re targeting to see which skills they ask for and
          whether your resume shows them.
        </p>
      </div>
      {children}
    </div>
  );
}

function Results({
  rows,
  resumeTitle,
  jobCount,
}: {
  rows: SkillAnalysisRow[];
  resumeTitle: string;
  jobCount: number;
}) {
  const counts = { covered: 0, weak: 0, missing: 0 };
  for (const row of rows) counts[row.coverage]++;

  return (
    <section aria-labelledby="results-heading" className="space-y-3">
      <div>
        <h2 id="results-heading" className="text-sm font-semibold">
          {rows.length} skills across {jobCount} {jobCount === 1 ? "job" : "jobs"}
        </h2>
        <p className="text-xs text-muted">
          Against “{resumeTitle}”: {counts.covered} covered · {counts.weak} weak ·{" "}
          {counts.missing} missing. Must-do = asked for by at least half the jobs.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">#</th>
              <th scope="col" className="px-3 py-2 font-medium">Skill</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Demand</th>
              <th scope="col" className="px-3 py-2 font-medium">Asked by</th>
              <th scope="col" className="px-3 py-2 font-medium">Coverage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key} className="align-top">
                <td className="px-3 py-2 text-muted tabular-nums">{row.rank}</td>
                <td className="px-3 py-2">
                  <span className="font-medium">{row.name}</span>
                  <span className="ml-2 text-xs text-muted">{row.category.replace("_", " ")}</span>
                  {row.mustDo && (
                    <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
                      must-do
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.demandScore.toFixed(1)}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {row.jdCount} of {jobCount}
                  {row.requiredCount > 0 && (
                    <span className="ml-1 text-xs text-muted">({row.requiredCount} required)</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.resumeEvidence.length > 0 ? (
                    <details>
                      <summary className={`cursor-pointer ${COVERAGE_STYLE[row.coverage]}`}>
                        {row.coverage}
                        {row.matchedTerm && row.matchedTerm !== row.name && (
                          <span className="ml-1 text-xs text-muted">as “{row.matchedTerm}”</span>
                        )}
                      </summary>
                      <ul className="mt-1 space-y-1 text-xs text-muted">
                        {row.resumeEvidence.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <span className={COVERAGE_STYLE[row.coverage]}>{row.coverage}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
