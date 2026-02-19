import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const teams = sqliteTable(
  "teams",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    conference: text("conference"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("teams_slug_unique").on(table.slug),
    index("teams_conference_idx").on(table.conference),
  ],
);

export const games = sqliteTable(
  "games",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    season: integer("season"),
    date: integer("date"),
    homeTeamId: integer("home_team_id").references(() => teams.id),
    awayTeamId: integer("away_team_id").references(() => teams.id),
    neutralSite: integer("neutral_site", { mode: "boolean" }),
    status: text("status"),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
  },
  (table) => [
    index("games_season_idx").on(table.season),
    index("games_date_idx").on(table.date),
    index("games_home_team_idx").on(table.homeTeamId),
    index("games_away_team_idx").on(table.awayTeamId),
  ],
);

export const teamGameStats = sqliteTable(
  "team_game_stats",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: integer("game_id").references(() => games.id),
    teamId: integer("team_id").references(() => teams.id),
    oppTeamId: integer("opp_team_id").references(() => teams.id),
    points: integer("points"),
    fga: integer("fga"),
    fgm: integer("fgm"),
    tpa: integer("tpa"),
    tpm: integer("tpm"),
    fta: integer("fta"),
    ftm: integer("ftm"),
    oreb: integer("oreb"),
    dreb: integer("dreb"),
    ast: integer("ast"),
    tov: integer("tov"),
    stl: integer("stl"),
    blk: integer("blk"),
    pf: integer("pf"),
    possessionsEst: real("possessions_est"),
  },
  (table) => [
    index("team_game_stats_game_idx").on(table.gameId),
    index("team_game_stats_team_idx").on(table.teamId),
    index("team_game_stats_opp_team_idx").on(table.oppTeamId),
    uniqueIndex("team_game_stats_game_team_unique").on(table.gameId, table.teamId),
  ],
);
