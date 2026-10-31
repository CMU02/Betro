import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/libsql/migrator";

import { createDb } from "./index";
import type { Database } from "./index";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

export async function createTestDb(): Promise<Database> {
  const db = createDb({ DATABASE_URL: ":memory:" });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
