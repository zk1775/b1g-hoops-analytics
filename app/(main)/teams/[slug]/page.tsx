import Link from "next/link";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db/client";
import { games, playerGameStats, players, teamGameStats, teams } from "@/db/schema";
import { isFinalStatus } from "@/lib/data/status";
import { resolveDbEnv } from "@/lib/runtime/env";

export const runtime = "edge";

type TeamPageProps = {
  params: Promise<{ slug: string }>;
};

function formatDate(timestamp: number | null) {
  if (!timestamp) {
    return "TBD";
  }
  return new Date(timestamp * 1000).toLocaleDateString();
}

function pctString(made: number, attempts: number) {
  if (attempts <= 0) {
    return "-";
  }
  return `${((made / attempts) * 100).toFixed(1)}%`;
}

function formatResult(
  status: string | null,
  isHome: boolean,
  homeScore: number | null,
  awayScore: number | null,
) {
  if (homeScore === null || awayScore === null) {
    return status ?? "Scheduled";
  }
  const pointsFor = isHome ? homeScore : awayScore;
  const pointsAgainst = isHome ? awayScore : homeScore;
  if (!isFinalStatus(status)) {
    return `${pointsFor}-${pointsAgainst} (${status ?? "Live"})`;
  }
  if (pointsFor === pointsAgainst) {
    return `T ${pointsFor}-${pointsAgainst}`;
  }
  return `${pointsFor > pointsAgainst ? "W" : "L"} ${pointsFor}-${pointsAgainst}`;
}

