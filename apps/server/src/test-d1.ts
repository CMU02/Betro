import type { LibsqlDatabase } from "@Betro/db";
import type { D1Database } from "@cloudflare/workers-types";

type SqlArg = string | number | null;

/** 테스트용. 날 D1을 쓰는 포트의 prepare → bind → all/first 만 libsql 위에 흉내 낸다. */
export function d1Over(db: LibsqlDatabase): D1Database {
	const rowsOf = async (sql: string, args: SqlArg[]) => {
		const result = await db.$client.execute({ args, sql });
		return result.rows.map((row) =>
			Object.fromEntries(
				result.columns.map((column, index) => [column, row[index]])
			)
		);
	};
	const statement = (sql: string, args: SqlArg[] = []) => ({
		all: async () => ({ results: await rowsOf(sql, args) }),
		bind: (...next: SqlArg[]) => statement(sql, next),
		first: async () => (await rowsOf(sql, args))[0] ?? null,
	});
	return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}
