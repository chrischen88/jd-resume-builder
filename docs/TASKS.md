# Build Plan

Work top to bottom. Each task should end with passing `npm run typecheck && npm run lint && npm test`. Check a task off when it's done and note anything left open underneath it.

## Phase 0 — Prototype (1 week)

Goal: prove the analysis is useful before building UI.

- [x] 0.1 Scaffold Next.js + TypeScript + Tailwind + Vitest; add `lib/ai/client.ts` wrapper around `@anthropic-ai/sdk` with Zod-validated JSON output and one retry on invalid output.
  - Model defaults to `claude-opus-5` (override with `ANTHROPIC_MODEL`); server-side refusal fallback enabled (`fallbacks: "default"`). Model calls go through LangChain (`ChatAnthropic` / `ChatOpenAI`); OpenAI via `AI_PROVIDER=openai` + `OPENAI_MODEL` (Responses API, `store: false`). Chroma vector store + OpenAI embeddings scaffolded in `lib/vector` (not yet wired to data; see 1.10). Callers log post-call guardrail counts via `AiGuardrailLogger` (`event: ai_guardrail`; used by 0.3).
- [x] 0.2 Add 10+ real JDs to `tests/fixtures/jds/` and 2 resumes to `tests/fixtures/resumes/`.
  - Settled for 7 JDs (`jd1`–`jd7`); add more if recall tests in 1.27 need them. Resumes: `resume1.docx` (real) and `resume2.md` (fictional backend/platform engineer, written to stress coverage matching: lowercase "go" verb, "R&D", "C#", "sparked", "k8s", plurals, curly quotes). JDs and resumes are git-ignored, so fixture-based tests run locally only (they skip when files are absent).
- [x] 0.3 Keyword extraction prompt + schema (SPEC §AI design 1). Drop items whose `evidence_quote` isn't verbatim in the JD. Golden test: JSON valid for all fixtures.
  - Prompt `lib/ai/prompts/extract-keywords.ts` (v1.1.0) also extracts job company/title/seniority/min years (F5). `extractJobKeywords()` in `lib/ai/extract-keywords.ts`; grounding in `lib/analysis/evidence.ts` (verbatim modulo case/whitespace/quote-dash glyphs/trailing punctuation; `jd_phrase` must be inside its own quote; stored quote is always the exact JD text).
  - Golden: `npm run test:golden` (real API calls, opt-in). With gpt-4o-mini: 7/7 JDs valid, 12–19 grounded keywords each, ≤1 dropped quote per JD.
  - Open: recall gap. gpt-4o-mini skips technologies given as examples ("e.g., PyTorch, TensorFlow"), even when told not to, and output varies run to run. Options: stronger model, and/or a deterministic pass that adds known tech terms found in the JD. Recall assertions need hand-labeled expected keywords (1.27).
- [x] 0.4 `lib/analysis/merge.ts`: synonym map + canonicalization across JDs. Unit tests.
  - Curated map in `lib/analysis/synonyms.ts` (true synonyms only; no ambiguous short aliases). Input type `ExtractedKeyword` in `lib/analysis/types.ts` is the contract for 0.3's output schema. User synonym overrides supported via `mergeSkills(jobs, { synonyms })`; no UI for them yet.
- [x] 0.5 `lib/analysis/score.ts`: per-JD score and set-wide demand (SPEC §AI design 2). Unit tests.
  - Weights in `lib/analysis/config.ts`. Per JD, importance counts once at its highest level (required beats preferred). Frequency = whole-phrase matches of the skill's seen wordings, floored at the extracted mention count. `in_title` needs a job title (Library docs have none yet, so it is 0 until 1.8). User overrides (reorder/dismiss) belong to the gaps PATCH in 1.15, not here.
- [x] 0.6 `lib/analysis/coverage.ts`: exact + synonym coverage against resume text (embeddings come later). Unit tests.
  - covered = name, curated alias, or a JD wording found as a whole phrase; weak = all content words of a multi-word skill on one resume line (rough stemming); else missing. Returns up to 3 evidence lines. Shared matching in `lib/analysis/text.ts`: ambiguous names (Go, Rust, R, C, Spark…) only match when capitalized; "C" never matches inside "C++"/"C#". Smoke-tested on resume1: 23 covered / 2 weak / 21 missing across the synonym list, no false negatives found.
