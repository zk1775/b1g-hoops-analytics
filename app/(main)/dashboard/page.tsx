import Link from "next/link";
import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { teams } from "@/db/schema";
import IngestButton from "@/app/(main)/components/IngestButton";
import { resolveDbEnv } from "@/lib/runtime/env";

export const runtime = "edge";

export default async function DashboardPage() {
  const env = resolveDbEnv();
  if (!env) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-red-700">Missing D1 binding: b1g_analytics_db</p>
      </section>
    );
  }

  const db = getDb(env);
  const teamRows = await db
    .select({
      slug: teams.slug,
      name: teams.name,
    })
    .from(teams)
    .orderBy(asc(teams.name));

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-black/70">Big Ten teams and recent ingestion tools.</p>

      <IngestButton />

      {teamRows.length === 0 ? (
        <p className="text-sm text-black/70">
          No teams loaded yet. Run <code>npm run seed:b1g</code>.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {teamRows.map((team) => (
            <li key={team.slug} className="rounded border border-black/10 p-3 text-sm">
              <Link href={`/teams/${team.slug}`} className="font-medium hover:underline">
                {team.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
