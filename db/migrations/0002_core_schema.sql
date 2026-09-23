CREATE TABLE `bullets` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`evidence_id` text,
	`keywords_hit` text NOT NULL,
	`claims` text NOT NULL,
	`unverified_claims` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bullets_role_idx` ON `bullets` (`role_id`,`position`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text,
	`situation` text,
	`action` text NOT NULL,
	`tools` text NOT NULL,
	`scale` text,
	`result` text,
	`metric` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `evidence_skills` (
	`evidence_id` text NOT NULL,
	`skill_id` text NOT NULL,
	PRIMARY KEY(`evidence_id`, `skill_id`),
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gap_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_demand_id` text NOT NULL,
	`response` text NOT NULL,
	`follow_ups` text NOT NULL,
	`evidence_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`skill_demand_id`) REFERENCES `skill_demands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gap_answers_skill_demand_id_unique` ON `gap_answers` (`skill_demand_id`);--> statement-breakpoint
CREATE TABLE `job_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`jd_phrase` text NOT NULL,
	`evidence_quote` text NOT NULL,
	`importance` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_keywords_job_idx` ON `job_keywords` (`job_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `job_skill_scores` (
	`job_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`importance` text NOT NULL,
	`frequency` integer NOT NULL,
	`in_title` integer NOT NULL,
	`in_first_third` integer NOT NULL,
	`score` real NOT NULL,
	PRIMARY KEY(`job_id`, `skill_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`target_set_id` text NOT NULL,
	`document_id` text NOT NULL,
	`company` text,
	`title` text,
	`seniority` text,
	`years_experience_min` real,
	`source_url` text,
	`jd_clean` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_set_id`) REFERENCES `target_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_set_document_idx` ON `jobs` (`target_set_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `learning_items` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`target_set_id` text,
	`keywords` text NOT NULL,
	`related_skills` text NOT NULL,
	`jd_count` integer NOT NULL,
	`resources` text NOT NULL,
	`status` text DEFAULT 'to_learn' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_set_id`) REFERENCES `target_sets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_items_skill_id_unique` ON `learning_items` (`skill_id`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`phone` text,
	`location` text,
	`links` text NOT NULL,
	`preferences` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resume_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`target_set_id` text NOT NULL,
	`job_id` text,
	`summary` text,
	`skills` text NOT NULL,
	`bullet_ids` text NOT NULL,
	`score_before` real,
	`score_after` real,
	`docx_path` text,
	`pdf_path` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_set_id`) REFERENCES `target_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resumes` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text,
	`title` text NOT NULL,
	`sections` text NOT NULL,
	`is_master` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`resume_id` text NOT NULL,
	`position` integer NOT NULL,
	`employer` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`start_date` text,
	`end_date` text,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `roles_resume_idx` ON `roles` (`resume_id`,`position`);--> statement-breakpoint
CREATE TABLE `skill_demands` (
	`id` text PRIMARY KEY NOT NULL,
	`target_set_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`jd_count` integer NOT NULL,
	`required_count` integer NOT NULL,
	`demand_score` real NOT NULL,
	`must_do` integer NOT NULL,
	`rank` integer NOT NULL,
	`coverage` text NOT NULL,
	`matched_term` text,
	`coverage_evidence` text NOT NULL,
	`proof_bullet_id` text,
	`user_rank` integer,
	`dismissed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`target_set_id`) REFERENCES `target_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proof_bullet_id`) REFERENCES `bullets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_demands_set_skill_idx` ON `skill_demands` (`target_set_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`canonical_name` text NOT NULL,
	`category` text NOT NULL,
	`synonyms` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_key_unique` ON `skills` (`key`);--> statement-breakpoint
CREATE TABLE `target_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`resume_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE cascade
);