- [x] 0.7 Throwaway page: pick a resume + several JDs from the Library → table of skills with demand, "asked by n of N", coverage.
  - `/analysis`. The `analyze` Server Action extracts only JDs not yet cached (`keyword_extractions` table, keyed by document + prompt version + provider:model, cascade-deleted with the document), then redirects to a GET URL that only reads the cache. Pipeline in `lib/analysis/analyze-set.ts` (merge → score → coverage); the extraction's job title feeds `in_title`.
  - Findings on 7 JDs × resume1 (gpt-4o-mini): 76 skills, 18 covered / 1 weak / 57 missing; the top of the ranking looks right (Python 7/7, ML 4/7, model deployment 3/7). Problems: near-duplicates not merged ("Communication" / "Communication skills", "Collaboration" / "team collaboration", four "agentic …" variants); one JD literally writes "Machine Learning flow" (meaning MLflow?), so a resume saying MLflow isn't matched; long tail of 1-of-N soft skills. Likely fixes: synonym map additions and maybe hiding 1-of-N soft skills.
  - resume2 check: no false matches from the traps; plurals/abbreviations match ("LLMs", "A/B tests", "ML"). Misses: single-word skills don't stem ("Communicated" ≠ Communication; weak matching only applies to multi-word skills), and MLflow + model registry doesn't count toward MLOps. The model also sometimes returns a whole list as `jd_phrase` ("PyTorch, TensorFlow, scikit-learn") instead of one item.
  - Cleanup after 0.7: synonyms for Communication, Collaboration, the "agentic …" variants (→ AI agents), and "Machine learning flow" (→ MLflow); one-word non-tool skills now go weak on another word form (stem prefix ≥ 6 chars, e.g. "Communicated"); list-shaped `jd_phrase` narrowed to the one skill (`narrowListPhrase`, also applied in `analyzeSet` for older cached extractions). Result on 7 JDs: 76 → 71 skills; resume1 18/3/50, resume2 10/2/59 (covered/weak/missing), no false matches found. Still open: MLflow doesn't count toward MLOps (needs embeddings, 1.10); long tail of 1-of-N soft skills not hidden. Embedding merge (1.10) should help with the rest.
- [x] 0.8 Local Library page (`/library`): upload (.txt/.md/.docx/.pdf, multi-file) or paste JDs and resumes → extracted text saved in SQLite, originals in `data/uploads`; duplicate detection; delete.

## Phase 1 — MVP (6 weeks)

### Foundation
- [x] 1.1 SQLite + Drizzle; rest of the schema from SPEC §Data model.
  - `db/schema.ts`, migration `0002_core_schema`. Adapted for single user: `profile` row `local` instead of User and `user_id` columns (use `LOCAL_PROFILE_ID` as the vector `user_id`). Original and generated bullets share `bullets` so `proof_bullet_id` is a real row; per-JD scores in `job_skill_scores`, mentions in `job_keywords`; evidence↔skills via `evidence_skills`. SPEC §Data model updated to match. Delete rules tested in `db/schema.test.ts`. No data-access layer yet; each feature task adds its own.
- [x] ~~1.2 Auth.js~~ Dropped: local single-user app. Server binds to 127.0.0.1 instead.
- [x] ~~1.3 S3 storage~~ Replaced by local disk under `data/` (0.8).
- [x] ~~1.4 Inngest~~ Dropped: long-running work runs in-process.

### Resume import (F1)
- [x] 1.5 Resume from the Library → `Resume` row. (File upload and PDF/DOCX text extraction already done in 0.8.)
  - `importResume(documentId)` in `lib/resume` (deps injectable via `importResumeDocument`): parses, then saves resume + roles + original bullets in one transaction (`createResumeStore`). First resume becomes the master. Re-importing creates a new resume; `findByDocument` lets 1.7 offer the existing one instead.
- [x] 1.6 LLM cleanup pass → structured roles/bullets/skills/education (Zod schema).
  - Prompt `lib/ai/prompts/parse-resume.ts` (v1.0.0), copy-only. `groundParsedResume` checks every value verbatim against the resume text (shared matcher `createVerbatimMatcher` in `lib/analysis/evidence.ts`), stores the resume's own wording, and reports misses as `issues` (kept, not dropped) for 1.7 to show. Logs counts only.
  - Golden (`tests/golden/parse-resume.golden.test.ts`, gpt-4o-mini): resume1 3 roles / 9 bullets, resume2 3 / 10, 0 of 42 and 0 of 34 values missing from the resume; dates split correctly, "Present" kept, two titles at one employer kept as two roles.
