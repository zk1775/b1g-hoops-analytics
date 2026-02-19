import Link from "next/link";
import { desc, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db/client";
import { games, teamGameStats, teams } from "@/db/schema";
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
        <p className="text-sm text-red-700">Missing D1 binding: b1g_analytics_db</p>
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
        <p className="text-sm text-black/70">
          No team exists for slug <code>{slug}</code>.
        </p>
      </section>
    );
  }

  const homeTeam = alias(teams, "home_team");
  const awayTeam = alias(teams, "away_team");

  const schedule = await db
    .select({
      id: games.id,
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

  let finalGamesCount = 0;
  let totalPointsFor = 0;
  let totalPointsAgainst = 0;
  for (const game of schedule) {
    if (!isFinalStatus(game.status) || game.homeScore === null || game.awayScore === null) {
      continue;
    }
    const isHome = game.homeTeamId === team.id;
    totalPointsFor += isHome ? game.homeScore : game.awayScore;
    totalPointsAgainst += isHome ? game.awayScore : game.homeScore;
    finalGamesCount += 1;
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

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{team.name}</h1>
        <p className="text-sm text-black/70">{team.conference ?? "Independent"}</p>
      </div>

      <div className="grid gap-2 rounded border border-black/10 p-3 text-sm sm:grid-cols-3">
        <p>
          Avg Points For:{" "}
          <span className="font-medium">
            {avgPointsFor !== null ? avgPointsFor.toFixed(1) : "N/A"}
          </span>
        </p>
        <p>
          Avg Points Against:{" "}
          <span className="font-medium">
            {avgPointsAgainst !== null ? avgPointsAgainst.toFixed(1) : "N/A"}
          </span>
        </p>
        <p>
          Avg Possessions Est:{" "}
          <span className="font-medium">
            {avgPossessions !== null ? Number(avgPossessions).toFixed(1) : "N/A"}
          </span>
        </p>
      </div>

      {schedule.length === 0 ? (
        <div className="rounded border border-black/10 p-4 text-sm text-black/70">
          No games found yet. Run ingest via <code>/api/ingest</code>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-black/10">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-black/10 bg-black/5">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Opponent</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Venue</th>
                <th className="px-3 py-2">Game</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((game) => {
                const isHome = game.homeTeamId === team.id;
                const opponentName = isHome ? game.awayName : game.homeName;
                const opponentSlug = isHome ? game.awaySlug : game.homeSlug;
                return (
                  <tr key={game.id} className="border-b border-black/10 last:border-0">
                    <td className="px-3 py-2">{formatDate(game.date)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/teams/${opponentSlug}`} className="hover:underline">
                        {opponentName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {formatResult(game.status, isHome, game.homeScore, game.awayScore)}
                    </td>
                    <td className="px-3 py-2">{game.venue ?? "-"}</td>
                    <td className="px-3 py-2">
                      <Link href={`/games/${game.id}`} className="hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
