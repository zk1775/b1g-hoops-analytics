import { getRequestContext } from "@cloudflare/next-on-pages";
import { drizzle } from "drizzle-orm/d1";

export type D1Database = Parameters<typeof drizzle>[0];

export type DbEnv = {
  b1g_analytics_db: D1Database;
  ADMIN_TOKEN?: string;
};

type GlobalWithCloudflare = typeof globalThis & {
  cloudflare?: { env?: Partial<DbEnv> };
  env?: Partial<DbEnv>;
};

export function getRuntimeEnv(): Partial<DbEnv> {
  try {
    const contextEnv = getRequestContext()?.env;
    if (contextEnv && typeof contextEnv === "object") {
      return contextEnv as Partial<DbEnv>;
    }
  } catch {
    // Request context may not exist in local scripts/tests.
  }

  const g = globalThis as GlobalWithCloudflare;
  return (g.cloudflare?.env ?? g.env ?? {}) as Partial<DbEnv>;
}

export function requireRuntimeEnv(): DbEnv {
  const env = getRuntimeEnv();
  if (!env?.b1g_analytics_db) {
    throw new Error("Missing b1g_analytics_db binding");
  }
  return env as DbEnv;
}

export function resolveRuntimeEnv(): DbEnv | null {
  try {
    return requireRuntimeEnv();
  } catch {
    return null;
  }
}

export function resolveDbEnv(): Pick<DbEnv, "b1g_analytics_db"> | null {
  const env = resolveRuntimeEnv();
  if (!env) {
    return null;
  }
  return { b1g_analytics_db: env.b1g_analytics_db };
}

export function resolveAdminToken(env?: Partial<DbEnv> | null): string | null {
  const candidate = env?.ADMIN_TOKEN ?? getRuntimeEnv().ADMIN_TOKEN;
  if (candidate && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof process !== "undefined" && process.env.ADMIN_TOKEN) {
    return process.env.ADMIN_TOKEN;
  }
  return null;
}
