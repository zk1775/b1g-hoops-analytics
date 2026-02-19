ALTER TABLE `games` ADD `external_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `venue` text;--> statement-breakpoint
ALTER TABLE `games` ADD `created_at` integer DEFAULT (unixepoch()) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `games_external_id_unique` ON `games` (`external_id`);--> statement-breakpoint
ALTER TABLE `team_game_stats` ADD `is_home` integer;--> statement-breakpoint
ALTER TABLE `team_game_stats` ADD `fg3m` integer;--> statement-breakpoint
ALTER TABLE `team_game_stats` ADD `fg3a` integer;--> statement-breakpoint
ALTER TABLE `team_game_stats` ADD `reb` integer;--> statement-breakpoint
ALTER TABLE `team_game_stats` ADD `created_at` integer DEFAULT (unixepoch()) NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `short_name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `logo_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `teams_name_unique` ON `teams` (`name`);