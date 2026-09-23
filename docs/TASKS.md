# Build Plan

Work top to bottom. Each task should end with passing `npm run typecheck && npm run lint && npm test`. Check a task off when it's done and note anything left open underneath it.

## Phase 0 — Prototype (1 week)

Goal: prove the analysis is useful before building UI.

- [x] 0.1 Scaffold Next.js + TypeScript + Tailwind + Vitest; add `lib/ai/client.ts` wrapper around `@anthropic-ai/sdk` with Zod-validated JSON output and one retry on invalid output.
  - Model defaults to `claude-opus-5` (override with `ANTHROPIC_MODEL`); server-side refusal fallback enabled (`fallbacks: "default"`). Model calls go through LangChain (`ChatAnthropic` / `ChatOpenAI`); OpenAI via `AI_PROVIDER=openai` + `OPENAI_MODEL` (Responses API, `store: false`). Chroma vector store + OpenAI embeddings scaffolded in `lib/vector` (not yet wired to data; see 1.10). Guardrail flags from callers (e.g. dropped evidence quotes) not yet wired into the log — see 1.29.
- [ ] 0.2 Add 10+ real JDs to `tests/fixtures/jds/` and 2 resumes to `tests/fixtures/resumes/`.
  - So far: 7 JDs (`jd1`–`jd7`), 1 resume. JDs and resumes are git-ignored, so fixture-based tests run locally only (they skip when files are absent).
- [ ] 0.3 Keyword extraction prompt + schema (SPEC §AI design 1). Drop items whose `evidence_quote` isn't verbatim in the JD. Golden test: JSON valid for all fixtures.
- [x] 0.4 `lib/analysis/merge.ts`: synonym map + canonicalization across JDs. Unit tests.
  - Curated map in `lib/analysis/synonyms.ts` (true synonyms only; no ambiguous short aliases). Input type `ExtractedKeyword` in `lib/analysis/types.ts` is the contract for 0.3's output schema. User synonym overrides supported via `mergeSkills(jobs, { synonyms })`; no UI for them yet.
- [x] 0.5 `lib/analysis/score.ts`: per-JD score and set-wide demand (SPEC §AI design 2). Unit tests.
  - Weights in `lib/analysis/config.ts`. Per JD, importance counts once at its highest level (required beats preferred). Frequency = whole-phrase matches of the skill's seen wordings, floored at the extracted mention count. `in_title` needs a job title (Library docs have none yet, so it is 0 until 1.8). User overrides (reorder/dismiss) belong to the gaps PATCH in 1.15, not here.
- [x] 0.6 `lib/analysis/coverage.ts`: exact + synonym coverage against resume text (embeddings come later). Unit tests.
  - covered = name, curated alias, or a JD wording found as a whole phrase; weak = all content words of a multi-word skill on one resume line (rough stemming); else missing. Returns up to 3 evidence lines. Shared matching in `lib/analysis/text.ts`: ambiguous names (Go, Rust, R, C, Spark…) only match when capitalized; "C" never matches inside "C++"/"C#". Smoke-tested on resume1: 23 covered / 2 weak / 21 missing across the synonym list, no false negatives found.
- [ ] 0.7 Throwaway page: pick a resume + several JDs from the Library → table of skills with demand, "asked by n of N", coverage.
- [x] 0.8 Local Library page (`/library`): upload (.txt/.md/.docx/.pdf, multi-file) or paste JDs and resumes → extracted text saved in SQLite, originals in `data/uploads`; duplicate detection; delete.

## Phase 1 — MVP (6 weeks)

### Foundation
- [ ] 1.1 SQLite + Drizzle; rest of the schema from SPEC §Data model.
  - Started: `documents` table + auto-migration (`db/client.ts`), done in 0.8.
- [x] ~~1.2 Auth.js~~ Dropped: local single-user app. Server binds to 127.0.0.1 instead.
- [x] ~~1.3 S3 storage~~ Replaced by local disk under `data/` (0.8).
- [x] ~~1.4 Inngest~~ Dropped: long-running work runs in-process.

### Resume import (F1)
- [ ] 1.5 Resume from the Library → `Resume` row. (File upload and PDF/DOCX text extraction already done in 0.8.)
- [ ] 1.6 LLM cleanup pass → structured roles/bullets/skills/education (Zod schema).
- [ ] 1.7 Screen 1: upload + confirm/fix parsed roles.

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
