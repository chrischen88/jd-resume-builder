import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { saveBullet, saveSkillLine, saveSummary } from "@/app/target-sets/[id]/review/actions";
import { ClaimActions, RemoveBulletButton } from "@/components/review/bullet-actions";
import { InlineEditor } from "@/components/review/inline-editor";
import { getInterviewStore } from "@/lib/interview";
import { ADDED_SKILLS_LABEL } from "@/lib/interview/store";
import { getResumeStore } from "@/lib/resume";
import { getTargetSetStore, scoreTargetSet, type TargetSetScore } from "@/lib/target-sets";

// Screen 7 (TASKS 1.26): the tailored resume with the interview's changes
// highlighted, coverage before/after (1.24), inline edits, and DOCX/PDF
// download (1.25), which stays off while any claim is unconfirmed.

export const metadata: Metadata = { title: "Review · Resume Tailor" };
export const dynamic = "force-dynamic";

/** Coverage changes listed before "and N more". */
const SHOWN_CHANGES = 8;

const COVERAGE_WORDS = { covered: "shown", weak: "partly shown", missing: "not shown" };

const EXPORT_MESSAGES: Record<string, string> = {
  blocked: "Download is off until every claim below is confirmed or removed.",
  failed: "The file couldn't be made. Try again; if PDF keeps failing, try DOCX.",
};

function ScoreCard({ score }: { score: TargetSetScore }) {
  if (score.after === null) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
        No coverage score yet: analyze the set first.
      </p>
    );
  }
  const delta = score.after - (score.before ?? 0);
  const shown = score.changes.slice(0, SHOWN_CHANGES);
  return (
    <section aria-labelledby="score-heading" className="space-y-3 rounded-lg border border-border p-4">
      <h2 id="score-heading" className="text-sm font-semibold">
        Coverage
      </h2>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm text-muted">Before</span>
        <span className="text-2xl font-semibold text-muted">{score.before}</span>
        <span aria-hidden className="text-muted">
          →
        </span>
        <span className="text-sm text-muted">Now</span>
        <span className="text-2xl font-semibold">{score.after}</span>
        {delta !== 0 && (
          <span className={`text-sm ${delta > 0 ? "text-success" : "text-danger"}`}>
            {delta > 0 ? `+${delta}` : delta} points
          </span>
        )}
      </p>
      <p className="text-xs text-muted">
        Out of 100: how much of what your {score.skillCount} target skills ask for your resume
        shows, weighted by how many job descriptions ask and how strongly. &quot;Before&quot; is
        your resume without the interview&apos;s additions.
      </p>
      {shown.length > 0 && (
        <ul className="space-y-0.5 text-sm">
          {shown.map((c) => (
            <li key={c.key}>
              <span className="font-medium">{c.name}</span>{" "}
              <span className="text-muted">
                {COVERAGE_WORDS[c.before]} → {COVERAGE_WORDS[c.after]}
              </span>
            </li>
          ))}
          {score.changes.length > shown.length && (
            <li className="text-xs text-muted">
              and {score.changes.length - shown.length} more
            </li>
          )}
        </ul>
      )}
      {score.overused.length > 0 && (
        <p className="rounded bg-warning-soft p-2 text-xs text-warning">
          Used more than 3 times, which can read as keyword stuffing:{" "}
          {score.overused.map((o) => `“${o.phrase}” (${o.uses}×)`).join(", ")}. Consider
          rewording one of the new bullets.
        </p>
      )}
    </section>
  );
}

function Heading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="border-b border-border pb-1 text-xs font-semibold uppercase tracking-wide text-muted"
    >
      {children}
    </h2>
  );
}

