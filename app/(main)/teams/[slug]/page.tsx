import Link from "next/link";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db/client";
import { games, playerGameStats, players, teamGameStats, teams } from "@/db/schema";
import { isFinalStatus } from "@/lib/data/status";
import { resolveDbEnv } from "@/lib/runtime/env";

export const runtime = "edge";

type TeamPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ scope?: string }>;
};

type TeamScope = "all" | "b1g";

type TeamGameEfficiencySample = {
  oppTeamId: number | null;
  offEff: number;
  defEff: number;
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

function parseScope(scope: string | undefined): TeamScope {
  return scope === "b1g" ? "b1g" : "all";
}

function computePrpgProxy(row: {
  gp: number;
  points: number;
  ast: number;
  reb: number;
  stl: number;
  blk: number;
  tov: number;
  fga: number;
  fgm: number;
  fta: number;
  ftm: number;
}) {
  if (row.gp <= 0) {
    return 0;
  }
  const missedFg = Math.max(0, row.fga - row.fgm);
  const missedFt = Math.max(0, row.fta - row.ftm);
  const productionValue =
    row.points +
    row.ast * 1.25 +
    row.reb * 0.7 +
    row.stl * 1.6 +
    row.blk * 1.4 -
    row.tov * 1.2 -
    missedFg * 0.45 -
    missedFt * 0.3;
  return productionValue / row.gp;
}

function computeTeamGameScore(stats: {
  points: number | null;
  fgm: number | null;
  fga: number | null;
  ftm: number | null;
  fta: number | null;
  oreb: number | null;
  dreb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  pf: number | null;
}) {
  const pts = stats.points ?? 0;
  const fgm = stats.fgm ?? 0;
  const fga = stats.fga ?? 0;
  const ftm = stats.ftm ?? 0;
  const fta = stats.fta ?? 0;
  const oreb = stats.oreb ?? 0;
  const dreb = stats.dreb ?? 0;
  const ast = stats.ast ?? 0;
  const stl = stats.stl ?? 0;
  const blk = stats.blk ?? 0;
  const tov = stats.tov ?? 0;
  const pf = stats.pf ?? 0;

  const raw =
    pts +
    0.4 * fgm -
    0.7 * fga -
    0.4 * (fta - ftm) +
    0.7 * oreb +
    0.3 * dreb +
    stl +
    0.7 * ast +
    0.7 * blk -
    0.4 * pf -
    tov;

  return Math.max(0, raw * 1.6);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
      nextOff.set(teamId, 0.9 * rawAdjOff + 0.1 * leagueBaseline);
      nextDef.set(teamId, 0.9 * rawAdjDef + 0.1 * leagueBaseline);
    }

    offRatings.clear();
    defRatings.clear();
    for (const [teamId, value] of nextOff) offRatings.set(teamId, value);
    for (const [teamId, value] of nextDef) defRatings.set(teamId, value);
  }

  return { offRatings, defRatings };
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0] ?? null;
  const clamped = Math.min(1, Math.max(0, p));
  const index = (sorted.length - 1) * clamped;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? 0;
  if (lower === upper) return lowerValue;
  const weight = index - lower;
  return lowerValue + (upperValue - lowerValue) * weight;
}

