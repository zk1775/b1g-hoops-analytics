import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db/client";
import { games, teamGameStats, teams } from "@/db/schema";
import { resolveDbEnv } from "@/lib/runtime/env";

export const runtime = "edge";

type TrendsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type Scope = "all" | "b1g";
type WindowSize = 5 | 10 | 15;

type RawTrendRow = {
  season: number | null;
  gameId: number | null;
  gameDate: number | null;
  venue: string | null;
  isHome: boolean | null;
  teamId: number | null;
  teamSlug: string;
  teamName: string;
  teamShortName: string;
  oppTeamId: number | null;
  oppSlug: string | null;
  oppName: string | null;
  oppConference: string | null;
  points: number | null;
  oppPoints: number | null;
  possessionsEst: number | null;
  fgm: number | null;
  fg3m: number | null;
  fga: number | null;
  fta: number | null;
  tov: number | null;
  oreb: number | null;
  oppDreb: number | null;
  oppFgm: number | null;
  oppFg3m: number | null;
  oppFga: number | null;
};

type GameTrend = {
  gameId: number;
  date: number | null;
  teamId: number;
  teamSlug: string;
  teamName: string;
  teamShortName: string;
  oppSlug: string | null;
  oppName: string | null;
  oppConference: string | null;
  venue: string | null;
  isHome: boolean;
  points: number | null;
  oppPoints: number | null;
  possessions: number | null;
  fgm: number | null;
  fg3m: number | null;
  fga: number | null;
  fta: number | null;
  tov: number | null;
  oreb: number | null;
  oppDreb: number | null;
  oppFgm: number | null;
  oppFg3m: number | null;
  oppFga: number | null;
  oe: number | null;
  de: number | null;
  net: number | null;
  efg: number | null;
  oppEfg: number | null;
  tovPct: number | null;
  orbPct: number | null;
  ftRate: number | null;
};

type TeamTrendSummary = {
  teamId: number;
  slug: string;
  name: string;
  shortName: string;
  gamesUsed: number;
  wins: number;
  losses: number;
  avgPF: number | null;
  avgPA: number | null;
  oe: number | null;
  de: number | null;
  net: number | null;
  efg: number | null;
  oppEfg: number | null;
  tovPct: number | null;
  orbPct: number | null;
  ftRate: number | null;
  pace: number | null;
  lastGameDate: number | null;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseScope(value: string | undefined): Scope {
  return value === "b1g" ? "b1g" : "all";
}

function parseWindow(value: string | undefined): WindowSize {
  if (value === "5" || value === "10" || value === "15") {
    return Number(value) as WindowSize;
  }
  return 10;
}

function round1(value: number | null) {
  return value === null || Number.isNaN(value) ? null : Math.round(value * 10) / 10;
}

function pct(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}

function per100(points: number, possessions: number) {
  if (!Number.isFinite(points) || !Number.isFinite(possessions) || possessions <= 0) {
    return null;
  }
  return (points / possessions) * 100;
}

function fmt(value: number | null, digits = 1) {
  return value === null ? "-" : value.toFixed(digits);
}

function formatDate(timestamp: number | null) {
  if (!timestamp) {
    return "TBD";
  }
  return new Date(timestamp * 1000).toLocaleDateString();
}

function formatResult(row: GameTrend) {
  if (row.points === null || row.oppPoints === null) {
    return "-";
  }
  const prefix = row.points > row.oppPoints ? "W" : row.points < row.oppPoints ? "L" : "T";
  return `${prefix} ${row.points}-${row.oppPoints}`;
}

function buildHref(params: {
  team?: string;
  scope?: Scope;
  window?: WindowSize;
}) {
  const search = new URLSearchParams();
  if (params.team && params.team !== "all") {
    search.set("team", params.team);
  }
  if (params.scope) {
    search.set("scope", params.scope);
  }
  if (params.window) {
    search.set("window", String(params.window));
  }
  const q = search.toString();
  return q ? `/trends?${q}` : "/trends";
}

function Sparkline({
  values,
  width = 220,
  height = 56,
  color = "#63d2ff",
}: {
  values: Array<number | null>;
  width?: number;
  height?: number;
  color?: string;
}) {
  const clean = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (clean.length < 2) {
    return <div className="h-14 rounded border border-line bg-panel/40" />;
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        return null;
      }
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 8) - 4;
      return { x, y };
    })
    .filter((p): p is { x: number; y: number } => p !== null);

  if (points.length < 2) {
    return <div className="h-14 rounded border border-line bg-panel/40" />;
  }

  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-14 w-full rounded border border-line bg-panel/40 p-1"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function rankMap(
  rows: TeamTrendSummary[],
  getValue: (row: TeamTrendSummary) => number | null,
  dir: "asc" | "desc",
) {
  const ranked = rows
    .map((row) => ({ teamId: row.teamId, value: getValue(row) }))
    .filter((entry): entry is { teamId: number; value: number } => entry.value !== null)
    .sort((a, b) => (dir === "desc" ? b.value - a.value : a.value - b.value));

  const ranks = new Map<number, number>();
  let prev: number | null = null;
  let rank = 0;
  ranked.forEach((row, index) => {
    if (prev === null || Math.abs(prev - row.value) > 1e-9) {
      rank = index + 1;
      prev = row.value;
    }
    ranks.set(row.teamId, rank);
  });
  return ranks;
}

