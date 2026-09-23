# Resume Tailor

Web app: the user uploads one resume and several job descriptions (JDs). The app shows what the resume already does well, interviews the user about skills the JDs want that the resume lacks, updates the resume for each "Yes", and adds each "No" to a learning plan.

Full spec: `docs/SPEC.md`. Build plan: `docs/TASKS.md`. Read both before starting a task, and check off tasks in `docs/TASKS.md` as you finish them.

## Stack

- Next.js (App Router) + React + TypeScript (strict)
- Tailwind CSS; TipTap for inline resume editing
- Postgres, accessed via Drizzle ORM (migrations in `db/migrations`)
- Vectors: Chroma (`chromadb` client) behind a LangChain `VectorStore` in `lib/vector`; embeddings via LangChain `OpenAIEmbeddings`
- Auth.js (email + Google)
- LLM: LangChain chat models, `ChatAnthropic` (default) or `ChatOpenAI` (Responses API), chosen by `AI_PROVIDER`; structured JSON output validated with Zod
- Background jobs: Inngest (resume parsing, analysis, export)
- File storage: S3-compatible bucket, signed URLs only
- Parsing: `pdf-parse`, `mammoth`; export: `docx` (npm) and Playwright for PDF
- Tests: Vitest (unit), Playwright (e2e)

## Project layout

```
app/                 # Next.js routes and pages
  api/               # Route handlers (REST, see docs/SPEC.md#api)
components/          # UI components
lib/
  ai/                # Prompt templates, model calls, output schemas
    prompts/         # One file per prompt, exported with a version string
  analysis/          # Deterministic scoring, synonym merge, coverage matching
  parsing/           # Resume and JD parsing
  export/            # DOCX / PDF rendering
db/
  schema.ts          # Drizzle schema (see docs/SPEC.md#data-model)
  migrations/
jobs/                # Inngest functions
tests/
  fixtures/jds/      # Real sample JDs for golden tests
  fixtures/resumes/
```

## Commands

```
npm run dev          # local dev server
npm run build
npm run lint
npm run typecheck
npm test             # vitest
npm run test:e2e     # playwright
npm run db:generate  # drizzle migration from schema changes
npm run db:migrate
```

Run `npm run typecheck && npm run lint && npm test` before calling a task done.

## Rules

### Truthfulness (non-negotiable)

- Never write a skill, tool, number, employer, title, date, degree, or certification into the resume unless it came from the user's uploaded resume or their interview answers.
- Every generated bullet returns `claims[]`. A check pass compares claims against the user's answers; unsupported claims get `unverified_claims[]` and block export until the user confirms or removes them.
- "No" answers never touch the resume. They create a `LearningItem`.
- "Somewhat" answers use honest verbs ("contributed to", "supported", "gained exposure to") and also create a `LearningItem`.
- Cap each JD phrase at 3 uses across the resume. No hidden text.

### AI calls

- All model calls go through `lib/ai/client.ts`. Never import LangChain or a vendor SDK from route handlers or components; model construction lives in `lib/ai/models.ts`.
- All vector reads/writes go through `vectorStoreForUser()` in `lib/vector`, which pins every query to the user's `user_id`. Chroma ids reuse the Postgres row ids.
- Prompt schemas must work with both providers: use `.nullable()` instead of `.optional()` (OpenAI strict mode requires every field).
- Every prompt has a Zod output schema. Invalid JSON → one retry with the validation error, then fail loudly.
- Extraction items must include an `evidence_quote` that appears verbatim in the JD; drop items that don't.
- Scoring and ranking are deterministic TypeScript in `lib/analysis`, never the model.
- Log prompt version, tokens, latency, and guardrail flags. Never log resume or JD text.
- Learning-plan resources are generic descriptions or from a curated list. Never output invented course names or URLs.

### Code

- Server-only code (AI, DB, storage) never imported into client components.
- Validate every API input with Zod. Every query is scoped to the signed-in user (row-level checks).
- Save interview state after every answer so sessions can resume.
- Prefer small, focused modules with unit tests, especially in `lib/analysis`.
- ATS-safe export: single column, standard headings (Summary, Experience, Skills, Education), real text, common fonts, no tables or images.
