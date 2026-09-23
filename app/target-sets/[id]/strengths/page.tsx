import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { SuggestButton } from "@/components/target-sets/suggest-button";
import { excerpt, Highlighted, phraseSegments } from "@/components/target-sets/excerpt";
import { SuggestionCard } from "@/components/target-sets/suggestion-card";
import type { BulletStrength } from "@/lib/analysis/strength";
import {
  getAnalysisRunner,
  getSuggestionStore,
  getTargetSetStore,
  type ScoredBullet,
  type TargetSetStrengths,
} from "@/lib/target-sets";

// Screen 3 (TASKS 1.14): what the resume already shows for a target set:
// covered skills with proof bullets, the strongest bullets, and rewording
// suggestions (applied only when accepted).

export const metadata: Metadata = { title: "Strengths · Resume Tailor" };
export const dynamic = "force-dynamic";

function StrengthTags({ strength }: { strength: BulletStrength }) {
  const tags = [
    strength.verb === "strong" && "strong verb",
    strength.verb === "weak" && "weak opening",
    strength.hasScope && "scope",
    strength.hasResult && "measurable result",
  ].filter((t): t is string => !!t);
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">{strength.score.toFixed(1)} of 5</span>
      {tags.map((tag) => (
        <span
          key={tag}
          className={`rounded px-1.5 py-0.5 ${
            tag === "weak opening" ? "bg-warning-soft text-warning" : "bg-surface text-muted"
          }`}
        >
          {tag}
        </span>
      ))}
      {strength.skills.map((skill) => (
        <span key={skill} className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">
          {skill}
        </span>
      ))}
    </p>
  );
}

function SkillLine({
  skill,
  jobCount,
}: {
  skill: TargetSetStrengths["covered"][number];
  jobCount: number;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="font-medium">{skill.name}</span>
      {skill.mustDo && (
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">must-do</span>
      )}
      <span className="text-xs text-muted">
        asked by {skill.jdCount} of {jobCount}
      </span>
    </p>
  );
}

function BulletQuote({ bullet }: { bullet: ScoredBullet }) {
  return (
    <div className="space-y-1">
      <p className="text-sm">{bullet.text}</p>
      <p className="text-xs text-muted">
        {bullet.roleTitle}, {bullet.employer}
      </p>
      <StrengthTags strength={bullet.strength} />
    </div>
  );
}

export default async function StrengthsPage({ params }: PageProps<"/target-sets/[id]/strengths">) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const [store, runner, suggestionStore] = await Promise.all([
    getTargetSetStore(),
    getAnalysisRunner(),
    getSuggestionStore(),
  ]);
  const [set, status] = await Promise.all([store.get(id.data), runner.status(id.data)]);
  if (!set || !status) notFound();
  const [strengths, suggestions] = await Promise.all([
    store.strengths(set.id),
    suggestionStore.list(set.id),
  ]);
  const analyzed = !!status.analyzedAt;
  const proven = strengths?.covered.filter((c) => c.proof) ?? [];
  const namedOnly = strengths?.covered.filter((c) => !c.proof) ?? [];
  const stale = status.status === "draft" && !!status.analyzedAt;

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
        <h1 className="text-xl font-semibold">Strengths</h1>
        <p className="mt-1 text-sm text-muted">
          What {set.resumeTitle} already shows for the {set.jobs.length} job descriptions in this
          set.
        </p>
      </div>

      {status.status === "analyzing" ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">
          The set is being analyzed.{" "}
          <Link href={`/target-sets/${set.id}`} className="text-accent underline">
            Follow its progress
          </Link>
          .
        </p>
      ) : !analyzed || !strengths ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          Nothing to show yet.{" "}
          <Link href={`/target-sets/${set.id}`} className="text-accent underline">
            Analyze the set
          </Link>{" "}
          first.
        </p>
      ) : (
        <>
          {stale && (
            <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
              Your resume or the job descriptions changed since the last analysis, so this may be
              out of date.{" "}
              <Link href={`/target-sets/${set.id}`} className="underline">
                Analyze again
              </Link>{" "}
              to update it.
            </p>
          )}

          <section aria-labelledby="covered-heading" className="space-y-3">
            <div>
              <h2 id="covered-heading" className="text-sm font-semibold">
                In-demand skills your bullets prove{" "}
                <span className="font-normal text-muted">({proven.length})</span>
              </h2>
              <p className="text-xs text-muted">Each with the bullet that shows it best.</p>
            </div>
            {proven.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
                No bullet names a skill these JDs ask for yet. The gap interview and the
                suggestions below can help.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {proven.map((skill) => (
                  <li key={skill.skillId} className="space-y-2 px-4 py-3">
                    <SkillLine skill={skill} jobCount={strengths.jobCount} />
                    <div className="border-l-2 border-success pl-3">
                      <BulletQuote bullet={skill.proof!} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {namedOnly.length > 0 && (
            <section aria-labelledby="named-heading" className="space-y-3">
              <div>
                <h2 id="named-heading" className="text-sm font-semibold">
                  Named, but not shown in a bullet{" "}
                  <span className="font-normal text-muted">({namedOnly.length})</span>
                </h2>
                <p className="text-xs text-muted">
                  These appear in your skills list or summary only. A bullet that shows the skill
                  in use makes the claim credible; the gap interview can help you add one.
                </p>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {namedOnly.map((skill) => (
                  <li key={skill.skillId} className="space-y-1 px-4 py-2">
                    <SkillLine skill={skill} jobCount={strengths.jobCount} />
                    {skill.evidence[0] && (
                      <p className="text-xs text-muted">
                        <Highlighted parts={excerpt(skill.evidence[0], skill.matchedTerm)} />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="strongest-heading" className="space-y-3">
            <div>
              <h2 id="strongest-heading" className="text-sm font-semibold">
                Your strongest bullets
              </h2>
              <p className="text-xs text-muted">
                Scored on a strong opening verb, concrete scope, a measurable result, and the
                in-demand skills they name.
              </p>
            </div>
            <ol className="divide-y divide-border rounded-lg border border-border">
              {strengths.strongest.map((bullet) => (
                <li key={bullet.bulletId} className="px-4 py-3">
                  <BulletQuote bullet={bullet} />
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="suggestions-heading" className="space-y-3">
            <div>
              <h2 id="suggestions-heading" className="text-sm font-semibold">
                Rewording suggestions{" "}
                {suggestions.length > 0 && (
                  <span className="font-normal text-muted">({suggestions.length})</span>
                )}
              </h2>
              <p className="text-xs text-muted">
                For bullets that already show a skill in different words: the same facts, in the
                wording the job descriptions use. Your resume changes only if you choose “Use this
                wording”.
              </p>
            </div>
            <SuggestButton targetSetId={set.id} />
            {suggestions.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {suggestions.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    targetSetId={set.id}
                    suggestionId={s.id}
                    skillName={s.skillName}
                    where={`${s.roleTitle}, ${s.employer}`}
                    original={s.originalText}
                    suggested={phraseSegments(s.suggestedText, s.jdPhrase)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-6 text-sm">
        <Link
          href={`/target-sets/${set.id}/gaps`}
          className="rounded-md bg-accent px-4 py-2 font-medium text-accent-foreground"
        >
          Next: your gaps
        </Link>
        <Link href={`/target-sets/${set.id}`} className="text-accent underline">
          Back to {set.name}
        </Link>
      </div>
    </div>
  );
}
