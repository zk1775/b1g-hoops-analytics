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
        <p className="text-sm text-danger">Missing D1 binding: b1g_analytics_db</p>
      </section>
    );
  }

  const db = getDb(env);
  const b1gTeams = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      shortName: teams.shortName,
    })
    .from(teams)
    .where(eq(teams.conference, "Big Ten"))
    .orderBy(asc(teams.name));

  if (b1gTeams.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Teams</h1>
        <p className="text-sm text-muted">
          No Big Ten teams found. Run{" "}
          <code className="rounded bg-panel px-1 py-0.5 text-foreground/90">npm run seed:b1g</code>.
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
    <section className="space-y-5">
      <div className="data-panel data-grid-bg rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="stat-label">Team Table</p>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Big Ten Teams
            </h1>
            <p className="mt-1.5 text-sm leading-5 text-muted">
              Compact team index with record and quick links to last/next games.
            </p>
          </div>
          <span className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
            {b1gTeams.length} teams
          </span>
        </div>
      </div>

      <div className="data-panel overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="dense-table min-w-full text-left">
            <thead>
              <tr>
                <th>Team</th>
                <th>Rec</th>
                <th>Last Game</th>
                <th>Next Game</th>
                <th>Profile</th>
              </tr>
            </thead>
            <tbody>
              {b1gTeams.map((team) => {
                const summary = summaries.get(team.id)!;
                return (
                  <tr key={team.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-7 w-7 place-items-center rounded-md border border-line bg-panel-2">
                          <span className="stat-value text-[10px] text-accent">
                            {team.shortName}
                          </span>
                        </span>
                        <div>
                          <Link
                            href={`/teams/${team.slug}`}
                            prefetch={false}
                            className="font-medium text-foreground hover:text-accent"
                          >
                            {team.name}
                          </Link>
                          <p className="text-[11px] text-muted">{team.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="stat-value text-xs text-white">
                        {summary.wins}-{summary.losses}
                      </span>
                    </td>
                    <td className="text-muted">
                      {summary.lastGame ? (
                        <Link
                          href={`/games/${summary.lastGame.id}`}
                          prefetch={false}
                          className="hover:text-accent"
                        >
                          <span className="text-foreground/90">{summary.lastGame.opponent}</span>
                          <span className="ml-2 text-[11px] text-muted">
                            ({formatDate(summary.lastGame.date)})
                          </span>
                        </Link>
                      ) : (
                        "N/A"
                      )}
                    </td>
                    <td className="text-muted">
                      {summary.nextGame ? (
                        <Link
                          href={`/games/${summary.nextGame.id}`}
                          prefetch={false}
                          className="hover:text-accent"
                        >
                          <span className="text-foreground/90">{summary.nextGame.opponent}</span>
                          <span className="ml-2 text-[11px] text-muted">
                            ({formatDate(summary.nextGame.date)})
                          </span>
                        </Link>
                      ) : (
                        "N/A"
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/teams/${team.slug}`}
                        prefetch={false}
                        className="rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-foreground/90 hover:border-accent/40 hover:text-accent"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