export default async function TrendsPage({ searchParams }: TrendsPageProps) {
  const rawSearchParams = searchParams ? await searchParams : {};
  const scope = parseScope(firstParam(rawSearchParams.scope));
  const windowSize = parseWindow(firstParam(rawSearchParams.window));
  const selectedTeamSlug = firstParam(rawSearchParams.team) ?? "all";

  const env = resolveDbEnv();
  if (!env) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Trends</h1>
        <p className="text-sm text-danger">Missing D1 binding: b1g_analytics_db</p>
      </section>
    );
  }

  const db = getDb(env);
  const oppTeams = alias(teams, "opp_teams");
  const oppStats = alias(teamGameStats, "opp_stats");

  const [latestSeasonRows, b1gTeamRows, rawRows] = await Promise.all([
    db.select({ season: sql<number>`max(${games.season})` }).from(games),
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
    db
      .select({
        season: games.season,
        gameId: teamGameStats.gameId,
        gameDate: games.date,
        venue: games.venue,
        isHome: teamGameStats.isHome,
        teamId: teamGameStats.teamId,
        teamSlug: teams.slug,
        teamName: teams.name,
        teamShortName: teams.shortName,
        oppTeamId: teamGameStats.oppTeamId,
        oppSlug: oppTeams.slug,
        oppName: oppTeams.name,
        oppConference: oppTeams.conference,
        points: teamGameStats.points,
        oppPoints: oppStats.points,
        possessionsEst: teamGameStats.possessionsEst,
        fgm: teamGameStats.fgm,
        fg3m: teamGameStats.fg3m,
        fga: teamGameStats.fga,
        fta: teamGameStats.fta,
        tov: teamGameStats.tov,
        oreb: teamGameStats.oreb,
        oppDreb: oppStats.dreb,
        oppFgm: oppStats.fgm,
        oppFg3m: oppStats.fg3m,
        oppFga: oppStats.fga,
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

  const season = latestSeasonRows[0]?.season ?? new Date().getUTCFullYear();

  const gameTrends: GameTrend[] = rawRows
    .filter((row) => row.season === season)
    .filter((row) => (scope === "b1g" ? row.oppConference === "Big Ten" : true))
    .filter(
      (row): row is RawTrendRow & { teamId: number; gameId: number; isHome: boolean } =>
        row.teamId !== null && row.gameId !== null && row.isHome !== null,
    )
    .map((row) => {
      const possessions = row.possessionsEst !== null ? Number(row.possessionsEst) : null;
      const oe =
        row.points !== null && possessions !== null ? round1(per100(row.points, possessions)) : null;
      const de =
        row.oppPoints !== null && possessions !== null
          ? round1(per100(row.oppPoints, possessions))
          : null;
      const efg =
        row.fgm !== null && row.fg3m !== null && row.fga !== null
          ? round1(pct(row.fgm + 0.5 * row.fg3m, row.fga))
          : null;
      const oppEfg =
        row.oppFgm !== null && row.oppFg3m !== null && row.oppFga !== null
          ? round1(pct(row.oppFgm + 0.5 * row.oppFg3m, row.oppFga))
          : null;
      const tovPct =
        row.tov !== null && possessions !== null ? round1(pct(row.tov, possessions)) : null;
      const orbPct =
        row.oreb !== null && row.oppDreb !== null
          ? round1(pct(row.oreb, row.oreb + row.oppDreb))
          : null;
      const ftRate =
        row.fta !== null && row.fga !== null ? round1(pct(row.fta, row.fga)) : null;
      const net = oe !== null && de !== null ? round1(oe - de) : null;

      return {
        gameId: row.gameId,
        date: row.gameDate,
        venue: row.venue,
        isHome: row.isHome,
        teamId: row.teamId,
        teamSlug: row.teamSlug,
        teamName: row.teamName,
        teamShortName: row.teamShortName,
        oppSlug: row.oppSlug,
        oppName: row.oppName,
        oppConference: row.oppConference,
        points: row.points,
        oppPoints: row.oppPoints,
        possessions,
        fgm: row.fgm,
        fg3m: row.fg3m,
        fga: row.fga,
        fta: row.fta,
        tov: row.tov,
        oreb: row.oreb,
        oppDreb: row.oppDreb,
        oppFgm: row.oppFgm,
        oppFg3m: row.oppFg3m,
        oppFga: row.oppFga,
        oe,
        de,
        net,
        efg,
        oppEfg,
        tovPct,
        orbPct,
        ftRate,
      };
    });

  const byTeam = new Map<number, GameTrend[]>();
  for (const row of gameTrends) {
    const list = byTeam.get(row.teamId) ?? [];
    list.push(row);
    byTeam.set(row.teamId, list);
  }
  for (const list of byTeam.values()) {
    list.sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || b.gameId - a.gameId);
  }

  const trendRows: TeamTrendSummary[] = b1gTeamRows.map((team) => {
    const gamesForTeam = (byTeam.get(team.id) ?? []).slice(0, windowSize);

    let wins = 0;
    let losses = 0;
    let pointsFor = 0;
    let pointsAgainst = 0;
    let totalPoss = 0;
    let fgm = 0;
    let fg3m = 0;
    let fga = 0;
    let fta = 0;
    let tov = 0;
    let oreb = 0;
    let oppDreb = 0;
    let oppFgm = 0;
    let oppFg3m = 0;
    let oppFga = 0;
    let gamesWithScore = 0;

    for (const game of gamesForTeam) {
      if (game.points !== null) {
        pointsFor += game.points;
      }
      if (game.oppPoints !== null) {
        pointsAgainst += game.oppPoints;
      }
      if (game.points !== null && game.oppPoints !== null) {
        gamesWithScore += 1;
        if (game.points > game.oppPoints) {
          wins += 1;
        } else if (game.points < game.oppPoints) {
          losses += 1;
        }
      }
      totalPoss += game.possessions ?? 0;
      fgm += game.efg !== null ? game.fgm ?? 0 : 0;
      fg3m += game.fg3m ?? 0;
      fga += game.fga ?? 0;
      fta += game.fta ?? 0;
      tov += game.tov ?? 0;
      oreb += game.oreb ?? 0;
      oppDreb += game.oppDreb ?? 0;
      oppFgm += game.oppFgm ?? 0;
      oppFg3m += game.oppFg3m ?? 0;
      oppFga += game.oppFga ?? 0;
    }

    const avgPF = gamesWithScore > 0 ? pointsFor / gamesWithScore : null;
    const avgPA = gamesWithScore > 0 ? pointsAgainst / gamesWithScore : null;
    const oe = totalPoss > 0 ? per100(pointsFor, totalPoss) : null;
    const de = totalPoss > 0 ? per100(pointsAgainst, totalPoss) : null;
    const efg = fga > 0 ? pct(fgm + 0.5 * fg3m, fga) : null;
    const oppEfg = oppFga > 0 ? pct(oppFgm + 0.5 * oppFg3m, oppFga) : null;
    const tovPct = totalPoss > 0 ? pct(tov, totalPoss) : null;
    const orbPct = oreb + oppDreb > 0 ? pct(oreb, oreb + oppDreb) : null;
    const ftRate = fga > 0 ? pct(fta, fga) : null;
    const pace = gamesForTeam.length > 0 && totalPoss > 0 ? totalPoss / gamesForTeam.length : null;

    return {
      teamId: team.id,
      slug: team.slug,
      name: team.name,
      shortName: team.shortName,
      gamesUsed: gamesForTeam.length,
      wins,
      losses,
      avgPF: round1(avgPF),
      avgPA: round1(avgPA),
      oe: round1(oe),
      de: round1(de),
      net: round1(oe !== null && de !== null ? oe - de : null),
      efg: round1(efg),
      oppEfg: round1(oppEfg),
      tovPct: round1(tovPct),
      orbPct: round1(orbPct),
      ftRate: round1(ftRate),
      pace: round1(pace),
      lastGameDate: gamesForTeam[0]?.date ?? null,
    };
  });

  const filteredTrendRows = trendRows.filter((row) => row.gamesUsed > 0);
  const netRanks = rankMap(filteredTrendRows, (row) => row.net, "desc");
  const oeRanks = rankMap(filteredTrendRows, (row) => row.oe, "desc");
  const deRanks = rankMap(filteredTrendRows, (row) => row.de, "asc");
  const paceRanks = rankMap(filteredTrendRows, (row) => row.pace, "desc");

  filteredTrendRows.sort((a, b) => {
    const aNet = a.net ?? -9999;
    const bNet = b.net ?? -9999;
    if (aNet !== bNet) {
      return bNet - aNet;
    }
    return a.name.localeCompare(b.name);
  });

  const selectedTeam =
    selectedTeamSlug !== "all"
      ? b1gTeamRows.find((team) => team.slug === selectedTeamSlug) ?? null
      : null;
  const selectedGames = selectedTeam ? (byTeam.get(selectedTeam.id) ?? []).slice(0, 15) : [];

  const selectedWindowGames = selectedGames.slice(0, windowSize);
  const netSeries = [...selectedWindowGames].reverse().map((row) => row.net);
  const paceSeries = [...selectedWindowGames].reverse().map((row) => row.possessions);
  const pfSeries = [...selectedWindowGames].reverse().map((row) => row.points);
  const paSeries = [...selectedWindowGames].reverse().map((row) => row.oppPoints);

  const selectedSummary = selectedTeam
    ? filteredTrendRows.find((row) => row.teamId === selectedTeam.id) ?? null
    : null;

  return (
    <section className="space-y-5">
      <div className="data-panel data-grid-bg rounded-2xl p-4 sm:p-5">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-accent-2" />
            Rolling form / efficiency
          </div>
          <div>
            <p className="stat-label">Trends Workspace</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Trends
            </h1>
            <p className="mt-1.5 max-w-4xl text-sm leading-5 text-muted">
              Recent-form analytics board for season {season}. Compare B1G teams over the last N
              games and drill into one team’s rolling efficiency and shot-profile trendline.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="data-panel rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="stat-label">Scope</span>
            <Link
              href={buildHref({ team: selectedTeamSlug, scope: "all", window: windowSize })}
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
              href={buildHref({ team: selectedTeamSlug, scope: "b1g", window: windowSize })}
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

            <span className="ml-3 stat-label">Window</span>
            {[5, 10, 15].map((n) => (
              <Link
                key={n}
                href={buildHref({
                  team: selectedTeamSlug,
                  scope,
                  window: n as WindowSize,
                })}
                prefetch={false}
                className={[
                  "rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide",
                  windowSize === n
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-line bg-panel text-muted hover:text-accent",
                ].join(" ")}
              >
                Last {n}
              </Link>
            ))}
          </div>
        </div>

        <div className="data-panel rounded-xl p-3">
          <p className="stat-label">Team Focus</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Link
              href={buildHref({ team: "all", scope, window: windowSize })}
              prefetch={false}
              className={[
                "rounded-md border px-2 py-1 text-xs",
                selectedTeamSlug === "all"
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line bg-panel text-muted hover:text-accent",
              ].join(" ")}
            >
              All Teams
            </Link>
            {b1gTeamRows.map((team) => (
              <Link
                key={team.id}
                href={buildHref({ team: team.slug, scope, window: windowSize })}
                prefetch={false}
                className={[
                  "rounded-md border px-2 py-1 text-xs",
                  selectedTeamSlug === team.slug
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-line bg-panel text-muted hover:text-accent",
                ].join(" ")}
              >
                {team.shortName}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="data-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5 sm:px-4">
            <div>
              <p className="stat-label">Recent Form Leaderboard</p>
              <p className="text-sm text-foreground/90">
                Ranked by net efficiency over the selected window ({scope === "b1g" ? "B1G-only" : "all games"}).
              </p>
            </div>
            <span className="stat-value text-xs text-muted">
              {filteredTrendRows.length} teams • last {windowSize}
            </span>
          </div>

          <div className="table-scroll overflow-x-auto">
            <table className="dense-table table-sticky min-w-[1300px] text-left">
              <thead>
                <tr>
                  <th>RK</th>
                  <th>Team</th>
                  <th>G</th>
                  <th>Rec</th>
                  <th>Avg PF</th>
                  <th>Avg PA</th>
                  <th>OE</th>
                  <th>DE</th>
                  <th>Net</th>
                  <th>eFG%</th>
                  <th>Opp eFG%</th>
                  <th>TOV%</th>
                  <th>ORB%</th>
                  <th>FTR</th>
                  <th>Pace</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrendRows.map((row, index) => (
                  <tr key={row.teamId}>
                    <td className="table-number text-muted">{index + 1}</td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-6 w-6 place-items-center rounded border border-line bg-panel-2">
                          <span className="stat-value text-[9px] text-accent">{row.shortName}</span>
                        </span>
                        <div>
                          <Link
                            href={buildHref({ team: row.slug, scope, window: windowSize })}
                            prefetch={false}
                            className="font-medium text-foreground hover:text-accent"
                          >
                            {row.name}
                          </Link>
                          <p className="text-[10px] text-muted">{row.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-number">{row.gamesUsed}</td>
                    <td className="table-number">{row.wins}-{row.losses}</td>
                    <td className="table-number">{fmt(row.avgPF)}</td>
                    <td className="table-number">{fmt(row.avgPA)}</td>
                    <td className="table-number text-accent-2">
                      {fmt(row.oe)} <span className="text-[10px] text-muted">#{oeRanks.get(row.teamId) ?? "-"}</span>
                    </td>
                    <td className="table-number">
                      {fmt(row.de)} <span className="text-[10px] text-muted">#{deRanks.get(row.teamId) ?? "-"}</span>
                    </td>
                    <td className={`table-number font-medium ${row.net !== null && row.net >= 0 ? "text-accent-2" : "text-danger"}`}>
                      {fmt(row.net)} <span className="text-[10px] text-muted">#{netRanks.get(row.teamId) ?? "-"}</span>
                    </td>
                    <td className="table-number">{fmt(row.efg)}</td>
                    <td className="table-number">{fmt(row.oppEfg)}</td>
                    <td className="table-number">{fmt(row.tovPct)}</td>
                    <td className="table-number">{fmt(row.orbPct)}</td>
                    <td className="table-number">{fmt(row.ftRate)}</td>
                    <td className="table-number">
                      {fmt(row.pace)} <span className="text-[10px] text-muted">#{paceRanks.get(row.teamId) ?? "-"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="data-panel rounded-xl p-4">
            <p className="stat-label">Selected Team</p>
            {selectedTeam && selectedSummary ? (
              <div className="mt-2 space-y-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selectedTeam.name}</h2>
                  <p className="text-xs text-muted">
                    Last {windowSize} • {scope === "b1g" ? "B1G games only" : "all games"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-line bg-panel/50 p-2">
                    <p className="stat-label">Record</p>
                    <p className="stat-value mt-1 text-sm text-white">
                      {selectedSummary.wins}-{selectedSummary.losses}
                    </p>
                  </div>
                  <div className="rounded-lg border border-line bg-panel/50 p-2">
                    <p className="stat-label">Net</p>
                    <p
                      className={`stat-value mt-1 text-sm ${
                        (selectedSummary.net ?? 0) >= 0 ? "text-accent-2" : "text-danger"
                      }`}
                    >
                      {fmt(selectedSummary.net)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-line bg-panel/50 p-2">
                    <p className="stat-label">OE / DE</p>
                    <p className="stat-value mt-1 text-sm text-white">
                      {fmt(selectedSummary.oe)} / {fmt(selectedSummary.de)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-line bg-panel/50 p-2">
                    <p className="stat-label">Pace</p>
                    <p className="stat-value mt-1 text-sm text-white">{fmt(selectedSummary.pace)}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <p className="stat-label">Net Trend (old → recent)</p>
                    <Sparkline values={netSeries} color="#8bffb7" />
                  </div>
                  <div>
                    <p className="stat-label">Pace Trend (old → recent)</p>
                    <Sparkline values={paceSeries} color="#63d2ff" />
                  </div>
                  <div>
                    <p className="stat-label">Points For / Against (old → recent)</p>
                    <div className="space-y-1">
                      <Sparkline values={pfSeries} color="#8bffb7" />
                      <Sparkline values={paSeries} color="#ff6f7d" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">
                Select a team chip above to view rolling trend cards and game-by-game detail.
              </p>
            )}
          </div>

          <div className="data-panel rounded-xl p-4">
            <p className="stat-label">Trend Notes</p>
            <ul className="mt-2 space-y-2 text-xs text-muted">
              <li className="rounded-md border border-line bg-panel/40 px-2 py-1.5">
                `OE/DE/Net` use boxscore points with stored `possessions_est`.
              </li>
              <li className="rounded-md border border-line bg-panel/40 px-2 py-1.5">
                `scope=b1g` filters to B1G-vs-B1G finals only.
              </li>
              <li className="rounded-md border border-line bg-panel/40 px-2 py-1.5">
                Leaderboard ranks are relative to B1G teams over the selected window.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {selectedTeam ? (
        <div className="data-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5 sm:px-4">
            <div>
              <p className="stat-label">Game-by-Game Trend Log</p>
              <p className="text-sm text-foreground/90">
                Recent final games for {selectedTeam.name} with per-game efficiency and shot profile.
              </p>
            </div>
            <span className="stat-value text-xs text-muted">{selectedGames.length} rows</span>
          </div>

          <div className="table-scroll overflow-x-auto">
            <table className="dense-table table-sticky min-w-[1250px] text-left">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Site</th>
                  <th>Opponent</th>
                  <th>Result</th>
                  <th>OE</th>
                  <th>DE</th>
                  <th>Net</th>
                  <th>eFG%</th>
                  <th>Opp eFG%</th>
                  <th>TOV%</th>
                  <th>ORB%</th>
                  <th>FTR</th>
                  <th>Poss</th>
                  <th>Game</th>
                </tr>
              </thead>
              <tbody>
                {selectedGames.map((game) => (
                  <tr key={`${game.teamId}-${game.gameId}`}>
                    <td className="table-number">{formatDate(game.date)}</td>
                    <td>
                      <span className="rounded border border-line bg-panel px-1.5 py-0.5 text-xs text-muted">
                        {game.isHome ? "H" : "A"}
                      </span>
                    </td>
                    <td>
                      {game.oppSlug ? (
                        <Link
                          href={`/teams/${game.oppSlug}`}
                          prefetch={false}
                          className="font-medium text-foreground hover:text-accent"
                        >
                          {game.oppName ?? "Opponent"}
                        </Link>
                      ) : (
                        <span className="text-foreground/90">{game.oppName ?? "Opponent"}</span>
                      )}
                      {game.oppConference ? (
                        <span className="ml-2 text-[10px] text-muted">{game.oppConference}</span>
                      ) : null}
                    </td>
                    <td
                      className={`table-number font-medium ${
                        formatResult(game).startsWith("W ")
                          ? "text-accent-2"
                          : formatResult(game).startsWith("L ")
                            ? "text-danger"
                            : "text-foreground"
                      }`}
                    >
                      {formatResult(game)}
                    </td>
                    <td className="table-number">{fmt(game.oe)}</td>
                    <td className="table-number">{fmt(game.de)}</td>
                    <td
                      className={`table-number font-medium ${
                        (game.net ?? 0) >= 0 ? "text-accent-2" : "text-danger"
                      }`}
                    >
                      {fmt(game.net)}
                    </td>
                    <td className="table-number">{fmt(game.efg)}</td>
                    <td className="table-number">{fmt(game.oppEfg)}</td>
                    <td className="table-number">{fmt(game.tovPct)}</td>
                    <td className="table-number">{fmt(game.orbPct)}</td>
                    <td className="table-number">{fmt(game.ftRate)}</td>
                    <td className="table-number">{fmt(game.possessions)}</td>
                    <td>
                      <Link
                        href={`/games/${game.gameId}`}
                        prefetch={false}
                        className="rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-foreground/90 hover:border-accent/40 hover:text-accent"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
