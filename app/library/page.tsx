import type { Metadata } from "next";

import { DeleteButton } from "@/components/library/delete-button";
import { UploadForm } from "@/components/library/upload-form";
import type { DocumentRow } from "@/db/schema";
import { getLibrary } from "@/lib/library";

export const metadata: Metadata = { title: "Library · Resume Tailor" };
// Reads the local database on every request.
export const dynamic = "force-dynamic";

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** "linkedin.com" from "https://www.linkedin.com/jobs/view/…". */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function DocumentList({
  id,
  heading,
  empty,
  items,
}: {
  id: string;
  heading: string;
  empty: string;
  items: DocumentRow[];
}) {
  return (
    <section aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="mb-3 text-sm font-semibold">
        {heading} <span className="font-normal text-muted">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((doc) => (
            <li key={doc.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <details className="min-w-0 flex-1">
                  <summary className="cursor-pointer text-sm font-medium">
                    {doc.title}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {doc.filename ?? (doc.sourceUrl ? hostOf(doc.sourceUrl) : "pasted")} ·{" "}
                      {wordCount(doc.text).toLocaleString()} words ·{" "}
                      {dateFormat.format(doc.createdAt)}
                    </span>
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-surface p-3 font-sans text-xs leading-relaxed">
                    {doc.text}
                  </pre>
                </details>
                <DeleteButton id={doc.id} title={doc.title} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function LibraryPage() {
  const library = await getLibrary();
  const docs = await library.list();
  const jds = docs.filter((d) => d.kind === "jd");
  const resumes = docs.filter((d) => d.kind === "resume");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Library</h1>
        <p className="mt-1 text-sm text-muted">
          Job descriptions and resumes you add are saved on this computer and stay here between
          sessions.
        </p>
      </div>
      <UploadForm />
      <DocumentList
        id="resumes"
        heading="Resumes"
        empty="No resumes yet. Add one above."
        items={resumes}
      />
      <DocumentList
        id="jds"
        heading="Job descriptions"
        empty="No job descriptions yet. Add a few for the roles you're targeting."
        items={jds}
      />
    </div>
  );
}
