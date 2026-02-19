import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { resolveDbEnv } from "@/lib/runtime/env";

export const runtime = "edge";

export async function GET() {
  const env = resolveDbEnv();

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