export default async function TeamPage({ params }: TeamPageProps) {
  const { slug } = await params;
  const env = resolveDbEnv();

  if (!env) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Team: {slug}</h1>
        <p className="text-sm text-danger">Missing D1 binding: b1g_analytics_db</p>
      </section>
    );
  }

  const db = getDb(env);
  const team = await db.query.teams.findFirst({
    where: eq(teams.slug, slug),
  });

  if (!team) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Team Not Found</h1>
        <p className="text-sm text-muted">
          No team exists for slug <code className="rounded bg-panel px-1 py-0.5">{slug}</code>.
        </p>
      </section>
    );
  }

  const homeTeam = alias(teams, "home_team");
  const awayTeam = alias(teams, "away_team");

  const schedule = await db
    .select({
      id: games.id,
      season: games.season,
      date: games.date,
      status: games.status,
      homeTeamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      venue: games.venue,
      homeName: homeTeam.name,
      awayName: awayTeam.name,
      homeSlug: homeTeam.slug,
      awaySlug: awayTeam.slug,
    })
    .from(games)
    .innerJoin(homeTeam, eq(games.homeTeamId, homeTeam.id))
    .innerJoin(awayTeam, eq(games.awayTeamId, awayTeam.id))
    .where(or(eq(games.homeTeamId, team.id), eq(games.awayTeamId, team.id)))
    .orderBy(desc(games.date), desc(games.id));

  const scheduleGameIds = schedule.map((game) => game.id);
  const statRows =
    scheduleGameIds.length > 0
      ? await db
          .select({
            gameId: teamGameStats.gameId,
            teamId: teamGameStats.teamId,
            points: teamGameStats.points,
          })
          .from(teamGameStats)
          .where(inArray(teamGameStats.gameId, scheduleGameIds))
      : [];

  const pointsByGameTeam = new Map<string, number | null>();
  for (const row of statRows) {
    if (row.gameId === null || row.teamId === null) {
      continue;
    }
    pointsByGameTeam.set(`${row.gameId}:${row.teamId}`, row.points ?? null);
  }

  function resolveGameScores(game: (typeof schedule)[number]) {
    const homeScore =
      game.homeScore ??
      (game.homeTeamId !== null
        ? (pointsByGameTeam.get(`${game.id}:${game.homeTeamId}`) ?? null)
        : null);
    const awayScore =
      game.awayScore ??
      (game.awayTeamId !== null
        ? (pointsByGameTeam.get(`${game.id}:${game.awayTeamId}`) ?? null)
        : null);
    return { homeScore, awayScore };
  }

  let finalGamesCount = 0;
  let totalPointsFor = 0;
  let totalPointsAgainst = 0;
  let wins = 0;
  let losses = 0;

  for (const game of schedule) {
    const resolvedScores = resolveGameScores(game);
    if (
      !isFinalStatus(game.status) ||
      resolvedScores.homeScore === null ||
      resolvedScores.awayScore === null
    ) {
      continue;
    }

    const isHome = game.homeTeamId === team.id;
    const pointsFor = isHome ? resolvedScores.homeScore : resolvedScores.awayScore;
    const pointsAgainst = isHome ? resolvedScores.awayScore : resolvedScores.homeScore;
    totalPointsFor += pointsFor;
    totalPointsAgainst += pointsAgainst;
    finalGamesCount += 1;

    if (pointsFor > pointsAgainst) {
      wins += 1;
    } else if (pointsFor < pointsAgainst) {
      losses += 1;
    }
  }

  const avgPointsFor = finalGamesCount > 0 ? totalPointsFor / finalGamesCount : null;
  const avgPointsAgainst = finalGamesCount > 0 ? totalPointsAgainst / finalGamesCount : null;

  const possessionsSummary = await db
    .select({
      avgPossessions: sql<number>`avg(${teamGameStats.possessionsEst})`,
    })
    .from(teamGameStats)
    .where(eq(teamGameStats.teamId, team.id));
  const avgPossessions = possessionsSummary[0]?.avgPossessions ?? null;

  const futureGames = schedule.filter((game) => !isFinalStatus(game.status)).length;
  const currentSeason =
    schedule.reduce((max, game) => Math.max(max, game.season ?? 0), 0) || null;

  const playerStatRows =
    currentSeason !== null
      ? await db
          .select({
            gameId: playerGameStats.gameId,
            didNotPlay: playerGameStats.didNotPlay,
            starter: playerGameStats.starter,
            minutesDecimal: playerGameStats.minutesDecimal,
            points: playerGameStats.points,
            reb: playerGameStats.reb,
            ast: playerGameStats.ast,
            tov: playerGameStats.tov,
            stl: playerGameStats.stl,
            blk: playerGameStats.blk,
            fgm: playerGameStats.fgm,
            fga: playerGameStats.fga,
            fg3m: playerGameStats.fg3m,
            fg3a: playerGameStats.fg3a,
            ftm: playerGameStats.ftm,
            fta: playerGameStats.fta,
            playerId: playerGameStats.playerId,
            playerName: players.name,
            playerShortName: players.shortName,
            jersey: players.jersey,
            position: players.position,
          })
          .from(playerGameStats)
          .innerJoin(games, eq(playerGameStats.gameId, games.id))
          .leftJoin(players, eq(playerGameStats.playerId, players.id))
          .where(
            sql`${playerGameStats.teamId} = ${team.id} and ${games.season} = ${currentSeason} and lower(coalesce(${games.status}, '')) like 'final%'`,
          )
      : [];

  type PlayerSeasonRow = {
    key: string;
    playerName: string;
    playerShortName: string | null;
    jersey: string | null;
    position: string | null;
    gp: number;
    gs: number;
    minutes: number;
    points: number;
    reb: number;
    ast: number;
    tov: number;
    stl: number;
    blk: number;
    fgm: number;
    fga: number;
    fg3m: number;
    fg3a: number;
    ftm: number;
    fta: number;
  };

  const playerAgg = new Map<string, PlayerSeasonRow>();
  for (const row of playerStatRows) {
    const key = row.playerId !== null ? `id:${row.playerId}` : `name:${row.playerName ?? "unknown"}`;
    const didNotPlay = row.didNotPlay === true;
    let bucket = playerAgg.get(key);
    if (!bucket) {
      bucket = {
        key,
        playerName: row.playerName ?? row.playerShortName ?? "Unknown",
        playerShortName: row.playerShortName ?? null,
        jersey: row.jersey ?? null,
        position: row.position ?? null,
        gp: 0,
        gs: 0,
        minutes: 0,
        points: 0,
        reb: 0,
        ast: 0,
        tov: 0,
        stl: 0,
        blk: 0,
        fgm: 0,
        fga: 0,
        fg3m: 0,
        fg3a: 0,
        ftm: 0,
        fta: 0,
      };
      playerAgg.set(key, bucket);
    }

    if (didNotPlay) {
      continue;
    }

    bucket.gp += 1;
    if (row.starter) {
      bucket.gs += 1;
    }
    bucket.minutes += Number(row.minutesDecimal ?? 0);
    bucket.points += row.points ?? 0;
    bucket.reb += row.reb ?? 0;
    bucket.ast += row.ast ?? 0;
    bucket.tov += row.tov ?? 0;
    bucket.stl += row.stl ?? 0;
    bucket.blk += row.blk ?? 0;
    bucket.fgm += row.fgm ?? 0;
    bucket.fga += row.fga ?? 0;
    bucket.fg3m += row.fg3m ?? 0;
    bucket.fg3a += row.fg3a ?? 0;
    bucket.ftm += row.ftm ?? 0;
    bucket.fta += row.fta ?? 0;
  }

  const playerSeasonStats = [...playerAgg.values()]
    .filter((row) => row.gp > 0)
    .sort((a, b) => {
      const aPpg = a.gp > 0 ? a.points / a.gp : 0;
      const bPpg = b.gp > 0 ? b.points / b.gp : 0;
      if (aPpg !== bPpg) {
        return bPpg - aPpg;
      }
      return b.minutes - a.minutes;
    });

  return (
    <section className="space-y-5">
      <div className="data-panel data-grid-bg rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-accent" />
              Team Profile
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {team.name}
            </h1>
            <p className="mt-1.5 text-sm text-muted">{team.conference ?? "Independent"}</p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="data-panel rounded-xl p-2.5">
              <p className="stat-label">Record</p>
              <p className="stat-value mt-1 text-base text-white">
                {wins}-{losses}
              </p>
            </div>
            <div className="data-panel rounded-xl p-2.5">
              <p className="stat-label">Final Games</p>
              <p className="stat-value mt-1 text-base text-white">{finalGamesCount}</p>
            </div>
            <div className="data-panel rounded-xl p-2.5">
              <p className="stat-label">Remaining</p>
              <p className="stat-value mt-1 text-base text-white">{futureGames}</p>
            </div>
            <div className="data-panel rounded-xl p-2.5">
              <p className="stat-label">Slug</p>
              <p className="stat-value mt-1 text-xs text-white">{team.slug}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-2.5 lg:grid-cols-3">
        <div className="data-panel rounded-xl p-3">
          <p className="stat-label">Avg Points For</p>
          <p className="stat-value mt-1.5 text-xl text-white">
            {avgPointsFor !== null ? avgPointsFor.toFixed(1) : "N/A"}
          </p>
        </div>
        <div className="data-panel rounded-xl p-3">
          <p className="stat-label">Avg Points Against</p>
          <p className="stat-value mt-1.5 text-xl text-white">
            {avgPointsAgainst !== null ? avgPointsAgainst.toFixed(1) : "N/A"}
          </p>
        </div>
        <div className="data-panel rounded-xl p-3">
          <p className="stat-label">Avg Possessions Est</p>
          <p className="stat-value mt-1.5 text-xl text-white">
            {avgPossessions !== null ? Number(avgPossessions).toFixed(1) : "N/A"}
          </p>
        </div>
      </div>

      {schedule.length === 0 ? (
        <div className="data-panel rounded-xl p-4 text-sm text-muted">
          No games found yet. Run ingest via{" "}
          <code className="rounded bg-panel px-1 py-0.5 text-foreground/90">/api/ingest</code>.
        </div>
      ) : (
        <div className="data-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5 sm:px-4">
            <div>
              <p className="stat-label">Schedule & Results</p>
              <p className="text-sm text-foreground/90">All games for this team (B1G + OOC)</p>
            </div>
            <span className="stat-value text-xs text-muted">{schedule.length} games</span>
          </div>

          <div className="table-scroll overflow-x-auto">
            <table className="dense-table table-sticky min-w-full text-left">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Site</th>
                  <th>Opponent</th>
                  <th>Result</th>
                  <th>Venue</th>
                  <th>Game</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((game) => {
                  const isHome = game.homeTeamId === team.id;
                  const opponentName = isHome ? game.awayName : game.homeName;
                  const opponentSlug = isHome ? game.awaySlug : game.homeSlug;
                  const resolvedScores = resolveGameScores(game);
                  const resultText = formatResult(
                    game.status,
                    isHome,
                    resolvedScores.homeScore,
                    resolvedScores.awayScore,
                  );
                  const isWin = resultText.startsWith("W ");
                  const isLoss = resultText.startsWith("L ");

                  return (
                    <tr key={game.id}>
                      <td className="table-number">{formatDate(game.date)}</td>
                      <td>
                        <span className="rounded border border-line bg-panel px-1.5 py-0.5 text-xs text-muted">
                          {isHome ? "H" : "A"}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/teams/${opponentSlug}`}
                          prefetch={false}
                          className="font-medium text-foreground hover:text-accent"
                        >
                          {opponentName}
                        </Link>
                      </td>
                      <td>
                        <span
                          className={[
                            "table-number font-medium",
                            isWin
                              ? "text-accent-2"
                              : isLoss
                                ? "text-danger"
                                : "text-foreground/90",
                          ].join(" ")}
                        >
                          {resultText}
                        </span>
                      </td>
                      <td className="text-muted">{game.venue ?? "-"}</td>
                      <td>
                        <Link
                          href={`/games/${game.id}`}
                          prefetch={false}
                          className="rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-foreground/90 hover:border-accent/40 hover:text-accent"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="data-panel overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5 sm:px-4">
          <div>
            <p className="stat-label">Player Stats</p>
            <p className="text-sm text-foreground/90">
              {currentSeason ? `Season ${currentSeason}` : "Season totals"} player production and shooting splits
            </p>
          </div>
          <span className="stat-value text-xs text-muted">{playerSeasonStats.length} players</span>
        </div>

        {playerSeasonStats.length === 0 ? (
          <div className="p-4 text-sm text-muted">
            No player boxscore data ingested yet. Re-run ingest with boxscores enabled.
          </div>
        ) : (
          <div className="table-scroll overflow-x-auto">
            <table className="dense-table table-sticky min-w-[1200px] text-left">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>GP</th>
                  <th>GS</th>
                  <th>MPG</th>
                  <th>PPG</th>
                  <th>RPG</th>
                  <th>APG</th>
                  <th>TOV</th>
                  <th>STL</th>
                  <th>BLK</th>
                  <th>FG</th>
                  <th>FG%</th>
                  <th>3PT</th>
                  <th>3P%</th>
                  <th>FT</th>
                  <th>FT%</th>
                </tr>
              </thead>
              <tbody>
                {playerSeasonStats.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{row.playerName}</span>
                        {(row.jersey || row.position) && (
                          <span className="text-[10px] text-muted">
                            {[row.jersey ? `#${row.jersey}` : null, row.position].filter(Boolean).join(" ")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-number">{row.gp}</td>
                    <td className="table-number">{row.gs}</td>
                    <td className="table-number">{(row.minutes / row.gp).toFixed(1)}</td>
                    <td className="table-number">{(row.points / row.gp).toFixed(1)}</td>
                    <td className="table-number">{(row.reb / row.gp).toFixed(1)}</td>
                    <td className="table-number">{(row.ast / row.gp).toFixed(1)}</td>
                    <td className="table-number">{(row.tov / row.gp).toFixed(1)}</td>
                    <td className="table-number">{(row.stl / row.gp).toFixed(1)}</td>
                    <td className="table-number">{(row.blk / row.gp).toFixed(1)}</td>
                    <td className="table-number">{row.fgm}-{row.fga}</td>
                    <td className="table-number">{pctString(row.fgm, row.fga)}</td>
                    <td className="table-number">{row.fg3m}-{row.fg3a}</td>
                    <td className="table-number">{pctString(row.fg3m, row.fg3a)}</td>
                    <td className="table-number">{row.ftm}-{row.fta}</td>
                    <td className="table-number">{pctString(row.ftm, row.fta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
