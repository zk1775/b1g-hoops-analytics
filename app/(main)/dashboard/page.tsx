import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { games, teams } from "@/db/schema";
import IngestButton from "@/app/(main)/components/IngestButton";
import { resolveDbEnv } from "@/lib/runtime/env";

export const runtime = "edge";

export default async function DashboardPage() {
  const env = resolveDbEnv();
  if (!env) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-danger">Missing D1 binding: b1g_analytics_db</p>
      </section>
    );
  }

  const db = getDb(env);
  const [teamRows, teamCountRows, gameCountRows, finalGameCountRows] = await Promise.all([
    db
      .select({
        slug: teams.slug,
        name: teams.name,
        shortName: teams.shortName,
      })
      .from(teams)
      .where(eq(teams.conference, "Big Ten"))
      .orderBy(asc(teams.name)),
    db
      .select({ totalTeams: sql<number>`count(*)` })
      .from(teams)
      .where(eq(teams.conference, "Big Ten")),
    db.select({ totalGames: sql<number>`count(*)` }).from(games),
    db
      .select({
        finalGames: sql<number>`count(*)`,
      })
      .from(games)
      .where(sql`lower(coalesce(${games.status}, '')) like 'final%'`),
  ]);

  const summary = {
    totalTeams: teamCountRows[0]?.totalTeams ?? 0,
    totalGames: gameCountRows[0]?.totalGames ?? 0,
    finalGames: finalGameCountRows[0]?.finalGames ?? 0,
  };
  const pendingGames = Math.max(0, (summary.totalGames ?? 0) - (summary.finalGames ?? 0));

  return (
    <section className="space-y-5">
      <div className="data-panel data-grid-bg rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-accent-2" />
              Live D1 + ESPN ingestion
            </div>

            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Dashboard
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-5 text-muted">
                Modern, data-first Big Ten hoops tracker inspired by BartTorvik’s utility, with a
                cleaner visual system for daily use.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="data-panel rounded-xl p-2.5">
                <p className="stat-label">B1G Teams</p>
                <p className="stat-value mt-1 text-lg text-white">{summary.totalTeams ?? 0}</p>
              </div>
              <div className="data-panel rounded-xl p-2.5">
                <p className="stat-label">Games In DB</p>
                <p className="stat-value mt-1 text-lg text-white">{summary.totalGames ?? 0}</p>
              </div>
              <div className="data-panel rounded-xl p-2.5">
                <p className="stat-label">Pending / Future</p>
                <p className="stat-value mt-1 text-lg text-white">{pendingGames}</p>
              </div>
            </div>
          </div>

          <div className="w-full xl:max-w-md">
            <IngestButton />
          </div>
        </div>
      </div>

      {teamRows.length === 0 ? (
        <div className="data-panel rounded-xl p-4 text-sm text-muted">
          No teams loaded yet. Run{" "}
          <code className="rounded bg-panel px-1 py-0.5 text-foreground/90">npm run seed:b1g</code>.
        </div>
      ) : (
        <div className="data-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5 sm:px-4">
            <div>
              <p className="stat-label">Team Directory</p>
              <p className="text-sm text-foreground/90">
                Big Ten index with quick links to team pages and game logs
              </p>
            </div>
            <span className="stat-value text-xs text-muted">{teamRows.length} rows</span>
          </div>

          <div className="table-scroll overflow-x-auto">
            <table className="dense-table table-sticky min-w-full text-left">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th>Code</th>
                  <th>Slug</th>
                </tr>
              </thead>
              <tbody>
                {teamRows.map((team, index) => (
                  <tr key={team.slug}>
                    <td className="table-number text-muted">{index + 1}</td>
                    <td>
                      <Link
                        href={`/teams/${team.slug}`}
                        prefetch={false}
                        className="font-medium text-foreground hover:text-accent"
                      >
                        {team.name}
                      </Link>
                    </td>
                    <td>
                      <span className="stat-value text-xs text-foreground/90">
                        {team.shortName}
                      </span>
                    </td>
                    <td>
                      <code className="rounded bg-panel px-1.5 py-0.5 text-xs text-muted">
                        {team.slug}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
