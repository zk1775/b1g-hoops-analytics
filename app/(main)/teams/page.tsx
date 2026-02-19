import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { games, teams } from "@/db/schema";
import { isFinalStatus } from "@/lib/data/status";
import { resolveDbEnv } from "@/lib/runtime/env";

export const runtime = "edge";

function formatDate(timestamp: number | null) {
  if (!timestamp) {
    return "TBD";
  }
  return new Date(timestamp * 1000).toLocaleDateString();
}

type TeamSummary = {
  wins: number;
  losses: number;
  lastGame: { id: number; date: number | null; opponent: string } | null;
  nextGame: { id: number; date: number | null; opponent: string } | null;
};

export default async function TeamsPage() {
  const env = resolveDbEnv();
  if (!env) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Teams</h1>
        <p className="text-sm text-red-700">Missing D1 binding: b1g_analytics_db</p>
      </section>
    );
  }

  const db = getDb(env);
  const b1gTeams = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
    })
    .from(teams)
    .where(eq(teams.conference, "Big Ten"))
    .orderBy(asc(teams.name));

  if (b1gTeams.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Teams</h1>
        <p className="text-sm text-black/70">
          No Big Ten teams found. Run <code>npm run seed:b1g</code>.
        </p>
      </section>
    );
  }

  const allTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
    })
    .from(teams);
  const teamNameById = new Map(allTeams.map((team) => [team.id, team.name]));

  const allGames = await db
    .select({
      id: games.id,
      date: games.date,
      status: games.status,
      homeTeamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
    })
    .from(games);

  const summaries = new Map<number, TeamSummary>();
  for (const team of b1gTeams) {
    summaries.set(team.id, { wins: 0, losses: 0, lastGame: null, nextGame: null });
  }

  for (const game of allGames) {
    if (!game.homeTeamId || !game.awayTeamId) {
      continue;
    }

    const matchups = [
      { teamId: game.homeTeamId, opponentId: game.awayTeamId, isHome: true },
      { teamId: game.awayTeamId, opponentId: game.homeTeamId, isHome: false },
    ];

    for (const matchup of matchups) {
      const summary = summaries.get(matchup.teamId);
      if (!summary) {
        continue;
      }

      const opponentName = teamNameById.get(matchup.opponentId) ?? "Opponent";
      const gameDate = game.date ?? null;

      if (isFinalStatus(game.status) && game.homeScore !== null && game.awayScore !== null) {
        const teamScore = matchup.isHome ? game.homeScore : game.awayScore;
        const oppScore = matchup.isHome ? game.awayScore : game.homeScore;
        if (teamScore > oppScore) {
          summary.wins += 1;
        } else if (teamScore < oppScore) {
          summary.losses += 1;
        }
      }

      if (!isFinalStatus(game.status)) {
        if (
          !summary.nextGame ||
          (summary.nextGame.date ?? Number.MAX_SAFE_INTEGER) > (gameDate ?? Number.MAX_SAFE_INTEGER)
        ) {
          summary.nextGame = { id: game.id, date: gameDate, opponent: opponentName };
        }
      }

      if (isFinalStatus(game.status) && gameDate !== null) {
        if (!summary.lastGame || (summary.lastGame.date ?? 0) < gameDate) {
          summary.lastGame = { id: game.id, date: gameDate, opponent: opponentName };
        }
      }
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Teams</h1>
      <ul className="space-y-2">
        {b1gTeams.map((team) => {
          const summary = summaries.get(team.id)!;
          return (
            <li key={team.id} className="rounded border border-black/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link href={`/teams/${team.slug}`} className="font-medium hover:underline">
                    {team.name}
                  </Link>
                  <p className="text-sm text-black/70">
                    Record: {summary.wins}-{summary.losses}
                  </p>
                </div>
                <div className="text-sm text-black/70">
                  <p>
                    Last:{" "}
                    {summary.lastGame ? (
                      <Link href={`/games/${summary.lastGame.id}`} className="hover:underline">
                        {summary.lastGame.opponent} ({formatDate(summary.lastGame.date)})
                      </Link>
                    ) : (
                      "N/A"
                    )}
                  </p>
                  <p>
                    Next:{" "}
                    {summary.nextGame ? (
                      <Link href={`/games/${summary.nextGame.id}`} className="hover:underline">
                        {summary.nextGame.opponent} ({formatDate(summary.nextGame.date)})
                      </Link>
                    ) : (
                      "N/A"
                    )}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
