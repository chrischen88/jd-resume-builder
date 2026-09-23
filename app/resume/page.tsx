import type { Metadata } from "next";
import Link from "next/link";

import { ImportForm } from "@/components/resume/import-form";
import { getLibrary } from "@/lib/library";
import { getResumeStore } from "@/lib/resume";

// Screen 1 (TASKS 1.7): import a library resume, then review it on /resume/[id].

export const metadata: Metadata = { title: "Resume · Resume Tailor" };
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export default async function ResumesPage() {
  const [library, store] = await Promise.all([getLibrary(), getResumeStore()]);
  const [documents, resumes] = await Promise.all([library.list("resume"), store.list()]);
  const importedCount = (documentId: string) =>
    resumes.filter((r) => r.documentId === documentId).length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Resume</h1>
        <p className="mt-1 text-sm text-muted">
          Import a resume from your library, then check that its roles and bullets were read
          correctly.
        </p>
      </div>

      {documents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          No resumes in your library yet.{" "}
          <Link href="/library" className="text-accent underline">
            Add one
          </Link>{" "}
          first.
        </p>
      ) : (
        <ImportForm
          documents={documents.map((d) => ({
            id: d.id,
            title: d.title,
            imported: importedCount(d.id),
          }))}
        />
      )}

      <section aria-labelledby="imported-heading">
        <h2 id="imported-heading" className="mb-3 text-sm font-semibold">
          Imported <span className="font-normal text-muted">({resumes.length})</span>
        </h2>
        {resumes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
            Nothing imported yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {resumes.map((resume) => (
              <li key={resume.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <Link href={`/resume/${resume.id}`} className="text-sm font-medium hover:underline">
                  {resume.title}
                </Link>
                <span className="flex items-center gap-2 text-xs">
                  {resume.isMaster && (
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">master</span>
                  )}
                  {resume.confirmedAt ? (
                    <span className="text-success">checked</span>
                  ) : (
                    <span className="text-warning">needs review</span>
                  )}
                  <span className="text-muted">{dateFormat.format(resume.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
