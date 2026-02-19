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
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    conference: text("conference"),
    logoUrl: text("logo_url"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("teams_slug_unique").on(table.slug),
    uniqueIndex("teams_name_unique").on(table.name),
    index("teams_conference_idx").on(table.conference),
  ],
);

export const games = sqliteTable(
  "games",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    externalId: text("external_id").notNull(),
    season: integer("season"),
    date: integer("date"),
    status: text("status"),
    neutralSite: integer("neutral_site", { mode: "boolean" }),
    homeTeamId: integer("home_team_id").references(() => teams.id),
    awayTeamId: integer("away_team_id").references(() => teams.id),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    venue: text("venue"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("games_external_id_unique").on(table.externalId),
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
    isHome: integer("is_home", { mode: "boolean" }),
    points: integer("points"),
    fgm: integer("fgm"),
    fga: integer("fga"),
    fg3m: integer("fg3m"),
    fg3a: integer("fg3a"),
    tpm: integer("tpm"),
    tpa: integer("tpa"),
    ftm: integer("ftm"),
    fta: integer("fta"),
    oreb: integer("oreb"),
    dreb: integer("dreb"),
    reb: integer("reb"),
    ast: integer("ast"),
    stl: integer("stl"),
    blk: integer("blk"),
    tov: integer("tov"),
    pf: integer("pf"),
    possessionsEst: real("possessions_est"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("team_game_stats_game_idx").on(table.gameId),
    index("team_game_stats_team_idx").on(table.teamId),
    index("team_game_stats_opp_team_idx").on(table.oppTeamId),
    uniqueIndex("team_game_stats_game_team_unique").on(table.gameId, table.teamId),
  ],
);
