import { spawnSync } from "node:child_process";
import { B1G_TEAMS } from "../lib/data/b1gTeams";

function quoteSql(value: string | null) {
  if (value === null) {
    return "NULL";
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function buildUpsertSql() {
  const statements: string[] = ["BEGIN TRANSACTION;"];

  for (const team of B1G_TEAMS) {
    statements.push(
      `UPDATE teams
SET slug = ${quoteSql(team.slug)},
    name = ${quoteSql(team.name)},
    short_name = ${quoteSql(team.shortName)},
    conference = ${quoteSql(team.conference)},
    logo_url = NULL
WHERE slug = ${quoteSql(team.slug)} OR name = ${quoteSql(team.name)};`,
    );

    statements.push(
      `INSERT INTO teams (slug, name, short_name, conference, logo_url)
SELECT ${quoteSql(team.slug)}, ${quoteSql(team.name)}, ${quoteSql(team.shortName)}, ${quoteSql(
        team.conference,
      )}, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM teams WHERE slug = ${quoteSql(team.slug)} OR name = ${quoteSql(team.name)}
);`,
    );
  }

  statements.push("COMMIT;");
  return statements.join("\n");
}

function shouldExecute() {
  const raw = process.env.SEED_EXECUTE?.toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function main() {
  const sql = buildUpsertSql();
  console.log(sql);

  if (!shouldExecute()) {
    console.error(
      "\nSQL printed only. Set SEED_EXECUTE=true to execute via Wrangler D1 CLI (--local by default).",
    );
    return;
  }

  if (process.env.D1_DB_PATH) {
    console.error(
      "D1_DB_PATH was provided, but local sqlite direct mode is not supported in this script. Continuing with Wrangler D1 CLI.",
    );
  }

  const databaseName = process.env.D1_DATABASE_NAME ?? "b1g-analytics-db";
  const remoteFlag = process.env.SEED_REMOTE ?? process.env.D1_REMOTE;
  const remote = remoteFlag?.toLowerCase() === "1" || remoteFlag?.toLowerCase() === "true";

  const args = [
    "--no-install",
    "wrangler",
    "d1",
    "execute",
    databaseName,
    remote ? "--remote" : "--local",
    "--command",
    sql,
  ];

  const result = spawnSync("npx", args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();
