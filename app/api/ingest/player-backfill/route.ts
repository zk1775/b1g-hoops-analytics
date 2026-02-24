import { and, desc, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { games, playerGameStats, teams } from "@/db/schema";
import { fetchGameBoxscore } from "@/lib/data/sources/espn";
import { isFinalStatus } from "@/lib/data/status";
import { upsertPlayerGameStats, upsertTeamGameStats } from "@/lib/data/upsertGames";
import { requireRuntimeEnv, resolveAdminToken } from "@/lib/runtime/env";

export const runtime = "edge";

type CandidateGame = {
  id: number;
  externalId: string;
  status: string | null;
  date: number | null;
  homeSlug: string;
  awaySlug: string;
};

function parseIntParam(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return new URL(request.url).searchParams.get("token");
}

function isAuthorized(request: NextRequest, expectedToken: string | null) {
  if (!expectedToken) {
    return false;
  }
  return parseToken(request) === expectedToken;
}

async function getTeamIdMap() {
  const env = requireRuntimeEnv();
  const db = getDb(env);
  const rows = await db.select({ id: teams.id, slug: teams.slug }).from(teams);
  return {
    env,
    db,
    teamIdBySlug: new Map(rows.map((row) => [row.slug, row.id] as const)),
  };
}

async function getCandidateGames(
  params: { season: number; teamSlug?: string; scanLimit: number },
) {
  const { db } = await getTeamIdMap();
  const homeTeam = alias(teams, "home_team");
  const awayTeam = alias(teams, "away_team");

  const rows = await db
    .select({
      id: games.id,
      externalId: games.externalId,
      status: games.status,
      date: games.date,
      homeSlug: homeTeam.slug,
      awaySlug: awayTeam.slug,
      homeConference: homeTeam.conference,
      awayConference: awayTeam.conference,
    })
    .from(games)
    .innerJoin(homeTeam, eq(games.homeTeamId, homeTeam.id))
    .innerJoin(awayTeam, eq(games.awayTeamId, awayTeam.id))
    .where(
      and(
        eq(games.season, params.season),
        or(eq(homeTeam.conference, "Big Ten"), eq(awayTeam.conference, "Big Ten")),
        params.teamSlug
          ? or(eq(homeTeam.slug, params.teamSlug), eq(awayTeam.slug, params.teamSlug))
          : sql`1 = 1`,
      ),
    )
    .orderBy(desc(games.date), desc(games.id))
    .limit(params.scanLimit);

  return rows.filter((row) => isFinalStatus(row.status)) as Array<
    CandidateGame & { homeConference: string | null; awayConference: string | null }
  >;
}

async function countPlayerTeamCoverage(gameId: number) {
  const { db } = await getTeamIdMap();
  const rows = await db
    .select({
      count: sql<number>`count(distinct ${playerGameStats.teamId})`,
    })
    .from(playerGameStats)
    .where(eq(playerGameStats.gameId, gameId));
  return Number(rows[0]?.count ?? 0);
}

async function countRemaining(params: { season: number; teamSlug?: string; scanLimit: number }) {
  const finalGames = await getCandidateGames(params);
  let remaining = 0;
  for (const game of finalGames) {
    const coverage = await countPlayerTeamCoverage(game.id);
    if (coverage < 2) {
      remaining += 1;
    }
  }
  return { remaining, finalGamesConsidered: finalGames.length };
}

export async function POST(request: NextRequest) {
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
  if (!isAuthorized(request, adminToken)) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const season = parseIntParam(url.searchParams.get("season"), 2026);
  const limit = Math.min(Math.max(parseIntParam(url.searchParams.get("limit"), 10), 1), 25);
  const scanLimit = Math.min(Math.max(parseIntParam(url.searchParams.get("scanLimit"), 600), 50), 2000);
  const teamSlug = url.searchParams.get("team")?.trim().toLowerCase() || undefined;
  const includeRemaining = url.searchParams.get("includeRemaining") === "1";

  try {
    const db = getDb(env);
    const teamRows = await db.select({ id: teams.id, slug: teams.slug }).from(teams);
    const teamIdBySlug = new Map(teamRows.map((row) => [row.slug, row.id] as const));

    const baseSql = `
      select
        g.id as id,
        g.external_id as externalId,
        g.status as status,
        g.date as date,
        ht.slug as homeSlug,
        at.slug as awaySlug
      from games g
      join teams ht on ht.id = g.home_team_id
      join teams at on at.id = g.away_team_id
      left join player_game_stats pgs on pgs.game_id = g.id
      where g.season = ?
        and (ht.conference = 'Big Ten' or at.conference = 'Big Ten')
        and lower(coalesce(g.status, '')) like 'final%'
        ${teamSlug ? "and (ht.slug = ? or at.slug = ?)" : ""}
      group by g.id, g.external_id, g.status, g.date, ht.slug, at.slug
      having count(distinct pgs.team_id) < 2
      order by g.date desc, g.id desc
      limit ?
    `;
    const candidateStmt = env.b1g_analytics_db.prepare(baseSql);
    const candidateResult = teamSlug
      ? await candidateStmt.bind(season, teamSlug, teamSlug, limit).all<CandidateGame>()
      : await candidateStmt.bind(season, limit).all<CandidateGame>();
    const candidates = candidateResult.results ?? [];

    let processed = 0;
    let teamStatsUpserted = 0;
    let playerStatsUpserted = 0;
    const errors: Array<{ gameId: number; externalId: string; message: string }> = [];

    for (const game of candidates) {
      try {
        const boxscore = await fetchGameBoxscore({ eventId: game.externalId });
        if (!boxscore) {
          continue;
        }
        const teamStats = await upsertTeamGameStats(db, {
          gameId: game.id,
          teamIdBySlug,
          boxscore,
        });
        teamStatsUpserted += teamStats.inserted + teamStats.updated;

        const playerStats = await upsertPlayerGameStats(db, {
          gameId: game.id,
          teamIdBySlug,
          boxscore,
        });
        playerStatsUpserted += playerStats.inserted + playerStats.updated;
        processed += 1;
      } catch (error) {
        errors.push({
          gameId: game.id,
          externalId: game.externalId,
          message: error instanceof Error ? error.message : "backfill failed",
        });
      }
    }

    const remainingSummary = includeRemaining
      ? await countRemaining({ season, teamSlug, scanLimit })
      : null;

    return NextResponse.json({
      status: "ok",
      season,
      team: teamSlug ?? null,
      processed,
      requestedLimit: limit,
      selectedCandidates: candidates.length,
      teamStatsUpserted,
      playerStatsUpserted,
      remainingGamesWithoutFullPlayerCoverage: remainingSummary?.remaining ?? null,
      finalGamesConsidered: remainingSummary?.finalGamesConsidered ?? null,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "player backfill failed",
      },
      { status: 500 },
    );
  }
}
