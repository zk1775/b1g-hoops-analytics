import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { games, teamGameStats, teams } from "@/db/schema";
import { getB1GTeamBySlug, slugifyTeamName } from "@/lib/data/b1gTeams";
import type {
  NormalizedBoxscoreTeam,
  NormalizedGameBoxscore,
  NormalizedScheduleGame,
  NormalizedTeamRef,
} from "@/lib/data/sources/espn";

type Db = ReturnType<typeof getDb>;

export type UpsertCounts = {
  teamsInserted: number;
  teamsUpdated: number;
  gamesInserted: number;
  gamesUpdated: number;
  statsInserted: number;
  statsUpdated: number;
};

export type TeamIdMap = Map<string, number>;

function emptyCounts(): UpsertCounts {
  return {
    teamsInserted: 0,
    teamsUpdated: 0,
    gamesInserted: 0,
    gamesUpdated: 0,
    statsInserted: 0,
    statsUpdated: 0,
  };
}

function normalizeSlug(team: NormalizedTeamRef) {
  return team.slug?.trim() ? team.slug : slugifyTeamName(team.name || team.shortName || "team");
}

async function ensureTeam(db: Db, team: NormalizedTeamRef) {
  const slug = normalizeSlug(team);
  const known = getB1GTeamBySlug(slug);
  const values = {
    slug,
    name: team.name,
    shortName: known?.shortName ?? team.shortName ?? team.name,
    conference: known ? "Big Ten" : null,
    logoUrl: team.logoUrl,
  } as const;

  const existing = await db
    .select({ id: teams.id })
    .from(teams)
    .where(or(eq(teams.slug, slug), eq(teams.name, team.name)))
    .limit(1);

  if (existing[0]) {
    await db.update(teams).set(values).where(eq(teams.id, existing[0].id));
    return { id: existing[0].id, inserted: false };
  }

  const inserted = await db.insert(teams).values(values).returning({ id: teams.id });
  if (inserted[0]) {
    return { id: inserted[0].id, inserted: true };
  }

  const fallback = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.slug, slug))
    .limit(1);

  if (!fallback[0]) {
    throw new Error(`Failed to upsert team ${team.name} (${slug})`);
  }
  return { id: fallback[0].id, inserted: false };
}

function addPossessionsEstimate(
  team: Partial<NormalizedBoxscoreTeam["stats"]>,
  opponent: Partial<NormalizedBoxscoreTeam["stats"]>,
) {
  const teamFga = team.fga ?? 0;
  const teamFta = team.fta ?? 0;
  const teamOreb = team.oreb ?? 0;
  const teamTov = team.tov ?? 0;
  const oppFga = opponent.fga ?? 0;
  const oppFta = opponent.fta ?? 0;
  const oppOreb = opponent.oreb ?? 0;
  const oppTov = opponent.tov ?? 0;

  const estimate =
    0.5 * ((teamFga + 0.44 * teamFta - teamOreb + oppTov) + (oppFga + 0.44 * oppFta - oppOreb + teamTov));
  return Number.isFinite(estimate) ? estimate : null;
}

export async function upsertTeamsFromSchedule(db: Db, scheduleGames: NormalizedScheduleGame[]) {
  const counts = emptyCounts();
  const teamIdBySlug: TeamIdMap = new Map();

  const seen = new Map<string, NormalizedTeamRef>();
  for (const game of scheduleGames) {
    seen.set(normalizeSlug(game.homeTeam), game.homeTeam);
    seen.set(normalizeSlug(game.awayTeam), game.awayTeam);
  }

  for (const team of seen.values()) {
    const result = await ensureTeam(db, team);
    teamIdBySlug.set(normalizeSlug(team), result.id);
    if (result.inserted) {
      counts.teamsInserted += 1;
    } else {
      counts.teamsUpdated += 1;
    }
  }

  return { teamIdBySlug, counts };
}

