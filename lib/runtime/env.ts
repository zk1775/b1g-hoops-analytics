import type { DbEnv } from "@/db/client";

export type RuntimeEnv = DbEnv & {
  ADMIN_TOKEN?: string;
};

type GlobalWithCloudflare = typeof globalThis & {
  cloudflare?: { env?: Partial<RuntimeEnv> };
  env?: Partial<RuntimeEnv>;
};

export function resolveRuntimeEnv(): RuntimeEnv | null {
  const g = globalThis as GlobalWithCloudflare;
  const env = g.cloudflare?.env ?? g.env;
  if (!env?.b1g_analytics_db) {
    return null;
  }
  return env as RuntimeEnv;
}

export function resolveDbEnv(): DbEnv | null {
  const env = resolveRuntimeEnv();
  if (!env) {
    return null;
  }
  return { b1g_analytics_db: env.b1g_analytics_db };
}

export function resolveAdminToken(env?: Partial<RuntimeEnv> | null): string | null {
  const candidate = env?.ADMIN_TOKEN ?? resolveRuntimeEnv()?.ADMIN_TOKEN;
  if (candidate && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof process !== "undefined" && process.env.ADMIN_TOKEN) {
    return process.env.ADMIN_TOKEN;
  }
  return null;
}
