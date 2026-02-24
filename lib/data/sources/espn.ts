import { getB1GTeamBySlug, normalizeToKnownB1GSlug, slugifyTeamName } from "@/lib/data/b1gTeams";

const SPORT_PATH = "basketball/mens-college-basketball";
const TEAMS_ENDPOINT = `https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATH}/teams`;
const TEAM_SCHEDULE_ENDPOINT = `https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATH}/teams`;
const SCOREBOARD_ENDPOINT = `https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATH}/scoreboard`;
const SUMMARY_ENDPOINT = `https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATH}/summary`;

export type NormalizedTeamStats = {
  points?: number | null;
  fgm?: number | null;
  fga?: number | null;
  fg3m?: number | null;
  fg3a?: number | null;
  tpm?: number | null;
  tpa?: number | null;
  ftm?: number | null;
  fta?: number | null;
  oreb?: number | null;
  dreb?: number | null;
  reb?: number | null;
  ast?: number | null;
  stl?: number | null;
  blk?: number | null;
  tov?: number | null;
  pf?: number | null;
  possessionsEst?: number | null;
};

export type NormalizedTeamRef = {
  espnTeamId: string | null;
  slug: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  score: number | null;
};

export type NormalizedScheduleGame = {
  externalId: string;
  season: number | null;
  date: number | null;
  status: string;
  neutralSite: boolean | null;
  venue: string | null;
  homeTeam: NormalizedTeamRef;
  awayTeam: NormalizedTeamRef;
  teamEspnId: string | null;
  opponentEspnId: string | null;
  isHome: boolean | null;
  recapUrl: string | null;
  boxscoreUrl: string | null;
};

export type NormalizedBoxscoreTeam = {
  team: NormalizedTeamRef;
  isHome: boolean | null;
  stats: NormalizedTeamStats;
};

export type NormalizedGameBoxscore = {
  externalId: string;
  season: number | null;
  date: number | null;
  status: string;
  homeTeam: NormalizedTeamRef | null;
  awayTeam: NormalizedTeamRef | null;
  teams: NormalizedBoxscoreTeam[];
  players: NormalizedPlayerGameStat[];
};

export type NormalizedPlayerGameStat = {
  espnAthleteId: string;
  team: NormalizedTeamRef;
  isHome: boolean | null;
  name: string;
  shortName: string | null;
  jersey: string | null;
  position: string | null;
  headshotUrl: string | null;
  active: boolean | null;
  starter: boolean | null;
  didNotPlay: boolean | null;
  minutes: string | null;
  minutesDecimal: number | null;
  points: number | null;
  fgm: number | null;
  fga: number | null;
  fg3m: number | null;
  fg3a: number | null;
  ftm: number | null;
  fta: number | null;
  reb: number | null;
  ast: number | null;
  tov: number | null;
  stl: number | null;
  blk: number | null;
  oreb: number | null;
  dreb: number | null;
  pf: number | null;
};

export type EspnConferenceTeam = {
  espnTeamId: string;
  slug: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
};

type EspnTeamLike = {
  id?: string | number;
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
  logo?: string;
  logos?: Array<{ href?: string }>;
};

type EspnCompetitor = {
  homeAway?: "home" | "away";
  score?: string | number;
  team?: EspnTeamLike;
};

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function toFloat(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toEpochSeconds(value: unknown): number | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return null;
  }
  return Math.floor(ms / 1000);
}

function extractLink(
  links: Array<{ href?: string; text?: string; rel?: string[] }> | undefined,
  matcher: (text: string) => boolean,
) {
  if (!links?.length) {
    return null;
  }
  for (const link of links) {
    const text = `${link.text ?? ""} ${(link.rel ?? []).join(" ")}`.toLowerCase();
    if (matcher(text) && link.href) {
      return link.href;
    }
  }
  return null;
}

function parseMadeAttempt(value: string | undefined) {
  if (!value) {
    return { made: null, attempts: null };
  }
  const [madeRaw, attemptsRaw] = value.split("-");
  return {
    made: toInt(madeRaw),
    attempts: toInt(attemptsRaw),
  };
}

function parseMinutesDecimal(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "--") {
    return null;
  }
  if (trimmed.includes(":")) {
    const [minRaw, secRaw] = trimmed.split(":");
    const mins = toInt(minRaw);
    const secs = toInt(secRaw);
    if (mins === null || secs === null) {
      return null;
    }
    return mins + secs / 60;
  }
  return toFloat(trimmed);
}

