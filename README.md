# B1G Hoops Analytics

Next.js App Router app deployed on Cloudflare Pages with D1 + Drizzle.

## Stack
- Next.js (App Router)
- Cloudflare Pages (`@cloudflare/next-on-pages`)
- Cloudflare D1 (`b1g_analytics_db`)
- Drizzle ORM + drizzle-kit

## Data Model
- `teams`: Big Ten and opponents (`slug`, `name`, `short_name`, `conference`, `logo_url`)
- `games`: game identity and scoreboard (`external_id` unique, home/away team links, scores, status, date)
- `team_game_stats`: per-team per-game stats (`game_id + team_id` unique)

Current schema is aligned with ingest requirements.  
`drizzle-kit generate` reports no pending schema changes.

## Local Setup
1. Start app:
```bash
pnpm dev
```
2. Ensure `.dev.vars` or Cloudflare env includes:
- `ADMIN_TOKEN`

## Seeding Teams
Print SQL only (default):
```bash
pnpm seed:b1g
```

Execute seed SQL against local D1:
```bash
SEED_EXECUTE=true pnpm seed:b1g
```

Execute seed SQL against remote D1:
```bash
SEED_EXECUTE=true SEED_REMOTE=true pnpm seed:b1g
```

## Migrations
Generate migration files:
```bash
npx --no-install drizzle-kit generate
```

Apply local migration:
```bash
npx --no-install wrangler d1 execute b1g-analytics-db --local --file=drizzle/0001_closed_bromley.sql
```

Apply remote migration:
```bash
npx --no-install wrangler d1 execute b1g-analytics-db --remote --file=drizzle/0001_closed_bromley.sql
```

## Ingesting Schedules + Results

### API endpoint (admin-protected)
`POST /api/ingest` with:
```json
{
  "season": 2026,
  "mode": "all",
  "team": "purdue",
  "since": "2026-01-01",
  "until": "2026-03-31",
  "includeBoxscore": true
}
```

Auth:
- `Authorization: Bearer <ADMIN_TOKEN>`
- or `?token=<ADMIN_TOKEN>` on GET routes

### Manual trigger examples
All teams, current season:
```bash
curl -X POST "http://localhost:3000/api/ingest" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"all","includeBoxscore":true}'
```

Single team:
```bash
curl -X POST "http://localhost:3000/api/ingest" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"team","team":"purdue","season":2026,"includeBoxscore":true}'
```

Cron/manual scheduled route:
```bash
curl "http://localhost:3000/api/ingest/cron?token=$ADMIN_TOKEN&includeBoxscore=true"
```

### Scripted ingest
```bash
ADMIN_TOKEN=... INGEST_BASE_URL=http://localhost:3000 pnpm ingest:season --season 2026 --mode all --includeBoxscore true
```

## Verification Commands (D1)
Teams count:
```bash
npx --no-install wrangler d1 execute b1g-analytics-db --local --command "select count(*) as teams_count from teams;"
```

Games count:
```bash
npx --no-install wrangler d1 execute b1g-analytics-db --local --command "select count(*) as games_count from games;"
```

Stats count:
```bash
npx --no-install wrangler d1 execute b1g-analytics-db --local --command "select count(*) as stats_count from team_game_stats;"
```

One team schedule sample:
```bash
npx --no-install wrangler d1 execute b1g-analytics-db --local --command "select g.id, datetime(g.date, 'unixepoch') as game_date, h.name as home_team, a.name as away_team, g.home_score, g.away_score, g.status from games g join teams h on h.id = g.home_team_id join teams a on a.id = g.away_team_id where h.slug = 'purdue' or a.slug = 'purdue' order by g.date desc limit 10;"
```

## Pages to Validate
- `/teams`
- `/teams/[slug]` (example: `/teams/purdue`)
- `/games/[id]` (from team schedule links)
- `/dashboard`

## Quality Checks
```bash
pnpm lint
pnpm build
```
