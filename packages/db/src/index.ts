import type { D1Database } from "@cloudflare/workers-types";
import { createClient } from "@libsql/client";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/libsql";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
	const client = createClient({
		url: env.DATABASE_URL,
	});

	return drizzle({ client, relations });
}

export function createD1Db(d1: D1Database) {
	return drizzleD1(d1, { relations });
}

export type LibsqlDatabase = ReturnType<typeof createDb>;
export type D1DrizzleDatabase = ReturnType<typeof createD1Db>;
export type Database = LibsqlDatabase | D1DrizzleDatabase;