export default async function ReviewPage({
  params,
  searchParams,
}: PageProps<"/target-sets/[id]/review">) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const set = await (await getTargetSetStore()).get(id.data);
  if (!set) notFound();

  const [resume, blockers, score] = await Promise.all([
    (await getResumeStore()).get(set.resumeId),
    (await getInterviewStore()).exportBlockers(set.resumeId),
    scoreTargetSet(set.id, set.resumeId),
  ]);
  if (!resume) notFound();
  const exportParam = (await searchParams).export;
  const exportMessage = typeof exportParam === "string" ? EXPORT_MESSAGES[exportParam] : undefined;

  const { sections, roles } = resume;
  const contact = [
    sections.contact.email,
    sections.contact.phone,
    sections.contact.location,
    ...sections.contact.links,
  ].filter(Boolean);
  const added = new Set(score.addedCertifications);
  const newBullets = roles.flatMap((r) =>
    r.bullets.filter((b) => b.source === "generated" && b.status === "accepted"),
  ).length;
  const blocked = blockers.length > 0;

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
        <h1 className="text-xl font-semibold">Review &amp; export</h1>
        <p className="mt-1 text-sm text-muted">
          Your resume with this set&apos;s changes{" "}
          <mark className="rounded bg-accent-soft px-1 text-foreground">highlighted</mark>. Click
          any line to edit it; Enter saves, Escape undoes. {newBullets}{" "}
          {newBullets === 1 ? "bullet" : "bullets"} from the interview.
        </p>
      </div>

      <ScoreCard score={score} />

      <section aria-labelledby="download-heading" className="space-y-3">
        <h2 id="download-heading" className="text-sm font-semibold">
          Download
        </h2>
        {exportMessage && (
          <p role="alert" className="rounded bg-warning-soft p-3 text-sm text-warning">
            {exportMessage}
          </p>
        )}
        {blocked && (
          <p className="rounded bg-warning-soft p-3 text-sm text-warning">
            {blockers.length} {blockers.length === 1 ? "bullet makes" : "bullets make"} claims
            you haven&apos;t confirmed (marked below). Confirm each one, or edit the bullet and
            mark it as no longer there, to download.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {(["docx", "pdf"] as const).map((format) => (
            <form key={format} method="post" action={`/api/target-sets/${set.id}/export`}>
              <input type="hidden" name="format" value={format} />
              <button
                type="submit"
                disabled={blocked}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
              >
                Download {format.toUpperCase()}
              </button>
            </form>
          ))}
          <p className="text-xs text-muted">
            One column, standard headings, plain text: easy for applicant tracking systems to read.
          </p>
        </div>
      </section>

      <article aria-label="Your resume" className="space-y-6 rounded-lg border border-border p-6 text-sm">
        <header className="text-center">
          <p className="text-lg font-semibold">{sections.contact.name ?? resume.title}</p>
          {contact.length > 0 && <p className="text-xs text-muted">{contact.join(" | ")}</p>}
        </header>

        <section aria-labelledby="r-summary" className="space-y-2">
          <Heading id="r-summary">Summary</Heading>
          <InlineEditor
            key={sections.summary ?? ""}
            value={sections.summary ?? ""}
            label="Summary"
            placeholder="Add a summary (optional)"
            save={saveSummary.bind(null, set.id)}
          />
        </section>

        <section aria-labelledby="r-experience" className="space-y-4">
          <Heading id="r-experience">Experience</Heading>
          {roles.map((role) => (
            <div key={role.id} className="space-y-1">
              <p className="font-medium">
                {role.title}, {role.employer}
              </p>
              <p className="text-xs italic text-muted">
                {[
                  role.location,
                  [role.startDate, role.endDate].filter(Boolean).join(" – "),
                ]
                  .filter(Boolean)
                  .join(" | ")}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {role.bullets
                  .filter((b) => b.status === "accepted")
                  .map((bullet) => {
                    const isNew = bullet.source === "generated";
                    const unconfirmed = bullet.unverifiedClaims.length > 0;
                    return (
                      <li
                        key={bullet.id}
                        className={
                          unconfirmed
                            ? "rounded bg-warning-soft px-1"
                            : isNew
                              ? "rounded bg-accent-soft px-1"
                              : ""
                        }
                      >
                        <InlineEditor
                          key={bullet.text}
                          value={bullet.text}
                          label={`${isNew ? "New bullet" : "Bullet"} under ${role.title}`}
                          save={saveBullet.bind(null, set.id, bullet.id)}
                        />
                        {isNew && (
                          <span className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-accent">New</span>
                            {bullet.keywordsHit.map((k) => (
                              <span key={k} className="rounded bg-background px-1.5 text-accent">
                                {k}
                              </span>
                            ))}
                            <RemoveBulletButton targetSetId={set.id} bulletId={bullet.id} />
                          </span>
                        )}
                        {bullet.unverifiedClaims.map((claim) => (
                          <span key={claim} className="mt-1 block text-xs text-warning">
                            Unconfirmed: {claim}.{" "}
                            <ClaimActions targetSetId={set.id} bulletId={bullet.id} claim={claim} />
                          </span>
                        ))}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </section>

        <section aria-labelledby="r-skills" className="space-y-1">
          <Heading id="r-skills">Skills</Heading>
          {sections.skills.map((line, i) => (
            <div
              key={`${i}-${line}`}
              className={line.startsWith(`${ADDED_SKILLS_LABEL}:`) ? "rounded bg-accent-soft px-1" : ""}
            >
              <InlineEditor
                value={line}
                label={`Skills line ${i + 1}`}
                placeholder="Empty lines are removed"
                save={saveSkillLine.bind(null, set.id, i, line)}
              />
            </div>
          ))}
        </section>

        {sections.education.length > 0 && (
          <section aria-labelledby="r-education" className="space-y-2">
            <Heading id="r-education">Education</Heading>
            {sections.education.map((e, i) => (
              <div key={`${i}-${e.institution}`}>
                <p className="font-medium">
                  {[[e.degree, e.field].filter(Boolean).join(", "), e.institution]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="text-xs italic text-muted">
                  {[e.location, [e.startDate, e.endDate].filter(Boolean).join(" – ")]
                    .filter(Boolean)
                    .join(" | ")}
                </p>
                {e.details.length > 0 && (
                  <ul className="list-disc pl-5">
                    {e.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        )}

        {sections.certifications.length > 0 && (
          <section aria-labelledby="r-certs" className="space-y-1">
            <Heading id="r-certs">Certifications</Heading>
            <ul className="list-disc pl-5">
              {sections.certifications.map((c) => (
                <li key={c} className={added.has(c) ? "rounded bg-accent-soft px-1" : ""}>
                  {c}
                </li>
              ))}
            </ul>
          </section>
        )}

        {sections.other.map((other, i) => (
          <section key={`${i}-${other.heading}`} aria-labelledby={`r-other-${i}`} className="space-y-1">
            <Heading id={`r-other-${i}`}>{other.heading}</Heading>
            <ul className="list-disc pl-5">
              {other.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        ))}
      </article>

      <div className="flex flex-wrap gap-4 border-t border-border pt-6 text-sm">
        <Link href={`/resume/${resume.id}`} className="text-accent underline">
          Edit roles, dates, and education
        </Link>
        <Link href={`/learning-plan?set=${set.id}`} className="text-accent underline">
          Your learning plan
        </Link>
        <Link href={`/target-sets/${set.id}/interview`} className="text-accent underline">
          Back to the interview
        </Link>
      </div>
    </div>
  );
}
