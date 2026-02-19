import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, type DbEnv } from "@/db/client";


function resolveEnv(): DbEnv | null {
  const g = globalThis as typeof globalThis & {
    cloudflare?: { env?: Partial<DbEnv> };
    env?: Partial<DbEnv>;
  };

  const env = g.cloudflare?.env ?? g.env;
  if (!env?.b1g_analytics_db) {
    return null;
  }

  return env as DbEnv;
}

export async function GET() {
  const env = resolveEnv();

  if (!env) {
    return NextResponse.json(
      { status: "error", message: "Missing b1g_analytics_db binding" },
      { status: 500 },
    );
  }

  const db = getDb(env);
  await db.run(sql`select 1`);

  return NextResponse.json({ status: "ok" });
}

export const runtime = "edge";