export async function upsertGame(db: Db, game: NormalizedScheduleGame, teamIdBySlug: TeamIdMap) {
  const homeSlug = normalizeSlug(game.homeTeam);
  const awaySlug = normalizeSlug(game.awayTeam);

  let homeTeamId = teamIdBySlug.get(homeSlug);
  let awayTeamId = teamIdBySlug.get(awaySlug);

  if (!homeTeamId) {
    const ensured = await ensureTeam(db, game.homeTeam);
    homeTeamId = ensured.id;
    teamIdBySlug.set(homeSlug, homeTeamId);
  }
  if (!awayTeamId) {
    const ensured = await ensureTeam(db, game.awayTeam);
    awayTeamId = ensured.id;
    teamIdBySlug.set(awaySlug, awayTeamId);
  }

  if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) {
    throw new Error(`Invalid team mapping for game ${game.externalId}`);
  }

  const values = {
    externalId: game.externalId,
    season: game.season,
    date: game.date,
    status: game.status,
    neutralSite: game.neutralSite,
    venue: game.venue,
    homeTeamId,
    awayTeamId,
    homeScore: game.homeTeam.score,
    awayScore: game.awayTeam.score,
  } as const;

  const existing = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.externalId, game.externalId))
    .limit(1);

  if (existing[0]) {
    await db.update(games).set(values).where(eq(games.id, existing[0].id));
    return { gameId: existing[0].id, inserted: false, updated: true };
  }

  const inserted = await db.insert(games).values(values).returning({ id: games.id });
  if (inserted[0]) {
    return { gameId: inserted[0].id, inserted: true, updated: false };
  }

  const fallback = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.externalId, game.externalId))
    .limit(1);
  if (!fallback[0]) {
    throw new Error(`Failed to upsert game ${game.externalId}`);
  }
  return { gameId: fallback[0].id, inserted: false, updated: true };
}

export async function upsertTeamGameStats(
  db: Db,
  params: {
    gameId: number;
    teamIdBySlug: TeamIdMap;
    boxscore: NormalizedGameBoxscore;
  },
) {
  const counts = { inserted: 0, updated: 0 };
  const bySlug = new Map<string, NormalizedBoxscoreTeam>();

  for (const entry of params.boxscore.teams) {
    bySlug.set(normalizeSlug(entry.team), entry);
  }

  for (const entry of params.boxscore.teams) {
    const teamSlug = normalizeSlug(entry.team);
    const teamId = params.teamIdBySlug.get(teamSlug);
    if (!teamId) {
      continue;
    }

    const opponent = [...bySlug.values()].find(
      (candidate) => normalizeSlug(candidate.team) !== teamSlug,
    );
    const opponentId = opponent
      ? params.teamIdBySlug.get(normalizeSlug(opponent.team)) ?? null
      : null;

    const possessions =
      entry.stats.possessionsEst ??
      (opponent ? addPossessionsEstimate(entry.stats, opponent.stats) : null);

    const values = {
      gameId: params.gameId,
      teamId,
      oppTeamId: opponentId,
      isHome: entry.isHome,
      points: entry.stats.points ?? entry.team.score,
      fgm: entry.stats.fgm ?? null,
      fga: entry.stats.fga ?? null,
      fg3m: entry.stats.fg3m ?? entry.stats.tpm ?? null,
      fg3a: entry.stats.fg3a ?? entry.stats.tpa ?? null,
      tpm: entry.stats.tpm ?? entry.stats.fg3m ?? null,
      tpa: entry.stats.tpa ?? entry.stats.fg3a ?? null,
      ftm: entry.stats.ftm ?? null,
      fta: entry.stats.fta ?? null,
      oreb: entry.stats.oreb ?? null,
      dreb: entry.stats.dreb ?? null,
      reb: entry.stats.reb ?? null,
      ast: entry.stats.ast ?? null,
      stl: entry.stats.stl ?? null,
      blk: entry.stats.blk ?? null,
      tov: entry.stats.tov ?? null,
      pf: entry.stats.pf ?? null,
      possessionsEst: possessions,
    } as const;

    const existing = await db
      .select({ id: teamGameStats.id })
      .from(teamGameStats)
      .where(and(eq(teamGameStats.gameId, params.gameId), eq(teamGameStats.teamId, teamId)))
      .limit(1);

    if (existing[0]) {
      await db.update(teamGameStats).set(values).where(eq(teamGameStats.id, existing[0].id));
      counts.updated += 1;
    } else {
      await db.insert(teamGameStats).values(values);
      counts.inserted += 1;
    }
  }

  return counts;
}
