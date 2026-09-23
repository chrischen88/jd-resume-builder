# Resume Tailor

Local, single-user web app (runs on the user's machine; only AI API calls leave it): the user uploads one resume and several job descriptions (JDs). The app shows what the resume already does well, interviews the user about skills the JDs want that the resume lacks, updates the resume for each "Yes", and adds each "No" to a learning plan.

Full spec: `docs/SPEC.md`. Build plan: `docs/TASKS.md`. Read both before starting a task, and check off tasks in `docs/TASKS.md` as you finish them.

## Stack

- Next.js (App Router) + React + TypeScript (strict)
- Tailwind CSS; TipTap for inline resume editing
- SQLite (file at `data/app.db`) via Drizzle ORM + `@libsql/client`; migrations in `db/migrations`, applied automatically on first DB access
- Vectors: Chroma (`chromadb` client) behind a LangChain `VectorStore` in `lib/vector`; embeddings via LangChain `OpenAIEmbeddings`
- LLM: LangChain chat models, `ChatAnthropic` (default) or `ChatOpenAI` (Responses API), chosen by `AI_PROVIDER`; structured JSON output validated with Zod
- Long-running work (analysis, export) runs in-process in the Next.js server; no job queue
- File storage: local disk under `data/` (git-ignored; override with `DATA_DIR`)
- Chroma runs locally from npm: `npm run chroma` (persists to `data/chroma`), no Docker
- Parsing: `pdf-parse`, `mammoth`; export: `docx` (npm) and Playwright for PDF
- Tests: Vitest (unit), Playwright (e2e)

## Project layout

```
app/                 # Next.js routes and pages; mutations via Server Actions (`actions.ts`)
components/          # UI components
data/                # Local app data (git-ignored): app.db, uploads/, chroma/
lib/
  ai/                # Prompt templates, model calls, output schemas
    prompts/         # One file per prompt, exported with a version string
  analysis/          # Deterministic scoring, synonym merge, coverage matching
  parsing/           # Resume and JD parsing (file → text in extract-text.ts)
  library/           # Uploaded JDs and resumes (SQLite + data/uploads)
  vector/            # Chroma vector store
  export/            # DOCX / PDF rendering
db/
  schema.ts          # Drizzle schema (see docs/SPEC.md#data-model)
  migrations/
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
npm run chroma       # local Chroma server on :8000 (needed once vectors are used)
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
- All vector reads/writes go through `vectorStoreForUser()` in `lib/vector`, which pins every query to a `user_id` (the single local user for now). Chroma ids reuse the SQLite row ids.
- Prompt schemas must work with both providers: use `.nullable()` instead of `.optional()` (OpenAI strict mode requires every field).
- Every prompt has a Zod output schema. Invalid JSON → one retry with the validation error, then fail loudly.
- Extraction items must include an `evidence_quote` that appears verbatim in the JD; drop items that don't.
- Scoring and ranking are deterministic TypeScript in `lib/analysis`, never the model.
- Log prompt version, tokens, latency, and guardrail flags. Never log resume or JD text.
- Learning-plan resources are generic descriptions or from a curated list. Never output invented course names or URLs.

### Code

- Server-only code (AI, DB, storage) never imported into client components.
- Validate every Server Action and route input with Zod.
- No auth (single local user), so the server binds to 127.0.0.1 only (`dev`/`start` scripts). Never make it listen on other interfaces.
- Save interview state after every answer so sessions can resume.
- Prefer small, focused modules with unit tests, especially in `lib/analysis`.
- ATS-safe export: single column, standard headings (Summary, Experience, Skills, Education), real text, common fonts, no tables or images.