function statDisplayValue(
  stats: Array<{ name?: string; displayValue?: string; value?: string }> | undefined,
  names: string[],
) {
  if (!stats?.length) {
    return undefined;
  }
  for (const name of names) {
    const hit = stats.find((row) => row.name === name);
    if (!hit) {
      continue;
    }
    if (typeof hit.displayValue === "string") {
      return hit.displayValue;
    }
    if (typeof hit.value === "string") {
      return hit.value;
    }
  }
  return undefined;
}

function normalizeTeamToSlug(team: EspnTeamLike | undefined) {
  if (!team) {
    return "unknown-team";
  }
  const knownSlug = normalizeToKnownB1GSlug(
    team.displayName,
    team.shortDisplayName,
    team.abbreviation,
  );
  if (knownSlug) {
    return knownSlug;
  }

  const fallback = team.shortDisplayName ?? team.displayName ?? team.abbreviation ?? "unknown-team";
  return slugifyTeamName(fallback);
}

function parseTeamRef(competitor: EspnCompetitor | undefined): NormalizedTeamRef | null {
  if (!competitor?.team) {
    return null;
  }

  const slug = normalizeTeamToSlug(competitor.team);
  const knownTeam = getB1GTeamBySlug(slug);
  const name = competitor.team.displayName ?? knownTeam?.name ?? slug;
  const shortName =
    competitor.team.shortDisplayName ??
    competitor.team.abbreviation ??
    knownTeam?.shortName ??
    name;

  return {
    espnTeamId:
      typeof competitor.team.id === "string" || typeof competitor.team.id === "number"
        ? String(competitor.team.id)
        : null,
    slug,
    name,
    shortName,
    logoUrl: competitor.team.logo ?? competitor.team.logos?.[0]?.href ?? null,
    score: toInt(competitor.score),
  };
}

function parseGameFromCompetition(
  event: {
    id?: string;
    date?: string;
    season?: { year?: number };
    links?: Array<{ href?: string; text?: string; rel?: string[] }>;
  },
  competition:
    | {
        date?: string;
        status?: { type?: { shortDetail?: string; description?: string; name?: string } };
        neutralSite?: boolean;
        venue?: { fullName?: string };
        competitors?: EspnCompetitor[];
      }
    | undefined,
  teamEspnId?: string,
): NormalizedScheduleGame | null {
  if (!event.id) {
    return null;
  }

  const competitors = competition?.competitors ?? [];
  const homeCompetitor = competitors.find((entry) => entry.homeAway === "home") ?? competitors[0];
  const awayCompetitor =
    competitors.find((entry) => entry.homeAway === "away") ?? competitors[1] ?? null;

  const homeTeam = parseTeamRef(homeCompetitor);
  const awayTeam = parseTeamRef(awayCompetitor ?? undefined);
  if (!homeTeam || !awayTeam) {
    return null;
  }

  let isHome: boolean | null = null;
  let opponentEspnId: string | null = null;
  if (teamEspnId) {
    if (homeTeam.espnTeamId === teamEspnId) {
      isHome = true;
      opponentEspnId = awayTeam.espnTeamId;
    } else if (awayTeam.espnTeamId === teamEspnId) {
      isHome = false;
      opponentEspnId = homeTeam.espnTeamId;
    }
  }

  const status =
    competition?.status?.type?.shortDetail ??
    competition?.status?.type?.description ??
    competition?.status?.type?.name ??
    "Scheduled";

  return {
    externalId: event.id,
    season: toInt(event.season?.year),
    date: toEpochSeconds(competition?.date ?? event.date),
    status,
    neutralSite: typeof competition?.neutralSite === "boolean" ? competition.neutralSite : null,
    venue: competition?.venue?.fullName ?? null,
    homeTeam,
    awayTeam,
    teamEspnId: teamEspnId ?? null,
    opponentEspnId,
    isHome,
    recapUrl: extractLink(event.links, (text) => text.includes("recap")),
    boxscoreUrl: extractLink(event.links, (text) => text.includes("box")),
  };
}