- [x] 1.7 Screen 1: upload + confirm/fix parsed roles.
  - `/resume` (import a library resume) and `/resume/[id]` (review). Each role is an editable card: fields plus bullets as one-per-line text; add a missed role, delete a role, then "Roles look right" sets `resumes.confirmed_at` (migration 0003). Values not found verbatim in the source file are highlighted amber (`findUnsupportedValues`, recomputed on each load; nothing stored). Bullet edits keep ids stable (`replaceOriginalBullets`) so later proof-bullet links survive; only original bullets are edited here. Summary, skills, and education are read-only for now.
  - Checked in the browser with resume1: import 11 s, 3 roles / 9 bullets, nothing flagged; adding a made-up bullet flags it and updates the count.
  - Open: edits after confirming don't re-require confirmation; no reordering of roles or moving a bullet between roles (delete + retype instead).

### JDs and analysis (F2, F5–F8)
- [x] 1.8 Target set + add JDs endpoints; boilerplate stripping.
  - `lib/target-sets` store: create for a resume, add library JDs (all-or-nothing; skips ones already in the set; max 20, min 2 checked at analyze time), remove a JD, rename, list with job counts, delete. Server Actions come with the screen in 1.11 rather than as unused endpoints.
  - `lib/parsing/boilerplate.ts`: deterministic stripping into `jobs.jd_clean`. Drops sections under EEO / benefits / pay / "About <Company>" headings (until the next content heading) and unheaded lines with strong phrases (equal opportunity employer, base salary range, 401(k), "raised $25 million"…). Output is only original lines, so quotes grounded in it are verbatim in the document. Fail-safe keeps the original if < 50 words would remain, or < 40% would remain with no content heading left (real postings can be mostly boilerplate). On the 7 fixtures it removes exactly jd5's funding blurb and jd6's salary paragraph; on two real LinkedIn imports it cut 622 → 122 and 686 → 415 words, keeping every role/requirements section.
  - For 1.9: extract and score on `jd_clean`. The extraction cache is keyed by document, so key it by the cleaned text (e.g. a hash) as well, or cached extractions of the full text get reused.
