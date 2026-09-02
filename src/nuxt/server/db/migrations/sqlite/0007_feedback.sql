CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`page` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
