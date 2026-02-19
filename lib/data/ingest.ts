import {
  fetchBigTenEspnTeams,
  fetchGameBoxscore,
  fetchTeamSchedule,
} from "@/lib/data/sources/espn";
import { isFinalStatus } from "@/lib/data/status";
import {
  upsertGame,
  upsertTeamGameStats,
  upsertTeamsFromSchedule,
  type UpsertCounts,
} from "@/lib/data/upsertGames";
import { getDb, type DbEnv } from "@/db/client";

export type IngestMode = "team" | "all";

export type IngestRequest = {
  season?: number;
  team?: string;
  mode?: IngestMode;
  since?: string;
  until?: string;
  includeBoxscore?: boolean;
};

export type IngestError = {
  team?: string;
  eventId?: string;
  message: string;
};

export type IngestSummary = {
  mode: IngestMode;
  season: number;
  includeBoxscore: boolean;
  teamsProcessed: number;
  gamesUpserted: number;
  statsUpserted: number;
  counts: UpsertCounts;
  errors: IngestError[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function initCounts(): UpsertCounts {
  return {
    teamsInserted: 0,
    teamsUpdated: 0,
    gamesInserted: 0,
    gamesUpdated: 0,
    statsInserted: 0,
    statsUpdated: 0,
  };
}

function addCounts(target: UpsertCounts, incoming: Partial<UpsertCounts>) {
  target.teamsInserted += incoming.teamsInserted ?? 0;
  target.teamsUpdated += incoming.teamsUpdated ?? 0;
  target.gamesInserted += incoming.gamesInserted ?? 0;
  target.gamesUpdated += incoming.gamesUpdated ?? 0;
  target.statsInserted += incoming.statsInserted ?? 0;
  target.statsUpdated += incoming.statsUpdated ?? 0;
}

function parseIsoDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toEpochStart(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function toEpochEnd(date: Date) {
  return Math.floor((date.getTime() + MS_PER_DAY - 1) / 1000);
}

export function getCurrentSeasonYear(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 7 ? year + 1 : year;
}

export function normalizeIngestRequest(input: IngestRequest) {
  const season = input.season ?? getCurrentSeasonYear();
  const mode: IngestMode = input.mode ?? (input.team ? "team" : "all");
  const includeBoxscore = Boolean(input.includeBoxscore);
  const team = input.team?.trim().toLowerCase();

  const sinceDate = parseIsoDate(input.since);
  const untilDate = parseIsoDate(input.until);
  const sinceEpoch = sinceDate ? toEpochStart(sinceDate) : null;
  const untilEpoch = untilDate ? toEpochEnd(untilDate) : null;

  if (sinceEpoch && untilEpoch && sinceEpoch > untilEpoch) {
    throw new Error("since must be less than or equal to until");
  }

  if (mode === "team" && !team) {
    throw new Error("team is required when mode is 'team'");
  }

  return { season, mode, team, includeBoxscore, sinceEpoch, untilEpoch };
}

export async function runIngest(env: DbEnv, input: IngestRequest): Promise<IngestSummary> {
  const db = getDb(env);
  const request = normalizeIngestRequest(input);
  const counts = initCounts();
  const errors: IngestError[] = [];
  const processedGameIds = new Set<string>();
  let gamesUpserted = 0;
  let statsUpserted = 0;
  let teamsProcessed = 0;

  const conferenceTeams = await fetchBigTenEspnTeams();
  const selectedTeams =
    request.mode === "team"
      ? conferenceTeams.filter((team) => team.slug === request.team)
      : conferenceTeams;

  if (request.mode === "team" && selectedTeams.length === 0) {
    throw new Error(`No Big Ten ESPN team found for slug "${request.team}"`);
  }

  for (const espnTeam of selectedTeams) {
    teamsProcessed += 1;
    try {
      const schedule = await fetchTeamSchedule({
        espnTeamId: espnTeam.espnTeamId,
        season: request.season,
      });

      const filteredSchedule = schedule.filter((game) => {
        if (!game.date) {
          return request.sinceEpoch === null && request.untilEpoch === null;
        }
        if (request.sinceEpoch !== null && game.date < request.sinceEpoch) {
          return false;
        }
        if (request.untilEpoch !== null && game.date > request.untilEpoch) {
          return false;
        }
        return true;
      });

      const upsertTeams = await upsertTeamsFromSchedule(db, filteredSchedule);
      addCounts(counts, upsertTeams.counts);

      for (const game of filteredSchedule) {
        if (processedGameIds.has(game.externalId)) {
          continue;
        }
        processedGameIds.add(game.externalId);

        const gameUpsert = await upsertGame(db, game, upsertTeams.teamIdBySlug);
        addCounts(counts, {
          gamesInserted: gameUpsert.inserted ? 1 : 0,
          gamesUpdated: gameUpsert.updated ? 1 : 0,
        });
        gamesUpserted += 1;

        if (!request.includeBoxscore || !isFinalStatus(game.status)) {
          continue;
        }

        try {
          const boxscore = await fetchGameBoxscore({ eventId: game.externalId });
          if (!boxscore) {
            continue;
          }
          const stats = await upsertTeamGameStats(db, {
            gameId: gameUpsert.gameId,
            teamIdBySlug: upsertTeams.teamIdBySlug,
            boxscore,
          });
          statsUpserted += stats.inserted + stats.updated;
          addCounts(counts, { statsInserted: stats.inserted, statsUpdated: stats.updated });
        } catch (error) {
          errors.push({
            team: espnTeam.slug,
            eventId: game.externalId,
            message: error instanceof Error ? error.message : "boxscore ingest failed",
          });
        }
      }
    } catch (error) {
      errors.push({
        team: espnTeam.slug,
        message: error instanceof Error ? error.message : "team ingest failed",
      });
    }
  }

  return {
    mode: request.mode,
    season: request.season,
    includeBoxscore: request.includeBoxscore,
    teamsProcessed,
    gamesUpserted,
    statsUpserted,
    counts,
    errors,
  };
}
