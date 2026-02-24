CREATE TABLE `players` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `espn_athlete_id` text NOT NULL,
  `team_id` integer,
  `name` text NOT NULL,
  `short_name` text,
  `jersey` text,
  `position` text,
  `headshot_url` text,
  `active` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `players_espn_athlete_id_unique` ON `players` (`espn_athlete_id`);--> statement-breakpoint
CREATE INDEX `players_team_idx` ON `players` (`team_id`);--> statement-breakpoint
CREATE INDEX `players_name_idx` ON `players` (`name`);--> statement-breakpoint

CREATE TABLE `player_game_stats` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `game_id` integer,
  `team_id` integer,
  `player_id` integer,
  `espn_athlete_id` text NOT NULL,
  `is_home` integer,
  `starter` integer,
  `did_not_play` integer,
  `minutes` text,
  `minutes_decimal` real,
  `points` integer,
  `fgm` integer,
  `fga` integer,
  `fg3m` integer,
  `fg3a` integer,
  `ftm` integer,
  `fta` integer,
  `reb` integer,
  `ast` integer,
  `tov` integer,
  `stl` integer,
  `blk` integer,
  `oreb` integer,
  `dreb` integer,
  `pf` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `player_game_stats_game_idx` ON `player_game_stats` (`game_id`);--> statement-breakpoint
CREATE INDEX `player_game_stats_team_idx` ON `player_game_stats` (`team_id`);--> statement-breakpoint
CREATE INDEX `player_game_stats_player_idx` ON `player_game_stats` (`player_id`);--> statement-breakpoint
CREATE INDEX `player_game_stats_espn_player_idx` ON `player_game_stats` (`espn_athlete_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_game_stats_game_athlete_unique` ON `player_game_stats` (`game_id`, `espn_athlete_id`);
