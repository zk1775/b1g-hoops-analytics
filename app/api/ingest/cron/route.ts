import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { B1G_SLUGS } from "@/lib/data/b1gTeams";
import { runIngest } from "@/lib/data/ingest";
import { runReconcile } from "@/lib/data/reconcile";
import { fetchGameBoxscore, fetchScoreboard } from "@/lib/data/sources/espn";
import { isFinalStatus } from "@/lib/data/status";
import {
  upsertGame,
  upsertPlayerGameStats,
  upsertTeamGameStats,
  upsertTeamsFromSchedule,
  type UpsertCounts,
} from "@/lib/data/upsertGames";
import { requireRuntimeEnv, resolveAdminToken } from "@/lib/runtime/env";

export const runtime = "edge";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseBoolean(value: string | null, fallback = false) {
  if (!value) {
    return fallback;
  }
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseInteger(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseSources(value: string | null) {
  if (!value) {
    return undefined;
  }
  const parsed = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry === "espn" || entry === "sports-reference");
  return parsed.length ? (parsed as Array<"espn" | "sports-reference">) : undefined;
}

function extractToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return new URL(request.url).searchParams.get("token");
}

function getCurrentSeasonYear(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 7 ? year + 1 : year;
}

function toIsoDateInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function addDaysIso(isoDate: string, offsetDays: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  utc.setUTCDate(utc.getUTCDate() + offsetDays);
  return utc.toISOString().slice(0, 10);
}

function enumerateIsoDates(startIso: string, endIso: string) {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const start = Date.UTC(sy, (sm ?? 1) - 1, sd ?? 1);
  const end = Date.UTC(ey, (em ?? 1) - 1, ed ?? 1);
  const dates: string[] = [];
  for (let current = start; current <= end; current += MS_PER_DAY) {
    dates.push(new Date(current).toISOString().slice(0, 10));
  }
  return dates;
}

function toEspnDate(isoDate: string) {
  return isoDate.replaceAll("-", "");
}

function emptyCounts(): UpsertCounts {
  return {
    teamsInserted: 0,
    teamsUpdated: 0,
    gamesInserted: 0,
    gamesUpdated: 0,
    statsInserted: 0,
    statsUpdated: 0,
    playerStatsInserted: 0,
    playerStatsUpdated: 0,
  };
}

function addCounts(target: UpsertCounts, incoming: Partial<UpsertCounts>) {
  target.teamsInserted += incoming.teamsInserted ?? 0;
  target.teamsUpdated += incoming.teamsUpdated ?? 0;
  target.gamesInserted += incoming.gamesInserted ?? 0;
  target.gamesUpdated += incoming.gamesUpdated ?? 0;
  target.statsInserted += incoming.statsInserted ?? 0;
  target.statsUpdated += incoming.statsUpdated ?? 0;
  target.playerStatsInserted += incoming.playerStatsInserted ?? 0;
  target.playerStatsUpdated += incoming.playerStatsUpdated ?? 0;
}

type DailyCronSummary = {
  strategy: "scoreboard";
  season: number;
  includeBoxscore: boolean;
  start: string;
  end: string;
  datesProcessed: number;
  eventsFetched: number;
  b1gEventsSeen: number;
  gamesUpserted: number;
  statsUpserted: number;
  playerStatsUpserted: number;
  counts: UpsertCounts;
  errors: Array<{ date?: string; eventId?: string; message: string }>;
};

type CronDateWindow = {
  startIso: string;
  endIso: string;
  season: number;
  includeBoxscore: boolean;
  isoDates: string[];
};

function resolveCronDateWindow(request: NextRequest) {
  const url = new URL(request.url);
  const season = parseInteger(url.searchParams.get("season"), getCurrentSeasonYear());
  const includeBoxscore = parseBoolean(url.searchParams.get("includeBoxscore"), true);
  const tz = url.searchParams.get("tz") || "America/New_York";

  const explicitStart = url.searchParams.get("start");
  const explicitEnd = url.searchParams.get("end");
  // Default to a 2-day lookback so a missed run still catches the prior day.
  const daysBack = Math.min(Math.max(parseInteger(url.searchParams.get("daysBack"), 2), 0), 7);
  const daysForward = Math.min(Math.max(parseInteger(url.searchParams.get("daysForward"), 0), 0), 2);

  const todayTz = toIsoDateInTimeZone(new Date(), tz);
  const startIso = explicitStart ?? addDaysIso(todayTz, -daysBack);
  const endIso = explicitEnd ?? addDaysIso(todayTz, daysForward);
  const isoDates = enumerateIsoDates(startIso, endIso);

  return { startIso, endIso, season, includeBoxscore, isoDates } satisfies CronDateWindow;
}

async function runBoundedTeamScheduleCronIngest(
  request: NextRequest,
  env: ReturnType<typeof requireRuntimeEnv>,
) {
  const window = resolveCronDateWindow(request);
  const summary = await runIngest(env, {
    mode: "all",
    season: window.season,
    since: window.startIso,
    until: window.endIso,
    includeBoxscore: window.includeBoxscore,
  });

  return {
    strategy: "bounded" as const,
    start: window.startIso,
    end: window.endIso,
    datesProcessed: window.isoDates.length,
    ...summary,
  };
}

