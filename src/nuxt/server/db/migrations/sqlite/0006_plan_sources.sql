ALTER TABLE `imported_plans` ADD `kind` text DEFAULT 'imported' NOT NULL;--> statement-breakpoint
ALTER TABLE `imported_plans` ADD `ynab_plan_id` text;--> statement-breakpoint
ALTER TABLE `imported_plans` ADD `currency_code` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `imported_plans` ADD `last_synced_at` text;