export default async function TeamPage({ params, searchParams }: TeamPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const scope = parseScope(resolvedSearchParams.scope);
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
      homeConference: homeTeam.conference,
      awayConference: awayTeam.conference,
    })
    .from(games)
    .innerJoin(homeTeam, eq(games.homeTeamId, homeTeam.id))
    .innerJoin(awayTeam, eq(games.awayTeamId, awayTeam.id))
    .where(or(eq(games.homeTeamId, team.id), eq(games.awayTeamId, team.id)))
    .orderBy(desc(games.date), desc(games.id));

  const scopedSchedule = schedule.filter((game) => {
    if (scope !== "b1g") {
      return true;
    }
    return game.homeConference === "Big Ten" && game.awayConference === "Big Ten";
  });

  const scheduleGameIds = scopedSchedule.map((game) => game.id);
  const statRows =
    scheduleGameIds.length > 0
      ? await db
          .select({
            gameId: teamGameStats.gameId,
            teamId: teamGameStats.teamId,
            points: teamGameStats.points,
            fgm: teamGameStats.fgm,
            fga: teamGameStats.fga,
            ftm: teamGameStats.ftm,
            fta: teamGameStats.fta,
            oreb: teamGameStats.oreb,
            dreb: teamGameStats.dreb,
            ast: teamGameStats.ast,
            stl: teamGameStats.stl,
            blk: teamGameStats.blk,
            tov: teamGameStats.tov,
            pf: teamGameStats.pf,
          })
          .from(teamGameStats)
          .where(inArray(teamGameStats.gameId, scheduleGameIds))
      : [];

  const pointsByGameTeam = new Map<string, number | null>();
  const gameScoreByGameTeam = new Map<string, number | null>();
  for (const row of statRows) {
    if (row.gameId === null || row.teamId === null) {
      continue;
    }
    const key = `${row.gameId}:${row.teamId}`;
    pointsByGameTeam.set(key, row.points ?? null);

    const hasBoxscoreStats =
      row.points !== null ||
      row.fgm !== null ||
      row.fga !== null ||
      row.ftm !== null ||
      row.fta !== null ||
      row.oreb !== null ||
      row.dreb !== null ||
      row.ast !== null ||
      row.stl !== null ||
      row.blk !== null ||
      row.tov !== null ||
      row.pf !== null;

    gameScoreByGameTeam.set(key, hasBoxscoreStats ? computeTeamGameScore(row) : null);
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

  const currentSeason =
    schedule.reduce((max, game) => Math.max(max, game.season ?? 0), 0) || null;

  const gsOppTeams = alias(teams, "gs_opp_team");
  const gsOppStats = alias(teamGameStats, "gs_opp_stats");
  const b1gNetSamplesRows =
    currentSeason !== null
      ? await db
          .select({
            teamId: teamGameStats.teamId,
            oppTeamId: teamGameStats.oppTeamId,
            oppConference: gsOppTeams.conference,
            points: teamGameStats.points,
            oppPoints: gsOppStats.points,
            possessionsEst: teamGameStats.possessionsEst,
          })
          .from(teamGameStats)
          .innerJoin(games, eq(teamGameStats.gameId, games.id))
          .innerJoin(teams, eq(teamGameStats.teamId, teams.id))
          .leftJoin(gsOppTeams, eq(teamGameStats.oppTeamId, gsOppTeams.id))
          .leftJoin(
            gsOppStats,
            and(eq(gsOppStats.gameId, teamGameStats.gameId), eq(gsOppStats.teamId, teamGameStats.oppTeamId)),
          )
          .where(
            and(
              eq(games.season, currentSeason),
              eq(teams.conference, "Big Ten"),
              sql`lower(coalesce(${games.status}, '')) like 'final%'`,
              scope === "b1g" ? eq(gsOppTeams.conference, "Big Ten") : sql`1 = 1`,
            ),
          )
      : [];

  const b1gNetTeamIds = new Set<number>();
  const b1gNetSamplesByTeamId = new Map<number, TeamGameEfficiencySample[]>();
  for (const row of b1gNetSamplesRows) {
    if (
      row.teamId === null ||
      row.points === null ||
      row.oppPoints === null ||
      row.possessionsEst === null ||
      row.possessionsEst <= 0
    ) {
      continue;
    }

    b1gNetTeamIds.add(row.teamId);
    const bucket = b1gNetSamplesByTeamId.get(row.teamId) ?? [];
    bucket.push({
      oppTeamId: row.oppConference === "Big Ten" ? row.oppTeamId : null,
      offEff: (row.points / row.possessionsEst) * 100,
      defEff: (row.oppPoints / row.possessionsEst) * 100,
    });
    b1gNetSamplesByTeamId.set(row.teamId, bucket);
  }

  const b1gNetByTeamId = new Map<number, number>();
  if (b1gNetTeamIds.size > 0) {
    const { offRatings, defRatings } = computeOpponentAdjustedEfficiencies({
      teamIds: [...b1gNetTeamIds],
      samplesByTeamId: b1gNetSamplesByTeamId,
    });
    for (const teamId of b1gNetTeamIds) {
      const off = offRatings.get(teamId);
      const def = defRatings.get(teamId);
      if (off !== undefined && def !== undefined) {
        b1gNetByTeamId.set(teamId, off - def);
      }
    }
  }

  const scopedOpponentIds = new Set<number>();
  for (const game of scopedSchedule) {
    if (game.homeTeamId !== null && game.homeTeamId !== team.id) {
      scopedOpponentIds.add(game.homeTeamId);
    }
    if (game.awayTeamId !== null && game.awayTeamId !== team.id) {
      scopedOpponentIds.add(game.awayTeamId);
    }
  }

  const seasonRecordGames =
    currentSeason !== null && scopedOpponentIds.size > 0
      ? await db
          .select({
            homeTeamId: games.homeTeamId,
            awayTeamId: games.awayTeamId,
            homeScore: games.homeScore,
            awayScore: games.awayScore,
            status: games.status,
            homeConference: homeTeam.conference,
            awayConference: awayTeam.conference,
          })
          .from(games)
          .innerJoin(homeTeam, eq(games.homeTeamId, homeTeam.id))
          .innerJoin(awayTeam, eq(games.awayTeamId, awayTeam.id))
          .where(
            sql`${games.season} = ${currentSeason} and (${games.homeTeamId} in (${sql.join(
              [...scopedOpponentIds].map((id) => sql`${id}`),
              sql`, `,
            )}) or ${games.awayTeamId} in (${sql.join(
              [...scopedOpponentIds].map((id) => sql`${id}`),
              sql`, `,
            )}))`,
          )
      : [];

  const opponentRecordByTeamId = new Map<number, { wins: number; losses: number }>();
  for (const row of seasonRecordGames) {
    if (
      row.homeTeamId === null ||
      row.awayTeamId === null ||
      row.homeScore === null ||
      row.awayScore === null ||
      !isFinalStatus(row.status)
    ) {
      continue;
    }
    if (
      scope === "b1g" &&
      !(row.homeConference === "Big Ten" && row.awayConference === "Big Ten")
    ) {
      continue;
    }

    const homeBucket = opponentRecordByTeamId.get(row.homeTeamId) ?? { wins: 0, losses: 0 };
    const awayBucket = opponentRecordByTeamId.get(row.awayTeamId) ?? { wins: 0, losses: 0 };

    if (row.homeScore > row.awayScore) {
      homeBucket.wins += 1;
      awayBucket.losses += 1;
    } else if (row.awayScore > row.homeScore) {
      awayBucket.wins += 1;
      homeBucket.losses += 1;
    }

    opponentRecordByTeamId.set(row.homeTeamId, homeBucket);
    opponentRecordByTeamId.set(row.awayTeamId, awayBucket);
  }

  const compositeGsByGameId = new Map<number, number | null>();
  for (const game of scopedSchedule) {
    const baseGs = gameScoreByGameTeam.get(`${game.id}:${team.id}`) ?? null;
    if (baseGs === null) {
      compositeGsByGameId.set(game.id, null);
      continue;
    }

    const resolvedScores = resolveGameScores(game);
    const isHome = game.homeTeamId === team.id;
    const oppTeamId = isHome ? game.awayTeamId : game.homeTeamId;

    let marginAdj = 0;
    if (resolvedScores.homeScore !== null && resolvedScores.awayScore !== null) {
      const pointsFor = isHome ? resolvedScores.homeScore : resolvedScores.awayScore;
      const pointsAgainst = isHome ? resolvedScores.awayScore : resolvedScores.homeScore;
      marginAdj = clamp((pointsFor - pointsAgainst) * 0.45, -18, 18);
    }

    let oppStrengthAdj = 0;
    if (oppTeamId !== null) {
      const oppNet = b1gNetByTeamId.get(oppTeamId);
      if (oppNet !== undefined) {
        oppStrengthAdj = clamp(oppNet * 0.35, -12, 12);
      } else {
        const oppRecord = opponentRecordByTeamId.get(oppTeamId);
        const oppGames = (oppRecord?.wins ?? 0) + (oppRecord?.losses ?? 0);
        const oppWinPct = oppGames > 0 ? (oppRecord?.wins ?? 0) / oppGames : 0.5;
        oppStrengthAdj = (oppWinPct - 0.5) * 8;
      }
    }

    const venueAdj = isHome ? 0 : 1.2;
    compositeGsByGameId.set(game.id, Math.max(0, baseGs + marginAdj + oppStrengthAdj + venueAdj));
  }

  const scopedGsValues = scopedSchedule
    .map((game) => compositeGsByGameId.get(game.id) ?? null)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const gsLowCut = percentile(scopedGsValues, 1 / 3);
  const gsHighCut = percentile(scopedGsValues, 2 / 3);

  function gsToneClass(value: number | null) {
    if (value === null || gsLowCut === null || gsHighCut === null) {
      return "text-muted";
    }
    if (value >= gsHighCut) {
      return "text-accent-2";
    }
    if (value <= gsLowCut) {
      return "text-danger";
    }
    return "text-foreground/90";
  }

  let finalGamesCount = 0;
  let totalPointsFor = 0;
  let totalPointsAgainst = 0;
  let wins = 0;
  let losses = 0;

  for (const game of scopedSchedule) {
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

  const finalizedScopedGameIds = scopedSchedule
    .filter((game) => isFinalStatus(game.status))
    .map((game) => game.id);
  const possessionsSummary =
    finalizedScopedGameIds.length > 0
      ? await db
          .select({
            avgPossessions: sql<number>`avg(${teamGameStats.possessionsEst})`,
          })
          .from(teamGameStats)
          .where(
            sql`${teamGameStats.teamId} = ${team.id} and ${teamGameStats.gameId} in (${sql.join(
              finalizedScopedGameIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
      : [];
  const avgPossessions = possessionsSummary[0]?.avgPossessions ?? null;

  const futureGames = scopedSchedule.filter((game) => !isFinalStatus(game.status)).length;
  const scopedSeasonFinalGameIds =
    currentSeason !== null
      ? scopedSchedule
          .filter((game) => game.season === currentSeason && isFinalStatus(game.status))
          .map((game) => game.id)
      : [];

  const playerStatRows =
    scopedSeasonFinalGameIds.length > 0
      ? await db
          .select({
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
          .leftJoin(players, eq(playerGameStats.playerId, players.id))
          .where(
            sql`${playerGameStats.teamId} = ${team.id} and ${playerGameStats.gameId} in (${sql.join(
              scopedSeasonFinalGameIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
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
      const aPrpg = computePrpgProxy(a);
      const bPrpg = computePrpgProxy(b);
      if (aPrpg !== bPrpg) {
        return bPrpg - aPrpg;
      }
      const aPpg = a.gp > 0 ? a.points / a.gp : 0;
      const bPpg = b.gp > 0 ? b.points / b.gp : 0;
      if (aPpg !== bPpg) return bPpg - aPpg;
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

      <div className="flex flex-wrap items-center gap-2">
        <span className="stat-label">Scope</span>
        <Link
          href={`/teams/${team.slug}?scope=all`}
          prefetch={false}
          className={[
            "rounded-md border px-3 py-1.5 text-sm font-semibold tracking-wide",
            scope === "all"
              ? "border-accent/70 bg-accent/10 text-accent"
              : "border-line bg-panel/70 text-foreground/90 hover:border-accent/40 hover:text-accent",
          ].join(" ")}
        >
          All Games
        </Link>
        <Link
          href={`/teams/${team.slug}?scope=b1g`}
          prefetch={false}
          className={[
            "rounded-md border px-3 py-1.5 text-sm font-semibold tracking-wide",
            scope === "b1g"
              ? "border-accent/70 bg-accent/10 text-accent"
              : "border-line bg-panel/70 text-foreground/90 hover:border-accent/40 hover:text-accent",
          ].join(" ")}
        >
          B1G Only
        </Link>
        <span className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted">
          Current: {scope === "b1g" ? "B1G games only" : "All games"}
        </span>
      </div>

      {scopedSchedule.length === 0 ? (
        <div className="data-panel rounded-xl p-4 text-sm text-muted">
          No games found yet. Run ingest via{" "}
          <code className="rounded bg-panel px-1 py-0.5 text-foreground/90">/api/ingest</code>.
        </div>
      ) : (
        <div className="data-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5 sm:px-4">
            <div>
              <p className="stat-label">Schedule & Results</p>
              <p className="text-sm text-foreground/90">
                {scope === "b1g"
                  ? "Big Ten conference games only"
                  : "All games for this team (B1G + OOC)"}
              </p>
            </div>
            <span className="stat-value text-xs text-muted">{scopedSchedule.length} games</span>
          </div>

          <div className="table-scroll overflow-x-auto">
            <table className="dense-table table-sticky min-w-full text-left">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Site</th>
                  <th>Opponent</th>
                  <th>Result</th>
                  <th>GS</th>
                  <th>Venue</th>
                  <th>Game</th>
                </tr>
              </thead>
              <tbody>
                {scopedSchedule.map((game) => {
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
                  const gameScore = compositeGsByGameId.get(game.id) ?? null;
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
                      <td className={["table-number font-medium", gsToneClass(gameScore)].join(" ")}>
                        {gameScore !== null ? gameScore.toFixed(1) : "-"}
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
          <div className="border-t border-line px-3 py-2 text-[11px] text-muted sm:px-4">
            GS blends boxscore production with scoring margin and a B1G NET-style opponent adjustment (AdjOE* - AdjDE* for B1G opponents in the current season/scope; neutral/fallback proxy for OOC).
          </div>
        </div>
      )}

      <div className="data-panel overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5 sm:px-4">
          <div>
            <p className="stat-label">Player Stats</p>
            <p className="text-sm text-foreground/90">
              {currentSeason ? `Season ${currentSeason}` : "Season totals"}{" "}
              {scope === "b1g" ? "B1G-only" : "all-games"} player production, shooting splits, and Impact+
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
                  <th>Impact+</th>
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
                    <td className="table-number">{computePrpgProxy(row).toFixed(1)}</td>
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
        <div className="border-t border-line px-3 py-2 text-[11px] text-muted sm:px-4">
          Impact+ is a boxscore-derived per-game value proxy (scoring + playmaking + rebounds + defense, with turnover/missed-shot penalties).
        </div>
      </div>
    </section>
  );
}
