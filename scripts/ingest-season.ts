type CliArgs = {
  season?: number;
  team?: string;
  mode?: "all" | "team";
  since?: string;
  until?: string;
  includeBoxscore?: boolean;
};

function readArg(name: string) {
  const exact = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(exact));
  if (hit) {
    return hit.slice(exact.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return undefined;
}

function parseBoolean(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseArgs(): CliArgs {
  const seasonRaw = readArg("season");
  const parsedSeason = seasonRaw ? Number(seasonRaw) : undefined;
  return {
    season: Number.isInteger(parsedSeason) ? parsedSeason : undefined,
    team: readArg("team"),
    mode: (readArg("mode") as CliArgs["mode"]) ?? undefined,
    since: readArg("since"),
    until: readArg("until"),
    includeBoxscore: parseBoolean(readArg("includeBoxscore")),
  };
}

async function main() {
  const baseUrl = process.env.INGEST_BASE_URL ?? "http://localhost:3000";
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    console.error("Missing ADMIN_TOKEN env var.");
    process.exit(1);
  }

  const payload = parseArgs();
  const response = await fetch(`${baseUrl}/api/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  console.log(body);

  if (!response.ok) {
    process.exit(1);
  }
}

void main();
