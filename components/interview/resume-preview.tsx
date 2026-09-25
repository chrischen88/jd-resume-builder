import { ADDED_SKILLS_LABEL } from "@/lib/interview/store";
import type { ResumeDetail } from "@/lib/resume/store";

import { ConfirmClaimButton } from "./confirm-claim-button";

// Screen 5, right side: the resume as it stands, with bullets and skills the
// interview added highlighted, and the current draft shown under its role.

export function ResumePreview({
  targetSetId,
  resume,
  draft,
}: {
  targetSetId: string;
  resume: ResumeDetail;
  /** The draft being reviewed, previewed under its role. */
  draft: { roleId: string; text: string } | null;
}) {
  const { sections } = resume;
  return (
    <article aria-label="Your resume" className="space-y-4 text-sm">
      <header>
        <p className="font-semibold">{sections.contact.name ?? resume.title}</p>
        {sections.summary && (
          <p className="mt-1 line-clamp-3 text-xs text-muted">{sections.summary}</p>
        )}
      </header>

      <section aria-labelledby="preview-skills" className="space-y-1">
        <h3 id="preview-skills" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Skills
        </h3>
        {sections.skills.map((line) => (
          <p
            key={line}
            className={line.startsWith(`${ADDED_SKILLS_LABEL}:`) ? "rounded bg-accent-soft px-1 text-accent" : ""}
          >
            {line}
          </p>
        ))}
        {sections.certifications.length > 0 && (
          <p className="text-xs">Certifications: {sections.certifications.join(", ")}</p>
        )}
      </section>

      <section aria-labelledby="preview-experience" className="space-y-3">
        <h3
          id="preview-experience"
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Experience
        </h3>
        {resume.roles.map((role) => (
          <div key={role.id} className="space-y-1">
            <p className="font-medium">
              {role.title}, {role.employer}
              <span className="ml-1 text-xs font-normal text-muted">
                {[role.startDate, role.endDate].filter(Boolean).join(" – ")}
              </span>
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {role.bullets
                .filter((b) => b.status === "accepted")
                .map((bullet) =>
                  bullet.source === "generated" ? (
                    <li key={bullet.id} className="rounded bg-accent-soft px-1">
                      {bullet.text}
                      {bullet.keywordsHit.length > 0 && (
                        <span className="ml-1 text-xs text-accent">
                          [{bullet.keywordsHit.join(", ")}]
                        </span>
                      )}
                      {bullet.unverifiedClaims.map((claim) => (
                        <p key={claim} className="mt-1 text-xs text-warning">
                          Unconfirmed: {claim}.{" "}
                          <ConfirmClaimButton
                            targetSetId={targetSetId}
                            resumeId={resume.id}
                            bulletId={bullet.id}
                            claim={claim}
                          />
                        </p>
                      ))}
                    </li>
                  ) : (
                    <li key={bullet.id}>{bullet.text}</li>
                  ),
                )}
              {draft?.roleId === role.id && (
                <li className="rounded border border-dashed border-warning px-1 text-warning">
                  Draft: {draft.text}
                </li>
              )}
            </ul>
          </div>
        ))}
      </section>
    </article>
  );
}
