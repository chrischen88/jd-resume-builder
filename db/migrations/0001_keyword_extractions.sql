CREATE TABLE `keyword_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`prompt_version` text NOT NULL,
	`model` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_extractions_doc_version_idx` ON `keyword_extractions` (`document_id`,`prompt_version`,`model`);