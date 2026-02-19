CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season` integer,
	`date` integer,
	`home_team_id` integer,
	`away_team_id` integer,
	`neutral_site` integer,
	`status` text,
	`home_score` integer,
	`away_score` integer,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `games_season_idx` ON `games` (`season`);--> statement-breakpoint
CREATE INDEX `games_date_idx` ON `games` (`date`);--> statement-breakpoint
CREATE INDEX `games_home_team_idx` ON `games` (`home_team_id`);--> statement-breakpoint
CREATE INDEX `games_away_team_idx` ON `games` (`away_team_id`);--> statement-breakpoint
CREATE TABLE `team_game_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer,
	`team_id` integer,
	`opp_team_id` integer,
	`points` integer,
	`fga` integer,
	`fgm` integer,
	`tpa` integer,
	`tpm` integer,
	`fta` integer,
	`ftm` integer,
	`oreb` integer,
	`dreb` integer,
	`ast` integer,
	`tov` integer,
	`stl` integer,
	`blk` integer,
	`pf` integer,
	`possessions_est` real,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opp_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `team_game_stats_game_idx` ON `team_game_stats` (`game_id`);--> statement-breakpoint
CREATE INDEX `team_game_stats_team_idx` ON `team_game_stats` (`team_id`);--> statement-breakpoint
CREATE INDEX `team_game_stats_opp_team_idx` ON `team_game_stats` (`opp_team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_game_stats_game_team_unique` ON `team_game_stats` (`game_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`conference` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_slug_unique` ON `teams` (`slug`);--> statement-breakpoint
CREATE INDEX `teams_conference_idx` ON `teams` (`conference`);