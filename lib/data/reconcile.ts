import { eq } from "drizzle-orm";
import { getDb, type DbEnv } from "@/db/client";
import { games, teams } from "@/db/schema";
import { getCurrentSeasonYear } from "@/lib/data/ingest";
import { fetchGameBoxscore } from "@/lib/data/sources/espn";
import { fetchSportsReferenceGameBoxscore } from "@/lib/data/sources/sportsReference";
import { isFinalStatus } from "@/lib/data/status";
import { upsertPlayerGameStats, upsertTeamGameStats } from "@/lib/data/upsertGames";

export type ReconcileSourceName = "espn" | "sports-reference";

export type ReconcileRequest = {
  season?: number;
  team?: string;
  since?: string;
  until?: string;
  limit?: number;
  includePlayerStats?: boolean;
  sources?: ReconcileSourceName[];
};

export type ReconcileError = {
  gameId?: number;
  eventId?: string;
  source?: ReconcileSourceName;
  message: string;
};

export type ReconcileSummary = {
  season: number;
  team: string | null;
  includePlayerStats: boolean;
  sources: ReconcileSourceName[];
  candidatesScanned: number;
  candidatesMatched: number;
  gamesReconciled: number;
  teamStatsUpserted: number;
  playerStatsUpserted: number;
  sourceHits: Record<ReconcileSourceName, number>;
  sourceMisses: Record<ReconcileSourceName, number>;
  errors: ReconcileError[];
};

type CandidateGame = {
  id: number;
  externalId: string;
  status: string | null;
  date: number | null;
  homeSlug: string;
  awaySlug: string;
  homeScore: number | null;
  awayScore: number | null;
  teamStatsTeams: number;
  playerStatsTeams: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function normalizeSources(sources: ReconcileSourceName[] | undefined): ReconcileSourceName[] {
  const defaults: ReconcileSourceName[] = ["espn", "sports-reference"];
  if (!sources?.length) {
    return defaults;
  }
  const ordered = sources.filter((value): value is ReconcileSourceName =>
    value === "espn" || value === "sports-reference",
  );
  return ordered.length ? ordered : defaults;
}

function normalizeRequest(input: ReconcileRequest) {
  const season = input.season ?? getCurrentSeasonYear();
  const team = input.team?.trim().toLowerCase() || null;
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);
  const includePlayerStats = input.includePlayerStats ?? true;
  const sources = normalizeSources(input.sources);

  const sinceDate = parseIsoDate(input.since);
  const untilDate = parseIsoDate(input.until);
  const sinceEpoch = sinceDate ? toEpochStart(sinceDate) : null;
  const untilEpoch = untilDate ? toEpochEnd(untilDate) : null;

  if (sinceEpoch !== null && untilEpoch !== null && sinceEpoch > untilEpoch) {
    throw new Error("since must be less than or equal to until");
  }

  return { season, team, limit, includePlayerStats, sources, sinceEpoch, untilEpoch };
}

async function getTeamIdBySlug(env: DbEnv) {
  const db = getDb(env);
  const rows = await db.select({ id: teams.id, slug: teams.slug }).from(teams);
  return new Map(rows.map((row) => [row.slug, row.id] as const));
}

