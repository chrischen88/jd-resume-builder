CREATE TABLE `reword_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`target_set_id` text NOT NULL,
	`bullet_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`original_text` text NOT NULL,
	`suggested_text` text NOT NULL,
	`jd_phrase` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_set_id`) REFERENCES `target_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bullet_id`) REFERENCES `bullets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reword_suggestions_set_bullet_skill_idx` ON `reword_suggestions` (`target_set_id`,`bullet_id`,`skill_id`);