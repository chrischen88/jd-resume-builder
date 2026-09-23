import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { confirmResume, deleteResume, deleteRole } from "@/app/resume/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { RoleEditor } from "@/components/resume/role-editor";
import type { ResumeSections } from "@/db/schema";
import { getLibrary } from "@/lib/library";
import { getResumeStore } from "@/lib/resume";
import { findUnsupportedValues, ROLE_FIELDS, unsupportedKey } from "@/lib/resume/ground";

// Screen 1, review step (TASKS 1.7): check and fix the parsed roles.

export const metadata: Metadata = { title: "Review resume · Resume Tailor" };
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function dates(start: string | null, end: string | null): string {
  return [start, end].filter(Boolean).join(" – ");
}

export default async function ReviewResumePage({ params }: PageProps<"/resume/[id]">) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const [store, library] = await Promise.all([getResumeStore(), getLibrary()]);
  const resume = await store.get(id.data);
  if (!resume) notFound();
  const source = resume.documentId ? await library.get(resume.documentId) : undefined;

  // Generated bullets never appear in the file; only parsed ones are checked here.
  const originals = (role: (typeof resume.roles)[number]) =>
    role.bullets.filter((b) => b.source === "original");
  const unsupported = source
    ? findUnsupportedValues(source.text, {
        sections: resume.sections,
        roles: resume.roles.map((role) => ({ ...role, bullets: originals(role) })),
      })
    : new Set<string>();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <div>
        <p className="text-xs text-muted">
          <Link href="/resume" className="hover:underline">
            Resume
          </Link>{" "}
          /
        </p>
        <h1 className="text-xl font-semibold">{resume.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {source ? (
            <>Read from “{source.title}”. </>
          ) : (
            <>The original file was removed from the library. </>
          )}
          {resume.confirmedAt ? (
            <span className="text-success">
              Checked on {dateFormat.format(resume.confirmedAt)}.
            </span>
          ) : (
            <span className="text-warning">Not checked yet.</span>
          )}
        </p>
      </div>

      {!resume.confirmedAt && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <p>
            Check each role against your resume: employer, title, dates, and bullets. Fix anything
            that was read wrong, then confirm at the bottom.
          </p>
          {unsupported.size > 0 && (
            <p className="mt-2 text-warning">
              {unsupported.size} {unsupported.size === 1 ? "value wasn't" : "values weren't"} found
              word for word in your file and {unsupported.size === 1 ? "is" : "are"} highlighted.
              Keep {unsupported.size === 1 ? "it" : "them"} only if correct.
            </p>
          )}
        </div>
      )}

      <section aria-labelledby="roles-heading" className="space-y-4">
        <h2 id="roles-heading" className="text-sm font-semibold">
          Experience <span className="font-normal text-muted">({resume.roles.length} roles)</span>
        </h2>
        {resume.roles.map((role) => (
          <article
            key={role.id}
            aria-label={`${role.title} at ${role.employer}`}
            className="space-y-3 rounded-lg border border-border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium">
                {role.title} · {role.employer}
                <span className="ml-2 text-xs font-normal text-muted">
                  {dates(role.startDate, role.endDate)}
                </span>
              </p>
              <ConfirmButton
                action={deleteRole}
                fields={{ roleId: role.id }}
                message={`Delete “${role.title}” at ${role.employer} and its bullets?`}
                label="Delete"
                ariaLabel={`Delete ${role.title} at ${role.employer}`}
              />
            </div>
            <RoleEditor
              mode="edit"
              role={{ ...role, bullets: originals(role).map((b) => b.text) }}
              flagged={{
                fields: ROLE_FIELDS.filter((f) => unsupported.has(unsupportedKey.role(role.id, f))),
                bullets: originals(role)
                  .filter((b) => unsupported.has(unsupportedKey.bullet(b.id)))
                  .map((b) => b.text),
              }}
            />
          </article>
        ))}
        <details className="rounded-lg border border-dashed border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Add a role that was missed
          </summary>
          <div className="mt-3">
            <RoleEditor mode="add" resumeId={resume.id} />
          </div>
        </details>
      </section>

      <Sections sections={resume.sections} unsupported={unsupported} />

      <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
        {resume.confirmedAt ? (
          <p className="text-sm text-muted">Edits save right away; no need to confirm again.</p>
        ) : (
          <form action={confirmResume}>
            <input type="hidden" name="resumeId" value={resume.id} />
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
            >
              Roles look right
            </button>
          </form>
        )}
        <ConfirmButton
          action={deleteResume}
          fields={{ resumeId: resume.id }}
          message={`Delete the imported resume “${resume.title}”? The file stays in your library.`}
          label="Delete imported resume"
        />
      </div>
    </div>
  );
}

/** The rest of the resume, read-only for now. */
function Sections({
  sections,
  unsupported,
}: {
  sections: ResumeSections;
  unsupported: Set<string>;
}) {
  const mark = (key: string) =>
    unsupported.has(unsupportedKey.section(key)) ? "rounded bg-warning-soft px-1 text-warning" : "";
  const { contact } = sections;
  const contactLine = [
    contact.name,
    contact.email,
    contact.phone,
    contact.location,
    ...contact.links,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-labelledby="other-heading" className="space-y-4 text-sm">
      <div>
        <h2 id="other-heading" className="text-sm font-semibold">
          Other sections
        </h2>
        <p className="text-xs text-muted">Read-only for now; editing these comes later.</p>
      </div>
      {contactLine && <p>{contactLine}</p>}
      {sections.summary && (
        <div>
          <h3 className="text-xs font-medium text-muted">Summary</h3>
          <p className={mark("summary")}>{sections.summary}</p>
        </div>
      )}
      {sections.skills.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted">Skills</h3>
          <ul>
            {sections.skills.map((line, i) => (
              <li key={i} className={mark(`skills[${i}]`)}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {sections.education.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted">Education</h3>
          <ul className="space-y-1">
            {sections.education.map((e, i) => (
              <li key={i}>
                {[e.degree, e.field].filter(Boolean).join(", ")}
                {e.degree || e.field ? " — " : ""}
                {e.institution}
                <span className="ml-2 text-xs text-muted">{dates(e.startDate, e.endDate)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sections.certifications.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted">Certifications</h3>
          <ul>
            {sections.certifications.map((line, i) => (
              <li key={i} className={mark(`certifications[${i}]`)}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {sections.other.map((section, i) => (
        <div key={i}>
          <h3 className="text-xs font-medium text-muted">{section.heading}</h3>
          <ul>
            {section.lines.map((line, j) => (
              <li key={j}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