async function runScoreboardCronIngest(
  request: NextRequest,
  env: ReturnType<typeof requireRuntimeEnv>,
) {
  const db = getDb(env);
  const { season, includeBoxscore, startIso, endIso, isoDates } = resolveCronDateWindow(request);

  const counts = emptyCounts();
  const processedEventIds = new Set<string>();
  const errors: DailyCronSummary["errors"] = [];
  let eventsFetched = 0;
  let b1gEventsSeen = 0;
  let gamesUpserted = 0;
  let statsUpserted = 0;
  let playerStatsUpserted = 0;

  for (const isoDate of isoDates) {
    try {
      const scoreboardGames = await fetchScoreboard({ date: toEspnDate(isoDate) });
      eventsFetched += scoreboardGames.length;

      const b1gGames = scoreboardGames.filter(
        (game) => B1G_SLUGS.has(game.homeTeam.slug) || B1G_SLUGS.has(game.awayTeam.slug),
      );
      b1gEventsSeen += b1gGames.length;

      if (b1gGames.length === 0) {
        continue;
      }

      const upsertTeams = await upsertTeamsFromSchedule(db, b1gGames);
      addCounts(counts, upsertTeams.counts);

      for (const game of b1gGames) {
        if (processedEventIds.has(game.externalId)) {
          continue;
        }
        processedEventIds.add(game.externalId);

        const gameUpsert = await upsertGame(db, game, upsertTeams.teamIdBySlug);
        gamesUpserted += 1;
        addCounts(counts, {
          gamesInserted: gameUpsert.inserted ? 1 : 0,
          gamesUpdated: gameUpsert.updated ? 1 : 0,
        });

        if (!includeBoxscore || !isFinalStatus(game.status)) {
          continue;
        }

        try {
          const boxscore = await fetchGameBoxscore({ eventId: game.externalId });
          if (!boxscore) {
            continue;
          }

          const teamStats = await upsertTeamGameStats(db, {
            gameId: gameUpsert.gameId,
            teamIdBySlug: upsertTeams.teamIdBySlug,
            boxscore,
          });
          statsUpserted += teamStats.inserted + teamStats.updated;
          addCounts(counts, {
            statsInserted: teamStats.inserted,
            statsUpdated: teamStats.updated,
          });

          const playerStats = await upsertPlayerGameStats(db, {
            gameId: gameUpsert.gameId,
            teamIdBySlug: upsertTeams.teamIdBySlug,
            boxscore,
          });
          playerStatsUpserted += playerStats.inserted + playerStats.updated;
          addCounts(counts, {
            playerStatsInserted: playerStats.inserted,
            playerStatsUpdated: playerStats.updated,
          });
        } catch (error) {
          errors.push({
            date: isoDate,
            eventId: game.externalId,
            message: error instanceof Error ? error.message : "boxscore ingest failed",
          });
        }
      }
    } catch (error) {
      errors.push({
        date: isoDate,
        message: error instanceof Error ? error.message : "scoreboard ingest failed",
      });
    }
  }

  const summary: DailyCronSummary = {
    strategy: "scoreboard",
    season,
    includeBoxscore,
    start: startIso,
    end: endIso,
    datesProcessed: isoDates.length,
    eventsFetched,
    b1gEventsSeen,
    gamesUpserted,
    statsUpserted,
    playerStatsUpserted,
    counts,
    errors,
  };

  return summary;
}

export async function GET(request: NextRequest) {
  let env: ReturnType<typeof requireRuntimeEnv>;
  try {
    env = requireRuntimeEnv();
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Missing b1g_analytics_db binding",
      },
      { status: 500 },
    );
  }

  const adminToken = resolveAdminToken(env);
  if (!adminToken || extractToken(request) !== adminToken) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const strategy = params.get("strategy") ?? "bounded";

  try {
    if (strategy === "full") {
      const season = params.get("season");
      const parsedSeason = season ? Number(season) : undefined;
      const summary = await runIngest(env, {
        mode: "all",
        season: Number.isInteger(parsedSeason) ? parsedSeason : undefined,
        includeBoxscore: parseBoolean(params.get("includeBoxscore")),
        since: params.get("since") ?? undefined,
        until: params.get("until") ?? undefined,
      });
      return NextResponse.json({ status: "ok", source: "cron", strategy: "full", ...summary });
    }

    if (strategy === "scoreboard") {
      const summary = await runScoreboardCronIngest(request, env);
      return NextResponse.json({ status: "ok", source: "cron", ...summary });
    }

    if (strategy === "reconcile") {
      const summary = await runReconcile(env, {
        season: parseInteger(params.get("season"), getCurrentSeasonYear()),
        team: params.get("team")?.trim().toLowerCase() || undefined,
        since: params.get("since") ?? undefined,
        until: params.get("until") ?? undefined,
        limit: parseInteger(params.get("limit"), 200),
        includePlayerStats: parseBoolean(params.get("includePlayerStats"), true),
        sources: parseSources(params.get("sources")),
      });
      return NextResponse.json({ status: "ok", source: "cron", strategy: "reconcile", ...summary });
    }

    const summary = await runBoundedTeamScheduleCronIngest(request, env);
    return NextResponse.json({ status: "ok", source: "cron", ...summary });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "cron ingest failed",
      },
      { status: 400 },
    );
  }
}
