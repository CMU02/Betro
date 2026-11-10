import type { LibsqlDatabase } from "@Betro/db";
import {
	busRoute,
	busRouteSegment,
	busRouteShape,
	busRouteStop,
	type ReferenceBatchKind,
	referenceBatch,
	stationCrosswalk,
	timetableStopTime,
	timetableTrip,
	trackShape,
	trackStation,
} from "@Betro/db/schema/transit";
import type { InValue } from "@libsql/client";
import { getColumns, getTableName, type Table } from "drizzle-orm";

/** D1 문장 하나의 한도(100KB)보다 여유 있게 잡은 문장 크기 상한(UTF-8 바이트). */
export const D1_MAX_STATEMENT_BYTES = 90_000;

/** D1으로 올리는 참조 배치 종류. currentFlipSql도 이 순서로 문장을 만든다. */
export const D1_PUBLISH_KINDS: ReferenceBatchKind[] = [
	"station_crosswalk",
	"track",
	"timetable",
	"bus_route",
];

/** 로컬에서 한 번에 읽는 행 수. 시간표 정차 55만 행을 한꺼번에 메모리에 올리지 않기 위해 나눠 읽는다. */
const EXPORT_PAGE_SIZE = 5000;

interface ExportTable {
	/** 배치 id 목록(정수 리터럴을 쉼표로 이은 것)을 받아 이 테이블의 행을 고르는 WHERE 조건 */
	filter: (ids: string) => string;
	table: Table;
}

/** 부모가 자식보다 먼저 오도록 정렬한 내보내기 순서. */
const EXPORT_TABLES: readonly ExportTable[] = [
	{ filter: (ids) => `"id" IN (${ids})`, table: referenceBatch },
	{ filter: (ids) => `"batch_id" IN (${ids})`, table: stationCrosswalk },
	{ filter: (ids) => `"batch_id" IN (${ids})`, table: trackShape },
	{
		filter: (ids) =>
			`"track_shape_id" IN (SELECT "id" FROM "track_shape" WHERE "batch_id" IN (${ids}))`,
		table: trackStation,
	},
	{ filter: (ids) => `"batch_id" IN (${ids})`, table: timetableTrip },
	{
		filter: (ids) =>
			`"trip_id" IN (SELECT "id" FROM "timetable_trip" WHERE "batch_id" IN (${ids}))`,
		table: timetableStopTime,
	},
	{ filter: (ids) => `"batch_id" IN (${ids})`, table: busRoute },
	{
		filter: (ids) =>
			`"bus_route_id" IN (SELECT "id" FROM "bus_route" WHERE "batch_id" IN (${ids}))`,
		table: busRouteShape,
	},
	{
		filter: (ids) =>
			`"bus_route_id" IN (SELECT "id" FROM "bus_route" WHERE "batch_id" IN (${ids}))`,
		table: busRouteStop,
	},
	{
		filter: (ids) =>
			`"bus_route_id" IN (SELECT "id" FROM "bus_route" WHERE "batch_id" IN (${ids}))`,
		table: busRouteSegment,
	},
];

const textEncoder = new TextEncoder();

const byteLength = (text: string): number => textEncoder.encode(text).length;

const quoteIdentifier = (name: string): string =>
	`"${name.replaceAll('"', '""')}"`;

const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

/**
 * libsql이 돌려준 저장값을 SQLite 리터럴로 쓴다. 로컬 DB의 저장 형태를 그대로 옮기므로
 * JSON 컬럼은 JSON 문자열, boolean은 0/1, timestamp_ms는 정수가 된다.
 */
export function sqlLiteral(value: InValue | undefined): string {
	if (value === null || value === undefined) {
		return "NULL";
	}
	if (typeof value === "string") {
		return `'${value.replaceAll("'", "''")}'`;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error(`cannot write non-finite number ${value} as SQL`);
		}
		// String(number)은 같은 double로 되읽히는 가장 짧은 표기다.
		return String(value);
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (typeof value === "boolean") {
		return value ? "1" : "0";
	}
	if (value instanceof Date) {
		return String(value.getTime());
	}
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	const hex = Array.from(bytes, (byte) =>
		byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0")
	).join("");
	return `X'${hex}'`;
}

/** 같은 테이블의 값 묶음을 문장 크기 한도 안에서 INSERT 문으로 모은다. */
class InsertStatementBuilder {
	private readonly prefix: string;
	private readonly prefixBytes: number;
	private readonly tableName: string;
	private tuples: string[] = [];
	private bytes = 0;
	readonly statements: string[] = [];

