import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db/client";
import { games, teamGameStats, teams } from "@/db/schema";
import IngestButton from "@/app/(main)/components/IngestButton";
import { resolveDbEnv } from "@/lib/runtime/env";

export const runtime = "edge";

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type Scope = "all" | "b1g";

type TeamMetricRow = {
  teamId: number;
  slug: string;
  name: string;
  shortName: string;
  games: number;
  wins: number;
  losses: number;
  confWins: number;
  confLosses: number;
  pointsFor: number;
  pointsAgainst: number;
  possessions: number;
  fgm: number;
  fg3m: number;
  fga: number;
  fta: number;
  tov: number;
  oreb: number;
  oppDreb: number;
  offEff: number | null;
  defEff: number | null;
  netEff: number | null;
  efgPct: number | null;
  tovPct: number | null;
  orbPct: number | null;
  ftRate: number | null;
  pace: number | null;
};

type MetricKey =
  | "offEff"
  | "defEff"
  | "netEff"
  | "efgPct"
  | "tovPct"
  | "orbPct"
  | "ftRate"
  | "pace";

type TeamGameEfficiencySample = {
  oppTeamId: number | null;
  offEff: number;
  defEff: number;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseScope(value: string | undefined): Scope {
  return value === "b1g" ? "b1g" : "all";
}

function round1(value: number | null) {
  return value === null || Number.isNaN(value) ? null : Math.round(value * 10) / 10;
}

function safePct(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}

function valueOrDash(value: number | null, digits = 1) {
  return value === null ? "-" : value.toFixed(digits);
}

function rankValues(
  rows: TeamMetricRow[],
  metric: MetricKey,
  direction: "asc" | "desc",
): Map<number, number> {
  const ranked = rows
    .map((row) => ({ teamId: row.teamId, value: row[metric] }))
    .filter((entry): entry is { teamId: number; value: number } => entry.value !== null)
    .sort((a, b) => (direction === "desc" ? b.value - a.value : a.value - b.value));

  const ranks = new Map<number, number>();
  let displayRank = 0;
  let prevValue: number | null = null;
  ranked.forEach((entry, index) => {
    if (prevValue === null || Math.abs(entry.value - prevValue) > 1e-9) {
      displayRank = index + 1;
      prevValue = entry.value;
    }
    ranks.set(entry.teamId, displayRank);
  });
  return ranks;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toneFromRank(rank: number | undefined, totalRows: number): "default" | "good" | "bad" {
  if (!rank || totalRows < 3) {
    return "default";
  }
  const tierSize = Math.max(1, Math.floor(totalRows / 3));
  if (rank <= tierSize) {
    return "good";
  }
  if (rank > totalRows - tierSize) {
    return "bad";
  }
  return "default";
}

function computeOpponentAdjustedEfficiencies(params: {
  teamIds: number[];
  samplesByTeamId: Map<number, TeamGameEfficiencySample[]>;
}) {
  const allSamples = Array.from(params.samplesByTeamId.values()).flat();
  const leagueBaseline =
    average(allSamples.map((sample) => sample.offEff)) ??
    average(allSamples.map((sample) => sample.defEff)) ??
    100;

  const offRatings = new Map<number, number>();
  const defRatings = new Map<number, number>();

  for (const teamId of params.teamIds) {
    const samples = params.samplesByTeamId.get(teamId) ?? [];
    offRatings.set(teamId, average(samples.map((sample) => sample.offEff)) ?? leagueBaseline);
    defRatings.set(teamId, average(samples.map((sample) => sample.defEff)) ?? leagueBaseline);
  }

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const nextOff = new Map<number, number>();
    const nextDef = new Map<number, number>();

    for (const teamId of params.teamIds) {
      const samples = params.samplesByTeamId.get(teamId) ?? [];
      if (samples.length === 0) {
        nextOff.set(teamId, offRatings.get(teamId) ?? leagueBaseline);
        nextDef.set(teamId, defRatings.get(teamId) ?? leagueBaseline);
        continue;
      }

      const adjustedOffSamples: number[] = [];
      const adjustedDefSamples: number[] = [];

      for (const sample of samples) {
        const oppDef =
          sample.oppTeamId !== null ? (defRatings.get(sample.oppTeamId) ?? leagueBaseline) : leagueBaseline;
        const oppOff =
          sample.oppTeamId !== null ? (offRatings.get(sample.oppTeamId) ?? leagueBaseline) : leagueBaseline;

        adjustedOffSamples.push(sample.offEff * (leagueBaseline / oppDef));
        adjustedDefSamples.push(sample.defEff * (leagueBaseline / oppOff));
      }

      const rawAdjOff = average(adjustedOffSamples) ?? leagueBaseline;
      const rawAdjDef = average(adjustedDefSamples) ?? leagueBaseline;

      // Light damping keeps the iterative estimates stable with uneven OOC samples.
      nextOff.set(teamId, 0.9 * rawAdjOff + 0.1 * leagueBaseline);
      nextDef.set(teamId, 0.9 * rawAdjDef + 0.1 * leagueBaseline);
    }

    offRatings.clear();
    defRatings.clear();
    for (const [teamId, value] of nextOff) {
      offRatings.set(teamId, value);
    }
    for (const [teamId, value] of nextDef) {
      defRatings.set(teamId, value);
    }
  }

  return { offRatings, defRatings, leagueBaseline };
}

function MetricCell({
  value,
  rank,
  digits = 1,
  tone = "default",
}: {
  value: number | null;
  rank?: number;
  digits?: number;
  tone?: "default" | "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-accent-2" : tone === "bad" ? "text-danger" : "text-foreground";

  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`table-number font-medium ${toneClass}`}>{valueOrDash(value, digits)}</span>
      {rank ? <span className="table-number text-[10px] text-muted">#{rank}</span> : null}
    </div>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const rawSearchParams = searchParams ? await searchParams : {};
  const scope = parseScope(firstParam(rawSearchParams.scope));

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
  const oppTeams = alias(teams, "opp_teams");
  const oppStats = alias(teamGameStats, "opp_stats");

  const [latestSeasonRows, b1gTeams, totalGamesRows, finalGamesRows, statRows] = await Promise.all([
    db
      .select({
        season: sql<number>`max(${games.season})`,
      })
      .from(games),
    db
      .select({
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        shortName: teams.shortName,
      })
      .from(teams)
      .where(eq(teams.conference, "Big Ten"))
      .orderBy(asc(teams.name)),
    db.select({ totalGames: sql<number>`count(*)` }).from(games),
    db
      .select({
        finalGames: sql<number>`count(*)`,
      })
      .from(games)
      .where(sql`lower(coalesce(${games.status}, '')) like 'final%'`),
    db
      .select({
        season: games.season,
        gameId: teamGameStats.gameId,
        teamId: teamGameStats.teamId,
        oppTeamId: teamGameStats.oppTeamId,
        teamSlug: teams.slug,
        teamName: teams.name,
        teamShortName: teams.shortName,
        oppConference: oppTeams.conference,
        points: teamGameStats.points,
        oppPoints: oppStats.points,
        fgm: teamGameStats.fgm,
        fg3m: teamGameStats.fg3m,
        fga: teamGameStats.fga,
        fta: teamGameStats.fta,
        tov: teamGameStats.tov,
        oreb: teamGameStats.oreb,
        oppDreb: oppStats.dreb,
        possessionsEst: teamGameStats.possessionsEst,
      })
      .from(teamGameStats)
      .innerJoin(games, eq(teamGameStats.gameId, games.id))
      .innerJoin(teams, eq(teamGameStats.teamId, teams.id))
      .leftJoin(oppTeams, eq(teamGameStats.oppTeamId, oppTeams.id))
      .leftJoin(
        oppStats,
        and(eq(oppStats.gameId, teamGameStats.gameId), eq(oppStats.teamId, teamGameStats.oppTeamId)),
      )
      .where(
        and(
          eq(teams.conference, "Big Ten"),
          sql`lower(coalesce(${games.status}, '')) like 'final%'`,
        ),
      ),
  ]);

  const currentSeason = latestSeasonRows[0]?.season ?? new Date().getUTCFullYear();
  const summary = {
    totalTeams: b1gTeams.length,
    totalGames: totalGamesRows[0]?.totalGames ?? 0,
    finalGames: finalGamesRows[0]?.finalGames ?? 0,
  };
  const pendingGames = Math.max(0, summary.totalGames - summary.finalGames);

  const aggregates = new Map<number, TeamMetricRow>();
  const samplesByTeamId = new Map<number, TeamGameEfficiencySample[]>();
  for (const team of b1gTeams) {
    aggregates.set(team.id, {
      teamId: team.id,
      slug: team.slug,
      name: team.name,
      shortName: team.shortName,
      games: 0,
      wins: 0,
      losses: 0,
      confWins: 0,
      confLosses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      possessions: 0,
      fgm: 0,
      fg3m: 0,
      fga: 0,
      fta: 0,
      tov: 0,
      oreb: 0,
      oppDreb: 0,
      offEff: null,
      defEff: null,
      netEff: null,
      efgPct: null,
      tovPct: null,
      orbPct: null,
      ftRate: null,
      pace: null,
    });
    samplesByTeamId.set(team.id, []);
  }

  for (const row of statRows) {
    if (row.season !== currentSeason || row.teamId === null || row.gameId === null) {
      continue;
    }
    if (scope === "b1g" && row.oppConference !== "Big Ten") {
      continue;
    }

    const bucket = aggregates.get(row.teamId);
    if (!bucket) {
      continue;
    }

    bucket.games += 1;

    const points = row.points ?? null;
    const oppPoints = row.oppPoints ?? null;
    if (points !== null) {
      bucket.pointsFor += points;
    }
    if (oppPoints !== null) {
      bucket.pointsAgainst += oppPoints;
    }
    if (points !== null && oppPoints !== null) {
      if (points > oppPoints) {
        bucket.wins += 1;
        if (row.oppConference === "Big Ten") {
          bucket.confWins += 1;
        }
      } else if (points < oppPoints) {
        bucket.losses += 1;
        if (row.oppConference === "Big Ten") {
          bucket.confLosses += 1;
        }
      }
    }

    bucket.fgm += row.fgm ?? 0;
    bucket.fg3m += row.fg3m ?? 0;
    bucket.fga += row.fga ?? 0;
    bucket.fta += row.fta ?? 0;
    bucket.tov += row.tov ?? 0;
    bucket.oreb += row.oreb ?? 0;
    bucket.oppDreb += row.oppDreb ?? 0;
    const possessions = Number(row.possessionsEst ?? 0);
    bucket.possessions += possessions;

    if (points !== null && oppPoints !== null && Number.isFinite(possessions) && possessions > 0) {
      const teamSamples = samplesByTeamId.get(row.teamId);
      if (teamSamples) {
        teamSamples.push({
          oppTeamId: row.oppTeamId,
          offEff: (points / possessions) * 100,
          defEff: (oppPoints / possessions) * 100,
        });
      }
    }
  }

  const adjustedEff = computeOpponentAdjustedEfficiencies({
    teamIds: b1gTeams.map((team) => team.id),
    samplesByTeamId,
  });

  const metricRows = Array.from(aggregates.values()).map((row) => {
    const rawOffEff = safePct(row.pointsFor, row.possessions);
    const rawDefEff = safePct(row.pointsAgainst, row.possessions);
    const offEff = adjustedEff.offRatings.get(row.teamId) ?? rawOffEff;
    const defEff = adjustedEff.defRatings.get(row.teamId) ?? rawDefEff;
    const efgPct = safePct(row.fgm + 0.5 * row.fg3m, row.fga);
    const tovPct = safePct(row.tov, row.possessions);
    const orbPct = safePct(row.oreb, row.oreb + row.oppDreb);
    const ftRate = safePct(row.fta, row.fga);
    const pace = row.games > 0 && row.possessions > 0 ? row.possessions / row.games : null;

    return {
      ...row,
      offEff: round1(offEff),
      defEff: round1(defEff),
      netEff: round1(
        offEff !== null && defEff !== null ? offEff - defEff : null,
      ),
      efgPct: round1(efgPct),
      tovPct: round1(tovPct),
      orbPct: round1(orbPct),
      ftRate: round1(ftRate),
      pace: round1(pace),
    };
  });

  const rankMaps = {
    offEff: rankValues(metricRows, "offEff", "desc"),
    defEff: rankValues(metricRows, "defEff", "asc"),
    netEff: rankValues(metricRows, "netEff", "desc"),
    efgPct: rankValues(metricRows, "efgPct", "desc"),
    tovPct: rankValues(metricRows, "tovPct", "asc"),
    orbPct: rankValues(metricRows, "orbPct", "desc"),
    ftRate: rankValues(metricRows, "ftRate", "desc"),
    pace: rankValues(metricRows, "pace", "desc"),
  } as const;

  const sortedRows = [...metricRows].sort((a, b) => {
    const aNet = a.netEff ?? -9999;
    const bNet = b.netEff ?? -9999;
    if (aNet !== bNet) {
      return bNet - aNet;
    }
    return a.name.localeCompare(b.name);
  });

  const scopeLabel = scope === "b1g" ? "B1G games only" : "All games";

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
              <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted">
                T-rank style Big Ten metrics board for season {currentSeason}. Rankings are computed
                across B1G teams using stored boxscore stats and possessions estimates.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="stat-label">Scope</span>
              <Link
                href="/dashboard?scope=all"
                prefetch={false}
                className={[
                  "rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide",
                  scope === "all"
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-line bg-panel text-muted hover:text-accent",
                ].join(" ")}
              >
                All Games
              </Link>
              <Link
                href="/dashboard?scope=b1g"
                prefetch={false}
                className={[
                  "rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide",
                  scope === "b1g"
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-line bg-panel text-muted hover:text-accent",
                ].join(" ")}
              >
                B1G Only
              </Link>
              <span className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-muted">
                Current: {scopeLabel}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="data-panel rounded-xl p-2.5">
                <p className="stat-label">B1G Teams</p>
                <p className="stat-value mt-1 text-lg text-white">{summary.totalTeams}</p>
              </div>
              <div className="data-panel rounded-xl p-2.5">
                <p className="stat-label">Games In DB</p>
                <p className="stat-value mt-1 text-lg text-white">{summary.totalGames}</p>
              </div>
              <div className="data-panel rounded-xl p-2.5">
                <p className="stat-label">Final Games</p>
                <p className="stat-value mt-1 text-lg text-white">{summary.finalGames}</p>
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

      {b1gTeams.length === 0 ? (
        <div className="data-panel rounded-xl p-4 text-sm text-muted">
          No teams loaded yet. Run{" "}
          <code className="rounded bg-panel px-1 py-0.5 text-foreground/90">npm run seed:b1g</code>.
        </div>
      ) : (
      <div className="data-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5 sm:px-4">
            <div>
              <p className="stat-label">B1G Advanced Metrics (Ranked)</p>
              <p className="text-sm text-foreground/90">
                Values shown with B1G rank in each metric. Adj efficiencies are opponent-adjusted via
                iterative B1G normalization with a neutral baseline for OOC opponents.
              </p>
            </div>
            <span className="stat-value text-xs text-muted">
              {sortedRows.length} rows • {scopeLabel}
            </span>
          </div>

          <div className="table-scroll overflow-x-auto">
            <table className="dense-table table-sticky min-w-[1200px] text-left">
              <thead>
                <tr>
                  <th>RK</th>
                  <th>Team</th>
                  <th>G</th>
                  <th>Rec</th>
                  <th>Conf Rec</th>
                  <th>AdjOE*</th>
                  <th>AdjDE*</th>
                  <th>Net</th>
                  <th>eFG%</th>
                  <th>TOV%</th>
                  <th>ORB%</th>
                  <th>FTR</th>
                  <th>Pace</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => (
                  <tr key={row.teamId}>
                    <td className="table-number text-muted">{index + 1}</td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-6 w-6 place-items-center rounded border border-line bg-panel-2">
                          <span className="stat-value text-[9px] text-accent">{row.shortName}</span>
                        </span>
                        <div>
                          <Link
                            href={`/teams/${row.slug}`}
                            prefetch={false}
                            className="font-medium text-foreground hover:text-accent"
                          >
                            {row.name}
                          </Link>
                          <p className="text-[10px] text-muted">{row.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-number">{row.games}</td>
                    <td className="table-number">
                      <span className="font-medium text-foreground/95">
                        {row.wins}-{row.losses}
                      </span>
                    </td>
                    <td className="table-number">
                      <span className="font-medium text-foreground/95">
                        {row.confWins}-{row.confLosses}
                      </span>
                    </td>
                    <td>
                      <MetricCell
                        value={row.offEff}
                        rank={rankMaps.offEff.get(row.teamId)}
                        tone={toneFromRank(rankMaps.offEff.get(row.teamId), sortedRows.length)}
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={row.defEff}
                        rank={rankMaps.defEff.get(row.teamId)}
                        tone={toneFromRank(rankMaps.defEff.get(row.teamId), sortedRows.length)}
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={row.netEff}
                        rank={rankMaps.netEff.get(row.teamId)}
                        tone={toneFromRank(rankMaps.netEff.get(row.teamId), sortedRows.length)}
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={row.efgPct}
                        rank={rankMaps.efgPct.get(row.teamId)}
                        tone={toneFromRank(rankMaps.efgPct.get(row.teamId), sortedRows.length)}
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={row.tovPct}
                        rank={rankMaps.tovPct.get(row.teamId)}
                        tone={toneFromRank(rankMaps.tovPct.get(row.teamId), sortedRows.length)}
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={row.orbPct}
                        rank={rankMaps.orbPct.get(row.teamId)}
                        tone={toneFromRank(rankMaps.orbPct.get(row.teamId), sortedRows.length)}
                      />
                    </td>
                    <td>
                      <MetricCell
                        value={row.ftRate}
                        rank={rankMaps.ftRate.get(row.teamId)}
                        tone={toneFromRank(rankMaps.ftRate.get(row.teamId), sortedRows.length)}
                      />
                    </td>
                    <td>
                      <MetricCell value={row.pace} rank={rankMaps.pace.get(row.teamId)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line/70 bg-panel/40 px-3 py-2 text-[11px] text-muted sm:px-4">
            * `AdjOE` / `AdjDE` are opponent-adjusted within the current B1G sample (iterative normalization).
            OOC opponents are treated as neutral baseline in `scope=all`.
          </div>
        </div>
      )}
    </section>
  );
}
