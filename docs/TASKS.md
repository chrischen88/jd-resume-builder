# Build Plan

Work top to bottom. Each task should end with passing `npm run typecheck && npm run lint && npm test`. Check a task off when it's done and note anything left open underneath it.

## Phase 0 — Prototype (1 week)

Goal: prove the analysis is useful before building UI.

- [x] 0.1 Scaffold Next.js + TypeScript + Tailwind + Vitest; add `lib/ai/client.ts` wrapper around `@anthropic-ai/sdk` with Zod-validated JSON output and one retry on invalid output.
  - Model defaults to `claude-opus-5` (override with `ANTHROPIC_MODEL`); server-side refusal fallback enabled (`fallbacks: "default"`). Model calls go through LangChain (`ChatAnthropic` / `ChatOpenAI`); OpenAI via `AI_PROVIDER=openai` + `OPENAI_MODEL` (Responses API, `store: false`). Chroma vector store + OpenAI embeddings scaffolded in `lib/vector` (not yet wired to data; see 1.10). Guardrail flags from callers (e.g. dropped evidence quotes) not yet wired into the log — see 1.29.
- [ ] 0.2 Add 10+ real JDs to `tests/fixtures/jds/` and 2 resumes to `tests/fixtures/resumes/`.
- [ ] 0.3 Keyword extraction prompt + schema (SPEC §AI design 1). Drop items whose `evidence_quote` isn't verbatim in the JD. Golden test: JSON valid for all fixtures.
- [ ] 0.4 `lib/analysis/merge.ts`: synonym map + canonicalization across JDs. Unit tests.
- [ ] 0.5 `lib/analysis/score.ts`: per-JD score and set-wide demand (SPEC §AI design 2). Unit tests.
- [ ] 0.6 `lib/analysis/coverage.ts`: exact + synonym coverage against resume text (embeddings come later). Unit tests.
- [ ] 0.7 Throwaway page: paste resume text + several JDs → table of skills with demand, "asked by n of N", coverage.

## Phase 1 — MVP (6 weeks)

### Foundation
- [ ] 1.1 Postgres + Drizzle; full schema from SPEC §Data model; first migration.
- [ ] 1.2 Auth.js (email + Google); every query scoped to the user.
- [ ] 1.3 S3-compatible storage with signed upload/download URLs.
- [ ] 1.4 Inngest set up for background jobs.

### Resume import (F1)
- [ ] 1.5 Upload endpoint `POST /api/resumes`; parse PDF (`pdf-parse`) and DOCX (`mammoth`) in a job.
- [ ] 1.6 LLM cleanup pass → structured roles/bullets/skills/education (Zod schema).
- [ ] 1.7 Screen 1: upload + confirm/fix parsed roles.

### JDs and analysis (F2, F5–F8)
- [ ] 1.8 Target set + add JDs endpoints; boilerplate stripping.
- [ ] 1.9 `POST /api/target-sets/:id/analyze` job: extract → merge → score → coverage → write `JobKeyword` and `SkillDemand`.
- [ ] 1.10 Embeddings for JobKeyword and Evidence into Chroma via `vectorStoreForUser()` (store + scoping already in `lib/vector`); weak coverage via cosine ≥ 0.80; delete vectors when rows are deleted.
- [ ] 1.11 Screen 2: add JDs (multi-paste, file drop), list, analyze with progress.

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