- [x] 1.9 `POST /api/target-sets/:id/analyze` job: extract → merge → score → coverage → write `JobKeyword` and `SkillDemand`.
  - `lib/target-sets/analyze.ts` extracts each job's `jd_clean` (full text if null) and runs `analyzeSet` against the resume as text (`lib/resume/text.ts`: accepted bullets only, drafts skipped) plus the user's skill synonyms. It writes everything in one transaction: fills job title/company/seniority/years only where empty; adds new skills (existing ones keep name and category); replaces `job_keywords` and `job_skill_scores`; upserts `skill_demands` on (set, skill) so `user_rank`, `dismissed`, and `proof_bullet_id` survive re-analysis. Demands for skills that dropped out are deleted, which also deletes their gap answers. `proof_bullet_id` stays null until 1.12.
  - Extraction cache key is now (document, sha256 of the extracted text, prompt version, model) (migration 0005; existing rows backfilled from `documents.content_hash`, so earlier full-text extractions still hit).
  - `lib/target-sets/analysis-runner.ts` runs it in-process (one run per set, 409 while busy), keeps extraction progress in memory, and stores `status` / `analysis_error` / `analyzed_at` on the set. A set left `analyzing` by a restart reports as failed. Logs counts and latency only. Adding or removing JDs sets an analyzed set back to `draft`.
  - Route: POST → 202 + `Location`; GET the same path for status/progress. 403 for cross-site requests (`lib/http/same-origin.ts`, since route handlers lack Server Actions' origin check); 404 unknown set; 422 fewer than 2 JDs.
  - Checked with `next start` on a copy of the real DB: 2 JDs (cached extractions) → 28 skills, 6 covered / 1 weak / 21 missing, 30 keywords; cross-site POST 403, unknown id 404.
  - Open: adding/removing JDs isn't blocked while a run is in progress (the run finishes with the old list; the set then shows `ready` for a stale list).
- [x] 1.10 Embeddings for JobKeyword and Evidence into Chroma via `vectorStoreForUser()` (store + scoping already in `lib/vector`); weak coverage via cosine ≥ 0.80; delete vectors when rows are deleted.
  - Calibration (text-embedding-3-small, 7 fixture JDs + 9 total × 2 resumes): real and false near-matches both score 0.50–0.62, whether comparing skill names or requirement lines, whole resume or bullets only. The only pair ≥ 0.80 was a false one (JD tool list vs resume tool list, "dbt"). Kept 0.80 (`WEAK_COVERAGE_SIMILARITY` in `lib/analysis/config.ts`) with the safer comparison below, so it flags nothing on the fixtures rather than showing wrong bullets as proof. Revisit with labeled pairs in 1.27.
  - `semanticWeakMatches` (`lib/analysis/coverage.ts`, deterministic): after the lexical pass, a missing non-tool skill is weak if any of its requirement lines (evidence_quote) has cosine ≥ threshold with an accepted experience bullet; evidence = those bullets, best first. `embedTexts` in `lib/ai/client.ts` does one batch per analysis (requirement lines + bullets) and logs model / count / latency only.
  - JobKeyword vectors: one per `job_keywords` row (id = row id, text = requirement line, metadata target_set_id / job_id / document_id / resume_id / skill_id / importance + user_id). Upserted with the precomputed vectors inside the analysis transaction, so a Chroma failure rolls the save back ("Start Chroma (npm run chroma)"); after commit, vectors without a live row are pruned. Analysis now needs Chroma running.
  - Deletes: removing a JD from a set, deleting a set, deleting a library JD, or deleting a resume removes its vectors by metadata filter. Best-effort (logged, never blocks the delete); the next analysis prunes anything missed.
  - Evidence: `evidenceRecord` / `evidenceText` (`lib/vector/evidence.ts`) and `evidenceVectors()` are ready; nothing writes evidence rows yet, so indexing and delete wiring land with 1.20.
  - Checked live (scratch DB + scratch Chroma): 2- and 9-JD sets analyzed (34 and 101 texts embedded, < 1 s each); Chroma ids == job_keywords ids after re-analysis (148/148); a job-scoped delete removed exactly its 14 vectors.
  - Fix (found in use): a failed Chroma connection was cached for the life of the server, so starting Chroma after the app kept every analysis failing with "Couldn't save to the vector store". The collection is now reopened on the next call.
  - Open: `/analysis` prototype page still uses lexical coverage only.
- [x] 1.11 Screen 2: build a target set by picking JDs from the Library, analyze with progress.
  - `/target-sets`: sets with resume, JD count, and status (not analyzed / analyzing / analyzed / out of date / failed), plus a create form (name + resume; unchecked resumes are marked). `/target-sets/[id]`: rename, JD list (extracted company · title · seniority, word count, words of boilerplate left out), remove, a checklist of library JDs not in the set (room left shown), Analyze panel, results, delete (with confirm). New JDs are added in the Library, as the page says; paste/file/URL stay there rather than being duplicated on this screen.
  - Analyze panel POSTs to the 1.9 route, then polls it every second: "Reading job descriptions: n of N", then "Comparing requirements with your resume…" and "Saving results…" on a progress bar; refreshes the page when done; shows the stored error on failure. `ensure()` now reports cached extractions right away, so progress counts them from the start (it used to count only new ones).
  - Results (until Screens 3/4 exist): covered / partly shown / not on resume counts and skills by rank with "asked by n of N", must-do badge, and coverage (top 15, then "Show all"). After the JDs change, the results stay with an "out of date" note and without "of N".
  - Server Actions (`app/target-sets/actions.ts`, Zod-validated): create, add JDs, remove JD, rename, delete. Adding, removing, and deleting are refused while the set is analyzing (`ensureNotAnalyzing`), and the page hides those controls then, closing the 1.9 open item.
  - Checked in the browser (scratch DB + scratch Chroma): created a set, added 4 JDs (2 LinkedIn imports trimmed 622 → 122 and 686 → 415 words), analyzed with live progress (2 model calls, 2 cached), 37 skills; removing a JD marked the results out of date. No console errors.
  - Open: deleting a library JD isn't blocked while a set that uses it is analyzing (that run then fails; analyze again). No way yet to edit a JD's extracted company/title.

### Strengths (F9)
- [x] 1.12 Proof-bullet selection and bullet strength scoring.
  - `lib/analysis/strength.ts`: strength = verb (strong 1 / neutral ½ / weak 0) + scope + measurable result (1.5) + in-demand keywords (1.5 × min(1, Σ share of JDs asking for each skill the bullet names)); max 5, weights in `config.ts`. Verb: curated strong-verb stems ("Led", "Engineered", "Migrated"…) vs weak openers ("Responsible for", "Helped", "Worked on"…); anything else is neutral. Scope: a count tied to users / events / projects / people / TB… ("2B events/day", "6+ projects", "10-person team", "three junior engineers"). Result: %, Nx, $, "from X to Y", "X → Y", "reduced … by N". On the 19 fixture bullets every flag matched a read-through.
  - `lib/analysis/proof.ts`: a covered skill's proof bullet is the strongest accepted bullet that names it (name, alias, or JD phrasing); ties go to the earlier bullet. A skill named only in the skills list or summary gets none, which is itself useful: on the 9-JD fixture set the top two skills (Python, asked by 7 of 9; Machine learning) are in the skills list but no bullet, the case 1.13's rewording suggestions are for.
  - Analysis writes `skill_demands.proof_bullet_id` and `terms` (the skill's wordings; migration 0006) on every run. `store.strengths(id)` returns the covered skills with proof bullets plus the 5 strongest bullets, scored against the resume as it is now with the stored wordings.
  - Open: resume edits after an analysis don't mark the set out of date (proof bullet ids survive edits because bullet ids are stable, but coverage doesn't update).
- [x] 1.13 Rewording suggestions (optional, never auto-applied).
  - Candidates (`lib/analysis/reword.ts`, deterministic): bullets that already show a skill in other words: a weak skill whose evidence is a bullet, or a covered skill whose proof bullet names it only by an alias no JD uses ("k8s" vs "Kubernetes"). Skills in the skills list only are skipped (adding them to a bullet would be a new claim; that's the interview's job). Phrase = the set's most-used JD phrasing of ≤ 3 words, else the skill name (longer phrasings carry extra claims: "building and deploying ML models"). One suggestion per bullet, ≤ 10 per request, none for a phrase already used 3 times.
  - One model call (`reword_bullets` 1.1.0) for all candidates; the model may decline an item. `checkRewording` drops any suggestion that lacks the phrase, adds a number, name, or intensifier ("successfully"), drops a name or content word other than the skill's own wording (with its compound: "LLM-driven"), or grows > 6 words beyond the phrase. Logs counts only.
  - Stored in `reword_suggestions` (migration 0007) as pending; `lib/target-sets/suggestions.ts`: generate (a bullet+skill already suggested, accepted, or dismissed isn't asked again unless the bullet changed), list (pending, bullet unchanged), accept (writes the bullet only if it still reads as it did; marks the resume's analyzed sets out of date), dismiss. `suggestRewordings(id)` wires in the model; the button and accept/ignore come with Screen 3 (1.14).
  - Live on the fixture sets (gpt-4o-mini, 4 runs): the guard caught every rewording that swapped out "MLOps" or dropped "Queried"/"generating insights"; kept ones are factually faithful, e.g. "an LLM-driven document classification … application" → "an application for document classification and extraction driven by large language models". Soft-skill phrases ("analytical skills") keep the facts but often read awkwardly ("insights that supported analytical skills"); they're for the user to accept or ignore.
  - Open: the guard can't judge grammar or a subtly stronger claim made of ordinary words; that's why nothing is applied without approval.
- [x] 1.14 Screen 3: strengths report.
  - `/target-sets/[id]/strengths` (linked from the set's results): "In-demand skills your bullets prove" (each covered skill with its proof bullet, role, and strength tags), "Named, but not shown in a bullet" (skills only in the skills list or summary, with a short excerpt around the matched wording highlighted), "Your strongest bullets" (top 5 with score and tags: strong verb / weak opening, scope, measurable result, in-demand skills), and "Rewording suggestions".
  - Suggestions: "Suggest rewordings" (one model call; says when there's nothing to reword or every rewording failed the check), then each suggestion as Now / Suggested with the JD phrase highlighted, "Use this wording" or "Ignore". Accepting refuses a bullet edited since, and marks the resume's analyzed sets out of date; the page then shows an "Analyze again" note. Server Actions validate with Zod; requesting suggestions is refused while the set is analyzing; failures log the error name only.
  - Checked in the browser on the 9-JD fixture set: 6 proven skills, 12 named only (Python, asked by 7 of 9, among them), strongest bullets as in 1.12; one suggestion (LLM-driven → "utilizing large language models"), accepted: bullet rewritten, all three sets using that resume marked out of date.
  - Open: "Continue" to the gap overview waits for 1.15 (the page links back to the set). Proof bullets aren't user-selectable yet.

### Gap interview (F10–F14)
- [x] 1.15 Screen 4: gap overview with reorder/dismiss (`PATCH /gaps`).
  - `/target-sets/[id]/gaps` (from the strengths page's "Next: your gaps" and the set's results): missing and weak skills in interview order, each with "asked by n of N · required by m", must-do and "partly shown" badges, the closest resume line for weak ones (short excerpt), and "Why this skill?" (up to 3 JD sentences, one per JD, required first). First 15 shown, the rest behind "Show the other N". Dismissed gaps listed separately with Restore.
  - Reorder with Top / ↑ / ↓ (keyboard-accessible forms with labels like "Move A/B testing up"; no drag). A move saves the whole active order as `skill_demands.user_rank`, which re-analysis keeps; a skill added by a later analysis slots in by its demand rank, after a gap the user put at the same position (`gapOrder`, `lib/target-sets/gaps.ts`).
  - Server Actions (`moveGap`, `setGapDismissed`, Zod-validated) instead of a `PATCH /gaps` route, as with the other screens' mutations.
  - The strengths page's summary excerpt helper moved to `components/target-sets/excerpt.tsx`, shared by both screens.
  - Checked in the browser on the 9-JD fixture set (67 gaps): moved A/B testing to the top (order saved 1..n), dismissed Adaptability (66 left, shown under Dismissed), opened "Why this skill?".
  - Open: "Start the interview" is disabled until 1.16. 67 gaps from 9 JDs is a lot; most are asked by 1 JD, so the interview should let the user stop early.
- [ ] 1.16 Interview state machine: next gap → Yes/Somewhat/No → follow-ups → draft → accept. Persist after every answer.
- [ ] 1.17 Follow-up question prompt per skill category; skip already-answered facts.
- [ ] 1.18 Bullet writing prompt: 2 variants + `keywords_hit[]` + `claims[]`.
- [ ] 1.19 Claim-check pass → `unverified_claims[]`; export blocked while any exist.
- [ ] 1.20 Accept writes bullet under the role and skill into Skills section; save Evidence to library (F19).
- [ ] 1.21 Screen 5: split view (question left, live resume right), SSE streaming, keyboard shortcuts, progress bar.

### Learning plan (F15)
- [ ] 1.22 Learning plan prompt for No/Somewhat → `LearningItem` (no invented course names/URLs).
- [ ] 1.23 Screen 6: learning plan grouped by demand, status toggles.

### Scoring and export (F17, F18)
- [ ] 1.24 Coverage score before/after.
- [ ] 1.25 ATS-safe DOCX export (`docx`) and PDF (Playwright), single column, standard headings.
- [ ] 1.26 Screen 7: review with changes highlighted, inline edit (TipTap), download.

### Quality
- [ ] 1.27 Golden tests on fixtures: extraction recall, JSON validity, zero unsupported claims.
- [ ] 1.28 Playwright e2e: upload resume → 3 JDs → answer one Yes and one No → export.
- [ ] 1.29 Logging of prompt version, tokens, latency, guardrail flags (no resume/JD text).

## Phase 2 — Reuse (3 weeks)

- [x] 2.1 JD import by URL (F3), best-effort with paste fallback.
  - Done early, on request. "Or import from a link" on `/library` (JDs only). `lib/parsing/job-url`: LinkedIn links (`/jobs/view/<id>`, slugs, `?currentJobId=`) read the public job page's JSON-LD, then LinkedIn's public guest fragment if the page is walled; other sites need schema.org `JobPosting` JSON-LD. Anything else, or < 50 words, fails with "paste it instead"; page text is never guessed.
  - `safeFetch`: http(s) only, all resolved addresses must be public (loopback/private/link-local/CGNAT/ULA blocked), redirects re-checked per hop (max 5), 10 s timeout, 2 MB cap, HTML only. Known gap: DNS is resolved again by fetch after the check (rebinding window); acceptable for a single-user local app.
  - Checked with two real LinkedIn links: both came through the guest fragment (the public page had no JSON-LD). LinkedIn's markup leaves literal "__PRESENT" markers, now stripped.
  - `documents.source_url` (migration 0004): duplicate check by URL; copied to `jobs.source_url` when a JD joins a set. Title defaults to "Company – Title". Failures log the error code only.
- [ ] 2.2 Duplicate JD detection via embeddings (F4).
- [ ] 2.3 Suggest experience-library entries before asking fresh questions.
- [ ] 2.4 Learning item "done" → mini-interview to add it to the resume; export plan as checklist (F16).
- [ ] 2.5 Per-job variant from one JD (F20).

## Phase 3 — Extras (4 weeks)

- [ ] 3.1 Cover letter drafts from evidence (F21).
- [ ] 3.2 Interview talking points per skill.
- [ ] 3.3 Additional templates; mobile polish.
