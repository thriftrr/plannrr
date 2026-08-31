CREATE TABLE `debts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`source_key` text,
	`plan_name` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`start_date` text DEFAULT '' NOT NULL,
	`end_date` text,
	`start_balance` integer DEFAULT 0 NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`paid_in` integer DEFAULT 0 NOT NULL,
	`rate` real,
	`minimum_payment` integer,
	`history` text DEFAULT '[]' NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`updated_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
