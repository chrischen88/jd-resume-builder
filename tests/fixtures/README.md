# Test fixtures

Real inputs for golden tests (TASKS 0.2, 0.3, 1.27). Both folders are git-ignored:
files stay on your machine, and tests that read them skip when they are absent. Don't invent or edit
content beyond redacting personal details — the tests measure extraction on
real-world text.

## `jds/` — job descriptions (10+)

- One JD per file, plain text: `<company>-<role>.txt`, e.g. `acme-senior-data-analyst.txt`.
- Paste the full posting, including boilerplate (EEO, benefits, company blurb);
  boilerplate stripping is part of what gets tested.
- Aim for a mix of roles and seniorities, plus a few JDs for the same target role
  so demand ranking has overlap to work with.

## `resumes/` — resumes (2)

- Original file (`.pdf` or `.docx`) and/or a plain-text copy (`.txt`) with the same name.
- Files here stay on your machine, so they don't need redacting.
