DROP INDEX `keyword_extractions_doc_version_idx`;--> statement-breakpoint
ALTER TABLE `keyword_extractions` ADD `text_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Existing rows were extracted from the full document text, whose hash is documents.content_hash.
UPDATE `keyword_extractions` SET `text_hash` = (SELECT `content_hash` FROM `documents` WHERE `documents`.`id` = `keyword_extractions`.`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_extractions_doc_text_version_idx` ON `keyword_extractions` (`document_id`,`text_hash`,`prompt_version`,`model`);--> statement-breakpoint
ALTER TABLE `target_sets` ADD `analysis_error` text;--> statement-breakpoint
ALTER TABLE `target_sets` ADD `analyzed_at` integer;