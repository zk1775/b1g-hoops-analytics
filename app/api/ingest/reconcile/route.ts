import { NextRequest, NextResponse } from "next/server";
import {
  runReconcile,
  type ReconcileRequest,
  type ReconcileSourceName,
} from "@/lib/data/reconcile";
import { requireRuntimeEnv, resolveAdminToken } from "@/lib/runtime/env";

export const runtime = "edge";

function parseBoolean(value: string | null | undefined, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseInteger(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseSources(value: string | null | undefined): ReconcileSourceName[] | undefined {
  if (!value) {
    return undefined;
  }
  const values = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const allowed = values.filter(
    (entry): entry is ReconcileSourceName => entry === "espn" || entry === "sports-reference",
  );
  return allowed.length ? allowed : undefined;
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
  return extractToken(request) === expectedToken;
}

function requestFromQuery(request: NextRequest): ReconcileRequest {
  const params = new URL(request.url).searchParams;
  return {
    season: parseInteger(params.get("season")),
    team: params.get("team") ?? undefined,
    since: params.get("since") ?? undefined,
    until: params.get("until") ?? undefined,
    limit: parseInteger(params.get("limit")),
    includePlayerStats: parseBoolean(params.get("includePlayerStats"), true),
    sources: parseSources(params.get("sources")),
  };
}

function requestFromBody(body: Partial<ReconcileRequest>): ReconcileRequest {
  return {
    season:
      typeof body.season === "number" && Number.isInteger(body.season) ? body.season : undefined,
    team: typeof body.team === "string" ? body.team : undefined,
    since: typeof body.since === "string" ? body.since : undefined,
    until: typeof body.until === "string" ? body.until : undefined,
    limit: typeof body.limit === "number" && Number.isInteger(body.limit) ? body.limit : undefined,
    includePlayerStats:
      typeof body.includePlayerStats === "boolean" ? body.includePlayerStats : undefined,
    sources: Array.isArray(body.sources)
      ? body.sources.filter(
          (entry): entry is ReconcileSourceName =>
            entry === "espn" || entry === "sports-reference",
        )
      : undefined,
  };
}

async function handle(request: NextRequest, source: "query" | "body") {
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

  const adminToken = resolveAdminToken(env);
  if (!isAuthorized(request, adminToken)) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const payload =
    source === "query"
      ? requestFromQuery(request)
      : requestFromBody(((await request.json().catch(() => ({}))) as Partial<ReconcileRequest>) ?? {});

  try {
    const result = await runReconcile(env, payload);
    return NextResponse.json({ status: "ok", ...result });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "reconcile failed",
      },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request, "query");
}

export async function POST(request: NextRequest) {
  return handle(request, "body");
}

