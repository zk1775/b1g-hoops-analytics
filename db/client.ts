import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

export type DbEnv = {
  b1g_analytics_db: Parameters<typeof drizzle>[0];
};

export function getDb(env: DbEnv) {
  return drizzle(env.b1g_analytics_db, { schema });
}