	constructor(tableName: string, columnNames: readonly string[]) {
		this.tableName = tableName;
		this.prefix = `INSERT INTO ${quoteIdentifier(tableName)} (${columnNames
			.map(quoteIdentifier)
			.join(",")}) VALUES `;
		this.prefixBytes = byteLength(this.prefix);
	}

	add(tuple: string): void {
		const tupleBytes = byteLength(tuple);
		// 끝의 ";" 1바이트, 앞 묶음과 잇는 "," 1바이트
		const separatorBytes = this.tuples.length > 0 ? 1 : 0;
		if (
			this.tuples.length > 0 &&
			this.bytes + separatorBytes + tupleBytes + 1 > D1_MAX_STATEMENT_BYTES
		) {
			this.flush();
		}
		if (this.tuples.length === 0) {
			if (this.prefixBytes + tupleBytes + 1 > D1_MAX_STATEMENT_BYTES) {
				throw new Error(
					`${this.tableName} row is ${tupleBytes} bytes; one INSERT cannot stay under ${D1_MAX_STATEMENT_BYTES} bytes`
				);
			}
			this.bytes = this.prefixBytes + tupleBytes;
		} else {
			this.bytes += 1 + tupleBytes;
		}
		this.tuples.push(tuple);
	}

	flush(): void {
		if (this.tuples.length === 0) {
			return;
		}
		this.statements.push(`${this.prefix}${this.tuples.join(",")};`);
		this.tuples = [];
		this.bytes = 0;
	}
}

function batchIdList(batchIds: readonly number[]): string {
	for (const id of batchIds) {
		if (!Number.isSafeInteger(id)) {
			throw new Error(`invalid batch id: ${id}`);
		}
	}
	return [...new Set(batchIds)].join(",");
}

async function exportTable(
	db: LibsqlDatabase,
	{ filter, table }: ExportTable,
	ids: string
): Promise<string[]> {
	const tableName = getTableName(table);
	const columnNames = Object.values(getColumns(table)).map(
		(column) => column.name
	);
	const builder = new InsertStatementBuilder(tableName, columnNames);
	const select = `SELECT ${columnNames.map(quoteIdentifier).join(",")} FROM ${quoteIdentifier(
		tableName
	)} WHERE (${filter(ids)}) AND "id" > ? ORDER BY "id" LIMIT ?`;
	const idIndex = columnNames.indexOf("id");
	if (idIndex < 0) {
		throw new Error(`${tableName} has no id column`);
	}
	let lastId = Number.MIN_SAFE_INTEGER;
	for (;;) {
		// biome-ignore lint/performance/noAwaitInLoops: keyset pages depend on the previous page's last id
		const page = await db.$client.execute({
			args: [lastId, EXPORT_PAGE_SIZE],
			sql: select,
		});
		for (const row of page.rows) {
			builder.add(
				`(${columnNames.map((_, index) => sqlLiteral(row[index])).join(",")})`
			);
		}
		const last = page.rows.at(-1);
		if (!last || page.rows.length < EXPORT_PAGE_SIZE) {
			break;
		}
		lastId = Number(last[idIndex]);
	}
	builder.flush();
	return builder.statements;
}

/**
 * 주어진 배치의 reference_batch 행과 자식 행을 로컬 id 그대로 넣는 INSERT 문 목록.
 * 부모 테이블이 자식보다 먼저 오고, 문 하나는 D1_MAX_STATEMENT_BYTES 이하다.
 * 바인딩 변수 없이 SQL 리터럴만 쓴다.
 */
export async function exportBatchSql(
	db: LibsqlDatabase,
	batchIds: number[]
): Promise<string[]> {
	if (batchIds.length === 0) {
		return [];
	}
	const ids = batchIdList(batchIds);
	const statements: string[] = [];
	for (const exported of EXPORT_TABLES) {
		// biome-ignore lint/performance/noAwaitInLoops: parents are exported before children
		statements.push(...(await exportTable(db, exported, ids)));
	}
	return statements;
}

/** 종류별로 주어진 배치만 현재 배치로 표시하는 UPDATE 문. */
export function currentFlipSql(
	currentIds: Record<ReferenceBatchKind, number>
): string[] {
	return D1_PUBLISH_KINDS.map((kind) => {
		const id = currentIds[kind];
		if (!Number.isSafeInteger(id)) {
			throw new Error(`invalid current batch id for ${kind}: ${id}`);
		}
		return `UPDATE "reference_batch" SET "is_current" = ("id" = ${id}) WHERE "kind" = ${sqlLiteral(kind)};`;
	});
}