function parseStatLine(
  stats: Array<{ name?: string; displayValue?: string; value?: string }> | undefined,
): NormalizedTeamStats {
  const fg = parseMadeAttempt(
    statDisplayValue(stats, [
      "fieldGoalsMade-fieldGoalsAttempted",
      "fieldGoals",
      "fg",
    ]),
  );
  const threePoint = parseMadeAttempt(
    statDisplayValue(stats, [
      "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
      "threePointFieldGoals",
      "threePointersMade-threePointersAttempted",
      "3ptFieldGoals",
      "threePointers",
    ]),
  );
  const ft = parseMadeAttempt(
    statDisplayValue(stats, [
      "freeThrowsMade-freeThrowsAttempted",
      "freeThrows",
      "ft",
    ]),
  );

  const parsedPoints = toInt(statDisplayValue(stats, ["points"]));
  const derivedPoints =
    fg.made !== null && threePoint.made !== null && ft.made !== null
      ? 2 * fg.made + threePoint.made + ft.made
      : null;

  return {
    points: parsedPoints ?? derivedPoints,
    fgm: fg.made,
    fga: fg.attempts,
    fg3m: threePoint.made,
    fg3a: threePoint.attempts,
    tpm: threePoint.made,
    tpa: threePoint.attempts,
    ftm: ft.made,
    fta: ft.attempts,
    oreb: toInt(statDisplayValue(stats, ["offensiveRebounds"])),
    dreb: toInt(statDisplayValue(stats, ["defensiveRebounds"])),
    reb: toInt(statDisplayValue(stats, ["rebounds", "totalRebounds"])),
    ast: toInt(statDisplayValue(stats, ["assists"])),
    stl: toInt(statDisplayValue(stats, ["steals"])),
    blk: toInt(statDisplayValue(stats, ["blocks"])),
    tov: toInt(statDisplayValue(stats, ["turnovers"])),
    pf: toInt(statDisplayValue(stats, ["totalFouls", "fouls"])),
    possessionsEst: toFloat(statDisplayValue(stats, ["possessions", "estimatedPossessions"])),
  };
}

