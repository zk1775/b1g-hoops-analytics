import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db/client";
import { games, playerGameStats, players, teamGameStats, teams } from "@/db/schema";
import { resolveDbEnv } from "@/lib/runtime/env";

export const runtime = "edge";

type GamePageProps = {
  params: Promise<{ id: string }>;
};

function formatDate(timestamp: number | null) {
  if (!timestamp) {
    return "TBD";
  }
  return new Date(timestamp * 1000).toLocaleString();
}

function formatMinutes(minutes: string | null, minutesDecimal: number | null) {
  if (minutes && minutes.trim()) {
    return minutes;
  }
  if (minutesDecimal === null || minutesDecimal === undefined) {
    return "-";
  }
  return Number(minutesDecimal).toFixed(1);
}

export default async function GamePage({ params }: GamePageProps) {
  const { id } = await params;
  const gameId = Number(id);

  if (!Number.isInteger(gameId) || gameId <= 0) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Invalid Game ID</h1>
        <p className="text-sm text-muted">Game IDs must be positive integers.</p>
      </section>
    );
  }

  const env = resolveDbEnv();
  if (!env) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Game: {id}</h1>
        <p className="text-sm text-danger">Missing D1 binding: b1g_analytics_db</p>
      </section>
    );
  }

  const db = getDb(env);
  const homeTeam = alias(teams, "home_team");
  const awayTeam = alias(teams, "away_team");

  const rows = await db
    .select({
      id: games.id,
      externalId: games.externalId,
      date: games.date,
      status: games.status,
      homeTeamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      venue: games.venue,
      homeName: homeTeam.name,
      homeSlug: homeTeam.slug,
      awayName: awayTeam.name,
      awaySlug: awayTeam.slug,
    })
    .from(games)
    .innerJoin(homeTeam, eq(games.homeTeamId, homeTeam.id))
    .innerJoin(awayTeam, eq(games.awayTeamId, awayTeam.id))
    .where(eq(games.id, gameId))
    .limit(1);

  const game = rows[0];
  if (!game) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Game Not Found</h1>
        <p className="text-sm text-muted">No game exists with id {id}.</p>
      </section>
    );
  }

  const stats = await db
    .select({
      id: teamGameStats.id,
      teamId: teamGameStats.teamId,
      isHome: teamGameStats.isHome,
      teamName: teams.name,
      points: teamGameStats.points,
      fgm: teamGameStats.fgm,
      fga: teamGameStats.fga,
      fg3m: teamGameStats.fg3m,
      fg3a: teamGameStats.fg3a,
      ftm: teamGameStats.ftm,
      fta: teamGameStats.fta,
      oreb: teamGameStats.oreb,
      dreb: teamGameStats.dreb,
      reb: teamGameStats.reb,
      ast: teamGameStats.ast,
      stl: teamGameStats.stl,
      blk: teamGameStats.blk,
      tov: teamGameStats.tov,
      pf: teamGameStats.pf,
      possessionsEst: teamGameStats.possessionsEst,
    })
    .from(teamGameStats)
    .innerJoin(teams, eq(teamGameStats.teamId, teams.id))
    .where(eq(teamGameStats.gameId, gameId))
    .orderBy(desc(teamGameStats.isHome), desc(teamGameStats.id));

  const homeStatsRow = stats.find((row) => row.isHome === true) ?? null;
  const awayStatsRow = stats.find((row) => row.isHome === false) ?? null;
  const resolvedHomeScore = game.homeScore ?? homeStatsRow?.points ?? null;
  const resolvedAwayScore = game.awayScore ?? awayStatsRow?.points ?? null;

  const playerRows = await db
    .select({
      id: playerGameStats.id,
      teamId: playerGameStats.teamId,
      isHome: playerGameStats.isHome,
      starter: playerGameStats.starter,
      didNotPlay: playerGameStats.didNotPlay,
      minutes: playerGameStats.minutes,
      minutesDecimal: playerGameStats.minutesDecimal,
      points: playerGameStats.points,
      fgm: playerGameStats.fgm,
      fga: playerGameStats.fga,
      fg3m: playerGameStats.fg3m,
      fg3a: playerGameStats.fg3a,
      ftm: playerGameStats.ftm,
      fta: playerGameStats.fta,
      reb: playerGameStats.reb,
      ast: playerGameStats.ast,
      tov: playerGameStats.tov,
      stl: playerGameStats.stl,
      blk: playerGameStats.blk,
      oreb: playerGameStats.oreb,
      dreb: playerGameStats.dreb,
      pf: playerGameStats.pf,
      playerName: players.name,
      playerShortName: players.shortName,
      jersey: players.jersey,
      position: players.position,
    })
    .from(playerGameStats)
    .leftJoin(players, eq(playerGameStats.playerId, players.id))
    .where(eq(playerGameStats.gameId, gameId))
    .orderBy(desc(playerGameStats.isHome), desc(playerGameStats.starter), desc(playerGameStats.points));

  const homePlayerRows = playerRows.filter((row) => row.isHome === true);
  const awayPlayerRows = playerRows.filter((row) => row.isHome === false);

  return (
    <section className="space-y-5">
      <div className="data-panel data-grid-bg rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-accent" />
              Game Detail
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
              <Link href={`/teams/${game.awaySlug}`} prefetch={false} className="hover:text-accent">
                {game.awayName}
              </Link>{" "}
              at{" "}
              <Link href={`/teams/${game.homeSlug}`} prefetch={false} className="hover:text-accent">
                {game.homeName}
              </Link>
            </h1>
            <p className="text-sm leading-5 text-muted">
              {formatDate(game.date)} • {game.status ?? "Scheduled"}
              {game.venue ? ` • ${game.venue}` : ""}
            </p>
            <p className="stat-value text-xl text-white sm:text-2xl">
              {game.awayName} {resolvedAwayScore ?? "-"} - {game.homeName} {resolvedHomeScore ?? "-"}
            </p>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="data-panel rounded-xl p-2.5">
              <p className="stat-label">Local Game ID</p>
              <p className="stat-value mt-1 text-xs text-white">{game.id}</p>
            </div>
            <div className="data-panel rounded-xl p-2.5">
              <p className="stat-label">ESPN Event ID</p>
              <p className="stat-value mt-1 text-xs text-white">{game.externalId}</p>
            </div>
          </div>
        </div>
      </div>

      {stats.length === 0 ? (
        <div className="data-panel rounded-xl p-4 text-sm text-muted">
          <p>No stats ingested yet for this game.</p>
          <p className="mt-2">
            Run ingest with boxscores enabled via{" "}
            <code className="rounded bg-panel px-1 py-0.5 text-foreground/90">
              /api/ingest
            </code>{" "}
            with <code className="rounded bg-panel px-1 py-0.5 text-foreground/90">includeBoxscore=true</code>.
          </p>
        </div>
      ) : (
        <div className="data-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5 sm:px-4">
            <div>
              <p className="stat-label">Team Boxscore Stats</p>
              <p className="text-sm text-foreground/90">
                Parsed from ESPN summary / boxscore endpoints
              </p>
            </div>
            <span className="stat-value text-xs text-muted">{stats.length} rows</span>
          </div>

          <div className="table-scroll overflow-x-auto">
            <table className="dense-table table-sticky min-w-full text-left">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>PTS</th>
                  <th>FG</th>
                  <th>3PT</th>
                  <th>FT</th>
                  <th>OREB</th>
                  <th>DREB</th>
                  <th>REB</th>
                  <th>AST</th>
                  <th>TOV</th>
                  <th>STL</th>
                  <th>BLK</th>
                  <th>PF</th>
                  <th>Poss</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="rounded border border-line bg-panel px-1.5 py-0.5 text-xs text-muted">
                          {row.isHome ? "H" : "A"}
                        </span>
                        <span className="font-medium text-foreground">{row.teamName}</span>
                      </div>
                    </td>
                    <td className="table-number font-medium text-white">
                      {row.points ?? "-"}
                    </td>
                    <td className="table-number">
                      {row.fgm ?? "-"}-{row.fga ?? "-"}
                    </td>
                    <td className="table-number">
                      {row.fg3m ?? "-"}-{row.fg3a ?? "-"}
                    </td>
                    <td className="table-number">
                      {row.ftm ?? "-"}-{row.fta ?? "-"}
                    </td>
                    <td className="table-number">{row.oreb ?? "-"}</td>
                    <td className="table-number">{row.dreb ?? "-"}</td>
                    <td className="table-number">{row.reb ?? "-"}</td>
                    <td className="table-number">{row.ast ?? "-"}</td>
                    <td className="table-number">{row.tov ?? "-"}</td>
                    <td className="table-number">{row.stl ?? "-"}</td>
                    <td className="table-number">{row.blk ?? "-"}</td>
                    <td className="table-number">{row.pf ?? "-"}</td>
                    <td className="table-number">
                      {row.possessionsEst !== null && row.possessionsEst !== undefined
                        ? Number(row.possessionsEst).toFixed(1)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {playerRows.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {[
            { label: game.awayName, isHome: false, rows: awayPlayerRows },
            { label: game.homeName, isHome: true, rows: homePlayerRows },
          ].map((group) => (
            <div key={`${group.label}-${group.isHome ? "H" : "A"}`} className="data-panel overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
                <div>
                  <p className="stat-label">Player Boxscore</p>
                  <p className="text-sm text-foreground/90">
                    {group.label} {group.isHome ? "(Home)" : "(Away)"}
                  </p>
                </div>
                <span className="stat-value text-xs text-muted">{group.rows.length} players</span>
              </div>

              <div className="table-scroll overflow-x-auto">
                <table className="dense-table table-sticky min-w-[900px] text-left">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>MIN</th>
                      <th>PTS</th>
                      <th>FG</th>
                      <th>3PT</th>
                      <th>FT</th>
                      <th>REB</th>
                      <th>AST</th>
                      <th>TOV</th>
                      <th>STL</th>
                      <th>BLK</th>
                      <th>OREB</th>
                      <th>DREB</th>
                      <th>PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            {row.starter ? (
                              <span className="rounded border border-accent/30 bg-accent/10 px-1 py-0.5 text-[10px] text-accent">
                                S
                              </span>
                            ) : null}
                            <span className="font-medium text-foreground">
                              {row.playerName ?? row.playerShortName ?? "Unknown"}
                            </span>
                            {(row.jersey || row.position) && (
                              <span className="text-[10px] text-muted">
                                {[row.jersey ? `#${row.jersey}` : null, row.position].filter(Boolean).join(" ")}
                              </span>
                            )}
                            {row.didNotPlay ? (
                              <span className="rounded border border-line bg-panel px-1 py-0.5 text-[10px] text-muted">
                                DNP
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="table-number">
                          {row.didNotPlay ? "-" : formatMinutes(row.minutes, row.minutesDecimal)}
                        </td>
                        <td className="table-number">{row.didNotPlay ? "-" : (row.points ?? "-")}</td>
                        <td className="table-number">
                          {row.didNotPlay ? "-" : `${row.fgm ?? "-"}-${row.fga ?? "-"}`}
                        </td>
                        <td className="table-number">
                          {row.didNotPlay ? "-" : `${row.fg3m ?? "-"}-${row.fg3a ?? "-"}`}
                        </td>
                        <td className="table-number">
                          {row.didNotPlay ? "-" : `${row.ftm ?? "-"}-${row.fta ?? "-"}`}
                        </td>
                        <td className="table-number">{row.didNotPlay ? "-" : (row.reb ?? "-")}</td>
                        <td className="table-number">{row.didNotPlay ? "-" : (row.ast ?? "-")}</td>
                        <td className="table-number">{row.didNotPlay ? "-" : (row.tov ?? "-")}</td>
                        <td className="table-number">{row.didNotPlay ? "-" : (row.stl ?? "-")}</td>
                        <td className="table-number">{row.didNotPlay ? "-" : (row.blk ?? "-")}</td>
                        <td className="table-number">{row.didNotPlay ? "-" : (row.oreb ?? "-")}</td>
                        <td className="table-number">{row.didNotPlay ? "-" : (row.dreb ?? "-")}</td>
                        <td className="table-number">{row.didNotPlay ? "-" : (row.pf ?? "-")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