async function getCandidateGames(
  env: DbEnv,
  params: ReturnType<typeof normalizeRequest>,
): Promise<CandidateGame[]> {
  const whereParts = [
    "g.season = ?",
    "(ht.conference = 'Big Ten' OR at.conference = 'Big Ten')",
    "(lower(coalesce(g.status, '')) like 'final%' OR (g.date is not null and g.date <= ?))",
  ];
  const nowEpoch = Math.floor(Date.now() / 1000);
  const binds: Array<string | number> = [params.season, nowEpoch];

  if (params.team) {
    whereParts.push("(ht.slug = ? OR at.slug = ?)");
    binds.push(params.team, params.team);
  }
  if (params.sinceEpoch !== null) {
    whereParts.push("g.date >= ?");
    binds.push(params.sinceEpoch);
  }
  if (params.untilEpoch !== null) {
    whereParts.push("g.date <= ?");
    binds.push(params.untilEpoch);
  }

  const sql = `
    select
      g.id as id,
      g.external_id as externalId,
      g.status as status,
      g.date as date,
      ht.slug as homeSlug,
      at.slug as awaySlug,
      g.home_score as homeScore,
      g.away_score as awayScore,
      count(distinct tgs.team_id) as teamStatsTeams,
      count(distinct pgs.team_id) as playerStatsTeams
    from games g
    join teams ht on ht.id = g.home_team_id
    join teams at on at.id = g.away_team_id
    left join team_game_stats tgs on tgs.game_id = g.id
    left join player_game_stats pgs on pgs.game_id = g.id
    where ${whereParts.join(" and ")}
    group by g.id, g.external_id, g.status, g.date, ht.slug, at.slug, g.home_score, g.away_score
    having
      g.home_score is null or
      g.away_score is null or
      count(distinct tgs.team_id) < 2 or
      count(distinct pgs.team_id) < 2
    order by g.date desc, g.id desc
    limit ?
  `;

  binds.push(params.limit);
  const result = await env.b1g_analytics_db.prepare(sql).bind(...binds).all<CandidateGame>();
  const rows = (result.results ?? []) as CandidateGame[];
  return rows.map((row: CandidateGame) => ({
    ...row,
    id: Number(row.id),
    date: row.date === null ? null : Number(row.date),
    homeScore: row.homeScore === null ? null : Number(row.homeScore),
    awayScore: row.awayScore === null ? null : Number(row.awayScore),
    teamStatsTeams: Number(row.teamStatsTeams ?? 0),
    playerStatsTeams: Number(row.playerStatsTeams ?? 0),
  }));
}

export async function runReconcile(env: DbEnv, input: ReconcileRequest): Promise<ReconcileSummary> {
  const db = getDb(env);
  const request = normalizeRequest(input);
  const teamIdBySlug = await getTeamIdBySlug(env);
  const candidates = await getCandidateGames(env, request);
  const errors: ReconcileError[] = [];
  const sourceHits: Record<ReconcileSourceName, number> = { espn: 0, "sports-reference": 0 };
  const sourceMisses: Record<ReconcileSourceName, number> = { espn: 0, "sports-reference": 0 };
  let gamesReconciled = 0;
  let teamStatsUpserted = 0;
  let playerStatsUpserted = 0;

  for (const candidate of candidates) {
    let resolved = false;

    for (const source of request.sources) {
      try {
        const boxscore =
          source === "espn"
            ? await fetchGameBoxscore({ eventId: candidate.externalId })
            : await fetchSportsReferenceGameBoxscore({
                eventId: candidate.externalId,
                season: request.season,
                homeSlug: candidate.homeSlug,
                awaySlug: candidate.awaySlug,
                dateEpoch: candidate.date,
              });

        if (!boxscore || !isFinalStatus(boxscore.status)) {
          sourceMisses[source] += 1;
          continue;
        }

        const teamStats = await upsertTeamGameStats(db, {
          gameId: candidate.id,
          teamIdBySlug,
          boxscore,
        });
        teamStatsUpserted += teamStats.inserted + teamStats.updated;

        if (request.includePlayerStats) {
          const playerStats = await upsertPlayerGameStats(db, {
            gameId: candidate.id,
            teamIdBySlug,
            boxscore,
          });
          playerStatsUpserted += playerStats.inserted + playerStats.updated;
        }

        await db
          .update(games)
          .set({
            status: boxscore.status ?? candidate.status,
            date: boxscore.date ?? candidate.date,
          })
          .where(eq(games.id, candidate.id));

        sourceHits[source] += 1;
        gamesReconciled += 1;
        resolved = true;
        break;
      } catch (error) {
        errors.push({
          gameId: candidate.id,
          eventId: candidate.externalId,
          source,
          message: error instanceof Error ? error.message : "source reconcile failed",
        });
      }
    }

    if (!resolved) {
      errors.push({
        gameId: candidate.id,
        eventId: candidate.externalId,
        message: "No source returned a final boxscore for this candidate",
      });
    }
  }

  return {
    season: request.season,
    team: request.team,
    includePlayerStats: request.includePlayerStats,
    sources: request.sources,
    candidatesScanned: candidates.length,
    candidatesMatched: candidates.length,
    gamesReconciled,
    teamStatsUpserted,
    playerStatsUpserted,
    sourceHits,
    sourceMisses,
    errors,
  };
}
