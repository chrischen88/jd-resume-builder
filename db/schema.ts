import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { JobExtraction } from "@/lib/ai/extract-keywords";
import { SENIORITY_LEVELS } from "@/lib/ai/prompts/extract-keywords";
import { IMPORTANCE_LEVELS, SKILL_CATEGORIES } from "@/lib/analysis/types";

// SQLite schema (SPEC §Data model), adapted for a local single-user app:
// - No user_id columns. The one user is the `profile` row LOCAL_PROFILE_ID,
//   which is also the user_id for vectorStoreForUser().
// - Original resume bullets and generated ones share the `bullets` table, so
//   a skill's proof bullet is a real row.
// - Deletes cascade down ownership (resume → target sets → jobs, demands,
//   answers). Evidence and learning items belong to the user, not a target
//   set, so they survive a target set's deletion.

const id = () => text("id").primaryKey();
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());
const stringList = (name: string) =>
  text(name, { mode: "json" })
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => []);

export const LOCAL_PROFILE_ID = "local";

export const DOCUMENT_KINDS = ["jd", "resume"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Every uploaded or pasted JD and resume, kept as extracted text. */
export const documents = sqliteTable(
  "documents",
  {
    id: id(),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    title: text("title").notNull(),
    /** Original filename; null when the text was pasted. */
    filename: text("filename"),
    /** Original file, relative to the data dir; null when pasted. */
    storedPath: text("stored_path"),
    /** Web page it was imported from (SPEC F3); null for files and pastes. */
    sourceUrl: text("source_url"),
    text: text("text").notNull(),
    /** sha256 of the normalized text, for duplicate detection. */
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("documents_kind_hash_idx").on(table.kind, table.contentHash)],
);

export type DocumentRow = typeof documents.$inferSelect;

/**
 * Cached keyword extraction per JD, so re-analyzing a JD doesn't repeat the
 * model call. Keyed by the extracted text's hash, prompt version, and model:
 * changing any of them re-extracts. The same document can have one row for
 * its full text and one for its boilerplate-stripped text (jobs.jd_clean).
 */
export const keywordExtractions = sqliteTable(
  "keyword_extractions",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** sha256 of the text the extraction ran on (same hash as documents.content_hash). */
    textHash: text("text_hash").notNull().default(""),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    result: text("result", { mode: "json" })
      .$type<Pick<JobExtraction, "job" | "keywords" | "dropped">>()
      .notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("keyword_extractions_doc_text_version_idx").on(
      table.documentId,
      table.textHash,
      table.promptVersion,
      table.model,
    ),
  ],
);

export type KeywordExtractionRow = typeof keywordExtractions.$inferSelect;

// ---------------------------------------------------------------------------
// User

export interface Preferences {
  /** Target resume length in pages. */
  pageLength: 1 | 2 | null;
  tone: "concise" | "detailed" | null;
}

