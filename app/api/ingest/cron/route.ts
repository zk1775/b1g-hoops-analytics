import { NextRequest, NextResponse } from "next/server";
import { runIngest } from "@/lib/data/ingest";
import { resolveAdminToken, resolveRuntimeEnv } from "@/lib/runtime/env";

export const runtime = "edge";

function parseBoolean(value: string | null) {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function extractToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return new URL(request.url).searchParams.get("token");
}

export async function GET(request: NextRequest) {
  const env = resolveRuntimeEnv();
  if (!env) {
    return NextResponse.json(
      { status: "error", message: "Missing b1g_analytics_db binding" },
      { status: 500 },
    );
  }

  const adminToken = resolveAdminToken(env);
  if (!adminToken || extractToken(request) !== adminToken) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const season = params.get("season");
  const parsedSeason = season ? Number(season) : undefined;

  try {
    const summary = await runIngest(env, {
      mode: "all",
      season: Number.isInteger(parsedSeason) ? parsedSeason : undefined,
      includeBoxscore: parseBoolean(params.get("includeBoxscore")),
      since: params.get("since") ?? undefined,
      until: params.get("until") ?? undefined,
    });
    return NextResponse.json({ status: "ok", source: "cron", ...summary });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "cron ingest failed",
      },
      { status: 400 },
    );
  }
}