function parsePlayerStatSection(
  teamRow: {
    team?: EspnTeamLike;
    statistics?: Array<{
      labels?: string[];
      athletes?: Array<{
        active?: boolean;
        starter?: boolean;
        didNotPlay?: boolean;
        athlete?: {
          id?: string | number;
          displayName?: string;
          shortName?: string;
          jersey?: string;
          position?: { abbreviation?: string; displayName?: string; name?: string };
          headshot?: { href?: string };
        };
        stats?: string[];
      }>;
    }>;
  },
  teamHomeAway: Map<string, boolean>,
): NormalizedPlayerGameStat[] {
  const competitorsTeamRef = parseTeamRef({ team: teamRow.team, score: undefined });
  if (!competitorsTeamRef) {
    return [];
  }

  const rows: NormalizedPlayerGameStat[] = [];
  for (const section of teamRow.statistics ?? []) {
    const labels = (section.labels ?? []).map((label) => label.trim().toUpperCase());
    if (!labels.length) {
      continue;
    }

    for (const athleteRow of section.athletes ?? []) {
      const athlete = athleteRow.athlete;
      const athleteId =
        typeof athlete?.id === "string" || typeof athlete?.id === "number"
          ? String(athlete.id)
          : null;
      if (!athleteId) {
        continue;
      }

      const stats = athleteRow.stats ?? [];
      const byLabel = new Map<string, string>();
      labels.forEach((label, index) => {
        byLabel.set(label, stats[index] ?? "");
      });

      const fg = parseMadeAttempt(byLabel.get("FG"));
      const three = parseMadeAttempt(byLabel.get("3PT"));
      const ft = parseMadeAttempt(byLabel.get("FT"));
      const minutes = (byLabel.get("MIN") ?? "").trim() || null;
      const points = toInt(byLabel.get("PTS"));

      const teamRef = {
        ...competitorsTeamRef,
        score: null,
      };

      rows.push({
        espnAthleteId: athleteId,
        team: teamRef,
        isHome:
          competitorsTeamRef.espnTeamId && teamHomeAway.has(competitorsTeamRef.espnTeamId)
            ? (teamHomeAway.get(competitorsTeamRef.espnTeamId) ?? null)
            : null,
        name: athlete?.displayName ?? athlete?.shortName ?? "Unknown Player",
        shortName: athlete?.shortName ?? null,
        jersey: athlete?.jersey ?? null,
        position:
          athlete?.position?.abbreviation ??
          athlete?.position?.displayName ??
          athlete?.position?.name ??
          null,
        headshotUrl: athlete?.headshot?.href ?? null,
        active: typeof athleteRow.active === "boolean" ? athleteRow.active : null,
        starter: typeof athleteRow.starter === "boolean" ? athleteRow.starter : null,
        didNotPlay: typeof athleteRow.didNotPlay === "boolean" ? athleteRow.didNotPlay : null,
        minutes,
        minutesDecimal: parseMinutesDecimal(minutes),
        points,
        fgm: fg.made,
        fga: fg.attempts,
        fg3m: three.made,
        fg3a: three.attempts,
        ftm: ft.made,
        fta: ft.attempts,
        reb: toInt(byLabel.get("REB")),
        ast: toInt(byLabel.get("AST")),
        tov: toInt(byLabel.get("TO")),
        stl: toInt(byLabel.get("STL")),
        blk: toInt(byLabel.get("BLK")),
        oreb: toInt(byLabel.get("OREB")),
        dreb: toInt(byLabel.get("DREB")),
        pf: toInt(byLabel.get("PF")),
      });
    }
  }

  return rows;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`ESPN request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchTeamScheduleByType(espnTeamId: string, season: number, seasonType: number) {
  const url = new URL(`${TEAM_SCHEDULE_ENDPOINT}/${espnTeamId}/schedule`);
  url.searchParams.set("season", String(season));
  url.searchParams.set("seasontype", String(seasonType));

  type Payload = {
    events?: Array<{
      id?: string;
      date?: string;
      season?: { year?: number };
      links?: Array<{ href?: string; text?: string; rel?: string[] }>;
      competitions?: Array<{
        date?: string;
        status?: { type?: { shortDetail?: string; description?: string; name?: string } };
        neutralSite?: boolean;
        venue?: { fullName?: string };
        competitors?: EspnCompetitor[];
      }>;
    }>;
  };

  const payload = await fetchJson<Payload>(url.toString());
  const games: NormalizedScheduleGame[] = [];
  for (const event of payload.events ?? []) {
    const normalized = parseGameFromCompetition(event, event.competitions?.[0], espnTeamId);
    if (normalized) {
      games.push(normalized);
    }
  }
  return games;
}

export async function fetchBigTenEspnTeams(): Promise<EspnConferenceTeam[]> {
  const url = new URL(TEAMS_ENDPOINT);
  url.searchParams.set("groups", "7");
  url.searchParams.set("limit", "500");

  type Payload = {
    sports?: Array<{
      leagues?: Array<{
        teams?: Array<{ team?: EspnTeamLike }>;
      }>;
    }>;
  };

  const payload = await fetchJson<Payload>(url.toString());
  const entries = payload.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const result: EspnConferenceTeam[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const team = entry.team;
    const espnTeamId =
      typeof team?.id === "string" || typeof team?.id === "number" ? String(team.id) : null;
    if (!espnTeamId || seen.has(espnTeamId)) {
      continue;
    }
    seen.add(espnTeamId);

    const slug = normalizeTeamToSlug(team);
    const known = getB1GTeamBySlug(slug);
    if (!known) {
      continue;
    }

    result.push({
      espnTeamId,
      slug: known.slug,
      name: known.name,
      shortName: known.shortName,
      logoUrl: team?.logo ?? team?.logos?.[0]?.href ?? null,
    });
  }

  return result;
}

export async function fetchTeamSchedule({
  espnTeamId,
  season,
}: {
  espnTeamId: string;
  season: number;
}): Promise<NormalizedScheduleGame[]> {
  const merged = new Map<string, NormalizedScheduleGame>();
  const seasonTypes = [2, 3];

  for (const seasonType of seasonTypes) {
    try {
      const games = await fetchTeamScheduleByType(espnTeamId, season, seasonType);
      for (const game of games) {
        const existing = merged.get(game.externalId);
        if (!existing) {
          merged.set(game.externalId, game);
          continue;
        }
        const existingDate = existing.date ?? -1;
        const candidateDate = game.date ?? -1;
        if (candidateDate > existingDate) {
          merged.set(game.externalId, game);
        }
      }
    } catch {
      continue;
    }
  }

  return [...merged.values()].sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
}

export async function fetchGameBoxscore({
  eventId,
}: {
  eventId: string;
}): Promise<NormalizedGameBoxscore | null> {
  const url = new URL(SUMMARY_ENDPOINT);
  url.searchParams.set("event", eventId);

  type Payload = {
    header?: {
      competitions?: Array<{
        date?: string;
        status?: { type?: { shortDetail?: string; description?: string; name?: string } };
        competitors?: EspnCompetitor[];
      }>;
    };
    boxscore?: {
      teams?: Array<{
        team?: EspnTeamLike;
        statistics?: Array<{ name?: string; displayValue?: string; value?: string }>;
      }>;
      players?: Array<{
        team?: EspnTeamLike;
        statistics?: Array<{
          name?: string | null;
          labels?: string[];
          athletes?: Array<{
            active?: boolean;
            starter?: boolean;
            didNotPlay?: boolean;
            athlete?: {
              id?: string | number;
              displayName?: string;
              shortName?: string;
              jersey?: string;
              position?: { abbreviation?: string; displayName?: string; name?: string };
              headshot?: { href?: string };
            };
            stats?: string[];
          }>;
        }>;
      }>;
    };
  };

  const payload = await fetchJson<Payload>(url.toString());
  const competition = payload.header?.competitions?.[0];
  const competitors = competition?.competitors ?? [];

  const homeCompetitor = competitors.find((entry) => entry.homeAway === "home") ?? competitors[0];
  const awayCompetitor =
    competitors.find((entry) => entry.homeAway === "away") ?? competitors[1] ?? null;

  const homeTeam = parseTeamRef(homeCompetitor);
  const awayTeam = parseTeamRef(awayCompetitor ?? undefined);

  const teamHomeAway = new Map<string, boolean>();
  if (homeTeam?.espnTeamId) {
    teamHomeAway.set(homeTeam.espnTeamId, true);
  }
  if (awayTeam?.espnTeamId) {
    teamHomeAway.set(awayTeam.espnTeamId, false);
  }

  const teamBoxscores: NormalizedBoxscoreTeam[] = [];
  for (const row of payload.boxscore?.teams ?? []) {
    const teamRef = parseTeamRef({ team: row.team, score: undefined });
    if (!teamRef) {
      continue;
    }
    teamBoxscores.push({
      team: teamRef,
      isHome:
        teamRef.espnTeamId && teamHomeAway.has(teamRef.espnTeamId)
          ? teamHomeAway.get(teamRef.espnTeamId) ?? null
          : null,
      stats: parseStatLine(row.statistics),
    });
  }

  const playerRows: NormalizedPlayerGameStat[] = [];
  for (const teamRow of payload.boxscore?.players ?? []) {
    playerRows.push(...parsePlayerStatSection(teamRow, teamHomeAway));
  }

  if (!homeTeam && !awayTeam && teamBoxscores.length === 0) {
    return null;
  }

  const status =
    competition?.status?.type?.shortDetail ??
    competition?.status?.type?.description ??
    competition?.status?.type?.name ??
    "Scheduled";

  return {
    externalId: eventId,
    season: null,
    date: toEpochSeconds(competition?.date),
    status,
    homeTeam,
    awayTeam,
    teams: teamBoxscores,
    players: playerRows,
  };
}

export async function fetchScoreboard({
  date,
}: {
  date: string;
}): Promise<NormalizedScheduleGame[]> {
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`Invalid date format "${date}". Expected YYYYMMDD.`);
  }

  const url = new URL(SCOREBOARD_ENDPOINT);
  url.searchParams.set("dates", date);
  url.searchParams.set("limit", "300");

  type Payload = {
    events?: Array<{
      id?: string;
      date?: string;
      season?: { year?: number };
      links?: Array<{ href?: string; text?: string; rel?: string[] }>;
      competitions?: Array<{
        date?: string;
        status?: { type?: { shortDetail?: string; description?: string; name?: string } };
        neutralSite?: boolean;
        venue?: { fullName?: string };
        competitors?: EspnCompetitor[];
      }>;
    }>;
  };

  const payload = await fetchJson<Payload>(url.toString());
  const result: NormalizedScheduleGame[] = [];
  for (const event of payload.events ?? []) {
    const parsed = parseGameFromCompetition(event, event.competitions?.[0]);
    if (parsed) {
      result.push(parsed);
    }
  }
  return result;
}
