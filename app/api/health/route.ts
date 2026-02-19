import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireRuntimeEnv } from "@/lib/runtime/env";

export const runtime = "edge";

export async function GET() {
  try {
    const env = requireRuntimeEnv();
    const db = getDb({ b1g_analytics_db: env.b1g_analytics_db });
    await db.run(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "health check failed",
      },
      { status: 500 },
    );
  }
}
