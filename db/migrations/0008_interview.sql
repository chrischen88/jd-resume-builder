ALTER TABLE `gap_answers` ADD `role_id` text REFERENCES roles(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `gap_answers` ADD `draft` text;--> statement-breakpoint
ALTER TABLE `gap_answers` ADD `completed_at` integer;