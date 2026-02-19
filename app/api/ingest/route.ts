import { NextRequest, NextResponse } from "next/server";
import { runIngest, type IngestRequest, type IngestMode } from "@/lib/data/ingest";
import { requireRuntimeEnv } from "@/lib/runtime/env";

export const runtime = "edge";

function parseBoolean(value: string | null) {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseMode(value: string | null): IngestMode | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "all" || value === "team") {
    return value;
  }
  return undefined;
}

function parseSeason(value: string | null) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function extractToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return new URL(request.url).searchParams.get("token");
}

function isAuthorized(request: NextRequest, expectedToken: string | null) {
  if (!expectedToken) {
    return false;
  }
  const provided = extractToken(request);
  return provided === expectedToken;
}

function requestFromQuery(request: NextRequest): IngestRequest {
  const params = new URL(request.url).searchParams;
  return {
    season: parseSeason(params.get("season")),
    team: params.get("team") ?? undefined,
    mode: parseMode(params.get("mode")),
    since: params.get("since") ?? undefined,
    until: params.get("until") ?? undefined,
    includeBoxscore: parseBoolean(params.get("includeBoxscore")),
  };
}

async function handleIngest(request: NextRequest, source: "query" | "body") {
  let env: ReturnType<typeof requireRuntimeEnv>;
  try {
    env = requireRuntimeEnv();
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Missing b1g_analytics_db binding",
      },
      { status: 500 },
    );
  }

  const adminToken = env.ADMIN_TOKEN?.trim() ?? null;
  if (!isAuthorized(request, adminToken)) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  let ingestRequest: IngestRequest = {};
  if (source === "query") {
    ingestRequest = requestFromQuery(request);
  } else {
    const parsed = (await request.json().catch(() => ({}))) as IngestRequest;
    ingestRequest = parsed ?? {};
  }

  try {
    const result = await runIngest(env, ingestRequest);
    return NextResponse.json({ status: "ok", ...result });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "ingest failed",
      },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleIngest(request, "query");
}

export async function POST(request: NextRequest) {
  return handleIngest(request, "body");
}