/** The single local user (SPEC "User"). One row, id LOCAL_PROFILE_ID. */
export const profile = sqliteTable("profile", {
  id: id().$defaultFn(() => LOCAL_PROFILE_ID),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  links: stringList("links"),
  preferences: text("preferences", { mode: "json" })
    .$type<Preferences>()
    .notNull()
    .$defaultFn(() => ({ pageLength: null, tone: null })),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Resume

export interface EducationEntry {
  institution: string;
  degree: string | null;
  field: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  details: string[];
}

/** Resume content outside roles and bullets; the parser (task 1.6) fills it. */
export interface ResumeSections {
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    links: string[];
  };
  summary: string | null;
  /** Skills section lines as written, e.g. "Languages: Python, SQL". */
  skills: string[];
  education: EducationEntry[];
  certifications: string[];
  /** Any other section, by heading. */
  other: { heading: string; lines: string[] }[];
}

export const resumes = sqliteTable("resumes", {
  id: id(),
  /** Library document it was parsed from. Null if that document was deleted. */
  documentId: text("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  sections: text("sections", { mode: "json" }).$type<ResumeSections>().notNull(),
  isMaster: integer("is_master", { mode: "boolean" }).notNull().default(false),
  /** When the user checked the parsed roles (task 1.7); null = not yet. */
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const roles = sqliteTable(
  "roles",
  {
    id: id(),
    resumeId: text("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    /** Order on the resume, 0 = top. */
    position: integer("position").notNull(),
    employer: text("employer").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    /** Dates as written ("Mar 2022", "2019", "Present"); null if not stated. */
    startDate: text("start_date"),
    endDate: text("end_date"),
  },
  (table) => [index("roles_resume_idx").on(table.resumeId, table.position)],
);

// ---------------------------------------------------------------------------
// Skills

/** Canonical skills shared across target sets (SPEC "Skill"). */
export const skills = sqliteTable("skills", {
  id: id(),
  /** skillKey(canonicalName); what merges match on. */
  key: text("key").notNull().unique(),
  canonicalName: text("canonical_name").notNull(),
  category: text("category", { enum: SKILL_CATEGORIES }).notNull(),
  /** User-added synonyms; override the curated map (mergeSkills `synonyms`). */
  synonyms: stringList("synonyms"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Evidence and bullets

/** A reusable account of something the user did (SPEC "Evidence", F19). */
export const evidence = sqliteTable("evidence", {
  id: id(),
  roleId: text("role_id").references(() => roles.id, { onDelete: "set null" }),
  situation: text("situation"),
  action: text("action").notNull(),
  tools: stringList("tools"),
  scale: text("scale"),
  result: text("result"),
  metric: text("metric"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const evidenceSkills = sqliteTable(
  "evidence_skills",
  {
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.evidenceId, table.skillId] })],
);

export const BULLET_SOURCES = ["original", "generated"] as const;
export const BULLET_STATUSES = ["draft", "accepted"] as const;

/** Bullets under a role: parsed from the resume or written in the interview. */
export const bullets = sqliteTable(
  "bullets",
  {
    id: id(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    source: text("source", { enum: BULLET_SOURCES }).notNull(),
    status: text("status", { enum: BULLET_STATUSES }).notNull(),
    evidenceId: text("evidence_id").references(() => evidence.id, {
      onDelete: "set null",
    }),
    keywordsHit: stringList("keywords_hit"),
    claims: stringList("claims"),
    /** Non-empty blocks export until the user confirms or removes them. */
    unverifiedClaims: stringList("unverified_claims"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("bullets_role_idx").on(table.roleId, table.position)],
);

// ---------------------------------------------------------------------------
// Target sets and analysis

export const TARGET_SET_STATUSES = ["draft", "analyzing", "ready", "failed"] as const;

export const targetSets = sqliteTable("target_sets", {
  id: id(),
  name: text("name").notNull(),
  resumeId: text("resume_id")
    .notNull()
    .references(() => resumes.id, { onDelete: "cascade" }),
  status: text("status", { enum: TARGET_SET_STATUSES }).notNull().default("draft"),
  /** Why the last analysis failed (status "failed"); user-facing, no JD text. */
  analysisError: text("analysis_error"),
  /** When the last analysis finished successfully. */
  analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    targetSetId: text("target_set_id")
      .notNull()
      .references(() => targetSets.id, { onDelete: "cascade" }),
    /** The JD in the library. Deleting it there removes it from the set. */
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    company: text("company"),
    title: text("title"),
    seniority: text("seniority", { enum: SENIORITY_LEVELS }),
    yearsExperienceMin: real("years_experience_min"),
    sourceUrl: text("source_url"),
    /** JD text with boilerplate stripped (task 1.8); null = use the document text. */
    jdClean: text("jd_clean"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("jobs_set_document_idx").on(table.targetSetId, table.documentId)],
);

/** One extracted mention of a skill in a JD (SPEC "JobKeyword"). */
export const jobKeywords = sqliteTable(
  "job_keywords",
  {
    id: id(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    jdPhrase: text("jd_phrase").notNull(),
    evidenceQuote: text("evidence_quote").notNull(),
    importance: text("importance", { enum: IMPORTANCE_LEVELS }).notNull(),
  },
  (table) => [index("job_keywords_job_idx").on(table.jobId, table.skillId)],
);

/**
 * Per-JD score of a skill (score_j in SPEC §AI design 2). Split from
 * job_keywords because a JD can mention a skill several times but scores it
 * once.
 */
export const jobSkillScores = sqliteTable(
  "job_skill_scores",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    importance: text("importance", { enum: IMPORTANCE_LEVELS }).notNull(),
    frequency: integer("frequency").notNull(),
    inTitle: integer("in_title", { mode: "boolean" }).notNull(),
    inFirstThird: integer("in_first_third", { mode: "boolean" }).notNull(),
    score: real("score").notNull(),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.skillId] })],
);

export const COVERAGE_LEVELS = ["covered", "weak", "missing"] as const;

export const skillDemands = sqliteTable(
  "skill_demands",
  {
    id: id(),
    targetSetId: text("target_set_id")
      .notNull()
      .references(() => targetSets.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    jdCount: integer("jd_count").notNull(),
    requiredCount: integer("required_count").notNull(),
    demandScore: real("demand_score").notNull(),
    mustDo: integer("must_do", { mode: "boolean" }).notNull(),
    /** 1-based, by demand. */
    rank: integer("rank").notNull(),
    coverage: text("coverage", { enum: COVERAGE_LEVELS }).notNull(),
    /** Skill wording that matched the resume, if any. */
    matchedTerm: text("matched_term"),
    /** Resume lines supporting the match (max 3). */
    coverageEvidence: stringList("coverage_evidence"),
    /**
     * Wordings that count as naming the skill (name, aliases, JD phrasings),
     * for matching bullets without re-running the merge.
     */
    terms: text("terms", { mode: "json" }).$type<string[]>().notNull().default([]),
    proofBulletId: text("proof_bullet_id").references(() => bullets.id, {
      onDelete: "set null",
    }),
    /** User overrides (PATCH /gaps) win over rank. */
    userRank: integer("user_rank"),
    dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [uniqueIndex("skill_demands_set_skill_idx").on(table.targetSetId, table.skillId)],
);

export const SUGGESTION_STATUSES = ["pending", "accepted", "dismissed"] as const;

/**
 * A suggested rewording of a bullet that shows a skill in other words, using
 * the JDs' phrase (SPEC §AI design 4). Never applied until the user accepts
 * it; `original_text` detects bullets edited since.
 */
export const rewordSuggestions = sqliteTable(
  "reword_suggestions",
  {
    id: id(),
    targetSetId: text("target_set_id")
      .notNull()
      .references(() => targetSets.id, { onDelete: "cascade" }),
    bulletId: text("bullet_id")
      .notNull()
      .references(() => bullets.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    originalText: text("original_text").notNull(),
    suggestedText: text("suggested_text").notNull(),
    jdPhrase: text("jd_phrase").notNull(),
    status: text("status", { enum: SUGGESTION_STATUSES }).notNull().default("pending"),
    promptVersion: text("prompt_version").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("reword_suggestions_set_bullet_skill_idx").on(
      table.targetSetId,
      table.bulletId,
      table.skillId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Interview and learning plan

export const GAP_RESPONSES = ["yes", "somewhat", "no"] as const;

export interface FollowUp {
  question: string;
  /** Null while waiting for the user; "" if they skipped the question. */
  answer: string | null;
}

/** One drafted bullet (SPEC §AI design 6–7). */
export interface DraftVariant {
  text: string;
  keywordsHit: string[];
  claims: string[];
  /** Claims the check couldn't tie to the user's answers or resume. */
  unverifiedClaims: string[];
}

/** Structured evidence taken from the user's answers (SPEC "Evidence"). */
export interface EvidenceFields {
  situation: string | null;
  action: string;
  tools: string[];
  scale: string | null;
  result: string | null;
  metric: string | null;
}

export interface GapDraft {
  variants: DraftVariant[];
  evidence: EvidenceFields;
  promptVersion: string;
}

/** The interview answer for one gap; saved after every answer (F11). */
export const gapAnswers = sqliteTable("gap_answers", {
  id: id(),
  skillDemandId: text("skill_demand_id")
    .notNull()
    .unique()
    .references(() => skillDemands.id, { onDelete: "cascade" }),
  response: text("response", { enum: GAP_RESPONSES }).notNull(),
  followUps: text("follow_ups", { mode: "json" })
    .$type<FollowUp[]>()
    .notNull()
    .$defaultFn(() => []),
  evidenceId: text("evidence_id").references(() => evidence.id, {
    onDelete: "set null",
  }),
  /** The role the experience was in (Yes/Somewhat). */
  roleId: text("role_id").references(() => roles.id, { onDelete: "set null" }),
  /** Bullet drafts awaiting accept / edit / regenerate. */
  draft: text("draft", { mode: "json" }).$type<GapDraft>(),
  /** Set when the gap is finished: answered No, bullet accepted, or certification added. */
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const LEARNING_STATUSES = ["to_learn", "learning", "done"] as const;

export interface LearningResource {
  /** Generic kind ("course", "certification", "portfolio project"); never an invented title or URL. */
  kind: string;
  description: string;
}

/** A skill to learn, from a No or Somewhat answer. One per skill. */
export const learningItems = sqliteTable("learning_items", {
  id: id(),
  skillId: text("skill_id")
    .notNull()
    .unique()
    .references(() => skills.id),
  /** Target set it came from; kept if that set is deleted. */
  targetSetId: text("target_set_id").references(() => targetSets.id, {
    onDelete: "set null",
  }),
  keywords: stringList("keywords"),
  relatedSkills: stringList("related_skills"),
  jdCount: integer("jd_count").notNull(),
  resources: text("resources", { mode: "json" })
    .$type<LearningResource[]>()
    .notNull()
    .$defaultFn(() => []),
  status: text("status", { enum: LEARNING_STATUSES }).notNull().default("to_learn"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Output

/** A tailored resume for a target set, or for one job in it (F20). */
export const resumeVersions = sqliteTable("resume_versions", {
  id: id(),
  targetSetId: text("target_set_id")
    .notNull()
    .references(() => targetSets.id, { onDelete: "cascade" }),
  /** Null = set-wide version. */
  jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  summary: text("summary"),
  skills: stringList("skills"),
  bulletIds: stringList("bullet_ids"),
  scoreBefore: real("score_before"),
  scoreAfter: real("score_after"),
  /** Exported files, relative to the data dir. */
  docxPath: text("docx_path"),
  pdfPath: text("pdf_path"),
  createdAt: createdAt(),
});

export type ResumeRow = typeof resumes.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type SkillRow = typeof skills.$inferSelect;
export type EvidenceRow = typeof evidence.$inferSelect;
export type BulletRow = typeof bullets.$inferSelect;
export type TargetSetRow = typeof targetSets.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobKeywordRow = typeof jobKeywords.$inferSelect;
export type JobSkillScoreRow = typeof jobSkillScores.$inferSelect;
export type SkillDemandRow = typeof skillDemands.$inferSelect;
export type RewordSuggestionRow = typeof rewordSuggestions.$inferSelect;
export type GapAnswerRow = typeof gapAnswers.$inferSelect;
export type LearningItemRow = typeof learningItems.$inferSelect;
export type ResumeVersionRow = typeof resumeVersions.$inferSelect;
