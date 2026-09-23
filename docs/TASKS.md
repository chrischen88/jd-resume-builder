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
- [ ] 1.8 Target set + add JDs endpoints; boilerplate stripping.
- [ ] 1.9 `POST /api/target-sets/:id/analyze` job: extract → merge → score → coverage → write `JobKeyword` and `SkillDemand`.
- [ ] 1.10 Embeddings for JobKeyword and Evidence into Chroma via `vectorStoreForUser()` (store + scoping already in `lib/vector`); weak coverage via cosine ≥ 0.80; delete vectors when rows are deleted.
- [ ] 1.11 Screen 2: build a target set by picking JDs from the Library, analyze with progress.

### Strengths (F9)
- [ ] 1.12 Proof-bullet selection and bullet strength scoring.
- [ ] 1.13 Rewording suggestions (optional, never auto-applied).
- [ ] 1.14 Screen 3: strengths report.

### Gap interview (F10–F14)
- [ ] 1.15 Screen 4: gap overview with reorder/dismiss (`PATCH /gaps`).
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

- [ ] 2.1 JD import by URL (F3), best-effort with paste fallback.
- [ ] 2.2 Duplicate JD detection via embeddings (F4).
- [ ] 2.3 Suggest experience-library entries before asking fresh questions.
- [ ] 2.4 Learning item "done" → mini-interview to add it to the resume; export plan as checklist (F16).
- [ ] 2.5 Per-job variant from one JD (F20).

## Phase 3 — Extras (4 weeks)

- [ ] 3.1 Cover letter drafts from evidence (F21).
- [ ] 3.2 Interview talking points per skill.
- [ ] 3.3 Additional templates; mobile polish.
