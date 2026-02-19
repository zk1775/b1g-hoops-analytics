import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db/client";
import { games, teamGameStats, teams } from "@/db/schema";
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

export default async function GamePage({ params }: GamePageProps) {
  const { id } = await params;
  const gameId = Number(id);

  if (!Number.isInteger(gameId) || gameId <= 0) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Invalid Game ID</h1>
        <p className="text-sm text-black/70">Game IDs must be positive integers.</p>
      </section>
    );
  }

  const env = resolveDbEnv();
  if (!env) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Game: {id}</h1>
        <p className="text-sm text-red-700">Missing D1 binding: b1g_analytics_db</p>
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
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      venue: games.venue,
      homeName: homeTeam.name,
      awayName: awayTeam.name,
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
        <p className="text-sm text-black/70">No game exists with id {id}.</p>
      </section>
    );
  }

  const stats = await db
    .select({
      id: teamGameStats.id,
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

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {game.awayName} at {game.homeName}
        </h1>
        <p className="text-sm text-black/70">
          {formatDate(game.date)} • {game.status ?? "Scheduled"}
          {game.venue ? ` • ${game.venue}` : ""}
        </p>
        <p className="text-lg font-medium">
          {game.awayName} {game.awayScore ?? "-"} - {game.homeName} {game.homeScore ?? "-"}
        </p>
      </div>

      {stats.length === 0 ? (
        <div className="rounded border border-black/10 p-3 text-sm text-black/70">
          <p>No stats ingested yet for this game.</p>
          <p className="mt-1">
            Run ingest with boxscores enabled:{" "}
            <Link
              href={`/api/ingest?mode=all&includeBoxscore=true&token=YOUR_ADMIN_TOKEN`}
              className="font-medium hover:underline"
            >
              /api/ingest?mode=all&includeBoxscore=true&token=YOUR_ADMIN_TOKEN
            </Link>
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-black/10">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-black/10 bg-black/5">
              <tr>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">PTS</th>
                <th className="px-3 py-2">FG</th>
                <th className="px-3 py-2">3PT</th>
                <th className="px-3 py-2">FT</th>
                <th className="px-3 py-2">OREB</th>
                <th className="px-3 py-2">DREB</th>
                <th className="px-3 py-2">REB</th>
                <th className="px-3 py-2">AST</th>
                <th className="px-3 py-2">TOV</th>
                <th className="px-3 py-2">STL</th>
                <th className="px-3 py-2">BLK</th>
                <th className="px-3 py-2">PF</th>
                <th className="px-3 py-2">Poss</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((row) => (
                <tr key={row.id} className="border-b border-black/10 last:border-0">
                  <td className="px-3 py-2">
                    {row.teamName}
                    {row.isHome ? " (Home)" : " (Away)"}
                  </td>
                  <td className="px-3 py-2">{row.points ?? "-"}</td>
                  <td className="px-3 py-2">
                    {row.fgm ?? "-"}-{row.fga ?? "-"}
                  </td>
                  <td className="px-3 py-2">
                    {row.fg3m ?? "-"}-{row.fg3a ?? "-"}
                  </td>
                  <td className="px-3 py-2">
                    {row.ftm ?? "-"}-{row.fta ?? "-"}
                  </td>
                  <td className="px-3 py-2">{row.oreb ?? "-"}</td>
                  <td className="px-3 py-2">{row.dreb ?? "-"}</td>
                  <td className="px-3 py-2">{row.reb ?? "-"}</td>
                  <td className="px-3 py-2">{row.ast ?? "-"}</td>
                  <td className="px-3 py-2">{row.tov ?? "-"}</td>
                  <td className="px-3 py-2">{row.stl ?? "-"}</td>
                  <td className="px-3 py-2">{row.blk ?? "-"}</td>
                  <td className="px-3 py-2">{row.pf ?? "-"}</td>
                  <td className="px-3 py-2">
                    {row.possessionsEst !== null && row.possessionsEst !== undefined
                      ? Number(row.possessionsEst).toFixed(1)
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
