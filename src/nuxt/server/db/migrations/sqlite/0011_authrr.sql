ALTER TABLE `users` ADD `authrr_sub` text;--> statement-breakpoint
ALTER TABLE `users` ADD `authrr_checked_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `role` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_authrr_sub_unique` ON `users` (`authrr_sub`);
